// api/mews-availability.js
export default async function handler(request, response) {
    // 1. Method Check & CORS Headers
    if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return response.status(204).end();
    }
    if (request.method !== 'POST') {
        response.setHeader('Allow', ['POST']);
        return response.status(405).end(`Method ${request.method} Not Allowed`);
    }
  
    console.log("--- Function Invoked ---");
  
    // 2. Get & Check Environment Variables
    const MEWS_CLIENT_TOKEN = process.env.MEWS_CLIENT_TOKEN;
    const MEWS_ACCESS_TOKEN = process.env.MEWS_ACCESS_TOKEN;
    const MEWS_CONNECTOR_API_URL = process.env.MEWS_CONNECTOR_API_URL;
    const MEWS_SERVICE_ID = process.env.MEWS_SERVICE_ID;

    if (!MEWS_CLIENT_TOKEN || !MEWS_ACCESS_TOKEN || !MEWS_SERVICE_ID || !MEWS_CONNECTOR_API_URL) {
        console.error("FATAL: One or more required Mews environment variables are missing.");
        return response.status(500).json({ error: "Server configuration error." });
    }
  
    // 3. Get data from request body
    let villaId, startDate, endDate;
    try {
        ({ villaId, startDate, endDate } = request.body);
        console.log("Received Request Body:", JSON.stringify(request.body));
  
        if (!villaId || !startDate || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
            throw new Error("Missing or invalid parameters: villaId, startDate, endDate required (YYYY-MM-DD).");
        }
    } catch (error) {
        console.error("Error parsing request body:", error.message);
        return response.status(400).json({ error: error.message || "Invalid request body." });
    }
  
    // 4. BRUTE FORCE: Try multiple time formats to find the one Mews accepts
    const mewsEndpoint = `${MEWS_CONNECTOR_API_URL}/api/connector/v1/services/getAvailability`;
    
    // All possible hours to try (0-23 range)
    const possibleHours = Array.from({ length: 24 }, (_, i) => i);
    
    // Try each hour until we find one that works
    for (const hour of possibleHours) {
        // Format the time with the current hour
        const formattedStartDate = formatTimeWithHour(startDate, hour);
        const formattedEndDate = formatTimeWithHour(endDate, hour);
        
        const mewsPayload = {
            ClientToken: MEWS_CLIENT_TOKEN,
            AccessToken: MEWS_ACCESS_TOKEN,
            Client: "Kosmos_Availability_Check_1.0", 
            ServiceId: MEWS_SERVICE_ID,
            FirstTimeUnitStartUtc: formattedStartDate,
            LastTimeUnitStartUtc: formattedEndDate,
        };
        
        console.log(`[ATTEMPT ${hour}] Trying with time ${hour}:00:00 UTC`);
        console.log(`[ATTEMPT ${hour}] Payload:`, JSON.stringify(mewsPayload));
        
        try {
            // Call the Mews Connector API
            const mewsApiResponse = await fetch(mewsEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(mewsPayload),
            });
            
            console.log(`[ATTEMPT ${hour}] Response Status: ${mewsApiResponse.status}`);
            
            if (mewsApiResponse.ok) {
                console.log(`[SUCCESS] Found working time format: ${hour}:00:00 UTC`);
                
                // Process successful response
                const mewsData = await mewsApiResponse.json();
                console.log("Received Mews API OK Response (Snippet):", JSON.stringify(mewsData).substring(0, 500) + "...");
                
                // Process the Mews response
                const unavailableDates = processAvailabilityData(mewsData, villaId);
                
                // Send success response
                console.log("--- Request Success with time " + hour + ":00:00 UTC ---");
                response.setHeader('Access-Control-Allow-Origin', '*');
                response.setHeader('Content-Type', 'application/json');
                return response.status(200).json({ 
                    unavailable: Array.from(unavailableDates),
                    _debug: {
                        workingHour: hour,
                        workingTimeFormat: `${hour}:00:00 UTC`
                    }
                });
            } else {
                // Log error but continue to next hour
                const errorText = await mewsApiResponse.text();
                console.log(`[ATTEMPT ${hour}] Error: ${errorText}`);
            }
        } catch (error) {
            console.error(`[ATTEMPT ${hour}] Exception:`, error.message);
            // Continue to next hour
        }
    }
    
    // If we get here, no time format worked
    console.error("FAILED: Tried all 24 possible hour formats and none worked.");
    return response.status(500).json({ 
        error: "Could not find a valid time format for Mews API.",
        _debug: "Tried all 24 hours (0-23) and none were accepted as valid 'start of TimeUnit'"
    });
}

// Helper function to format date with specific hour
function formatTimeWithHour(dateString, hour) {
    // Format the hour with leading zero if needed
    const formattedHour = hour.toString().padStart(2, '0');
    return `${dateString}T${formattedHour}:00:00.000Z`;
}

// Helper function to process availability data
function processAvailabilityData(mewsData, targetCategoryId) {
    const unavailableDates = new Set();
    
    if (mewsData.CategoryAvailabilities && Array.isArray(mewsData.CategoryAvailabilities) && 
        mewsData.TimeUnitStartsUtc && Array.isArray(mewsData.TimeUnitStartsUtc)) {
        
        // Find the availability data for our target category
        const targetCategoryData = mewsData.CategoryAvailabilities.find(
            catAvail => catAvail.CategoryId === targetCategoryId
        );
        
        if (targetCategoryData && targetCategoryData.Availabilities && 
            targetCategoryData.Availabilities.length === mewsData.TimeUnitStartsUtc.length) {
            
            // Iterate through the dates and corresponding availabilities
            mewsData.TimeUnitStartsUtc.forEach((dateUtc, index) => {
                const availableCount = targetCategoryData.Availabilities[index];
                const dateString = dateUtc.substring(0, 10); // Extract YYYY-MM-DD
                
                // Consider a count of 0 or less as unavailable
                if (availableCount <= 0) {
                    unavailableDates.add(dateString);
                }
            });
        } else if (targetCategoryData) {
            console.warn(`Mismatch between TimeUnit count (${mewsData.TimeUnitStartsUtc.length}) and Availability count (${targetCategoryData.Availabilities?.length})`);
        } else {
            console.warn(`Availability data for target CategoryId ${targetCategoryId} not found in Mews response.`);
        }
    } else {
        console.warn("Mews response structure might be different than expected.");
        console.warn("Mews Response Keys:", Object.keys(mewsData));
    }
    
    console.log("Processed unavailable dates:", Array.from(unavailableDates));
    return unavailableDates;
}