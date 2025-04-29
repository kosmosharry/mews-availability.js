// api/mews-availability.js
import { DateTime } from 'luxon';
const TZ = process.env.MEWS_TIME_ZONE || 'America/Denver';


export default async function handler(request, response) {
    // 1. Method Check & CORS Headers (Consider vercel.json for CORS)
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

  
    // Basic check - more detailed logging removed for brevity now
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
  
    // --- Helper Function to format date for Mews API ---
    // For Mews: Start of time unit appears to need to be a specific time
    // We'll set it to 14:00:00 UTC explicitly based on common hotel checkin times
    function formatToMewsUtc(dateString) {
        // parse “2025-09-01” in Denver, then startOf day, then to UTC
        return DateTime
          .fromISO(dateString, { zone: TZ })
          .startOf('day')
          .toUTC()
          .toISO();  // e.g. "2025-09-01T06:00:00.000Z" in summer, "…07:00:00.000Z" in winter
      }
  
    // 4. Prepare the request to Mews Connector API
    const mewsEndpoint = `${MEWS_CONNECTOR_API_URL}/api/connector/v1/services/getAvailability`;
  
    const mewsPayload = {
        ClientToken: MEWS_CLIENT_TOKEN,
        AccessToken: MEWS_ACCESS_TOKEN,
        Client: "Kosmos_Availability_Check_1.0", 
        ServiceId: MEWS_SERVICE_ID,
        FirstTimeUnitStartUtc: formatToMewsUtc(startDate),
        LastTimeUnitStartUtc: formatToMewsUtc(endDate),
    };
  
    console.log(`Calling Mews API Endpoint: ${mewsEndpoint}`);
    console.log("Sending Mews Payload:", JSON.stringify(mewsPayload));
  
    try {
        // 5. Call the Mews Connector API
        const mewsApiResponse = await fetch(mewsEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mewsPayload),
        });
  
        console.log(`Mews Response Status: ${mewsApiResponse.status}`);
  
        if (!mewsApiResponse.ok) {
            const errorBodyText = await mewsApiResponse.text();
            console.error(`Mews API Error Response Body: ${errorBodyText}`);
            throw new Error(`Mews API request failed with status ${mewsApiResponse.status}`);
        }
  
        const mewsData = await mewsApiResponse.json();
        console.log("Received Mews API OK Response (Snippet):", JSON.stringify(mewsData).substring(0, 500) + "...");
  
        // 6. Process the Mews response
        const unavailableDates = new Set();
        const targetCategoryId = villaId; // The category ID we care about
  
        if (mewsData.CategoryAvailabilities && Array.isArray(mewsData.CategoryAvailabilities) && mewsData.TimeUnitStartsUtc && Array.isArray(mewsData.TimeUnitStartsUtc)) {
            // Find the availability data for our target category
            const targetCategoryData = mewsData.CategoryAvailabilities.find(catAvail => catAvail.CategoryId === targetCategoryId);
  
            if (targetCategoryData && targetCategoryData.Availabilities && targetCategoryData.Availabilities.length === mewsData.TimeUnitStartsUtc.length) {
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
                console.warn(`Mismatch between TimeUnit count (${mewsData.TimeUnitStartsUtc.length}) and Availability count (${targetCategoryData.Availabilities?.length}) for category ${targetCategoryId}`);
            } else {
                console.warn(`Availability data for target CategoryId ${targetCategoryId} not found in Mews response.`);
            }
        } else {
            console.warn("Mews response structure might be different than expected. Could not process CategoryAvailabilities or TimeUnitStartsUtc.");
            console.warn("Mews Response Keys:", Object.keys(mewsData));
        }
  
        console.log("Processed unavailable dates:", Array.from(unavailableDates));
  
        // 7. Send the simplified response back to the frontend
        console.log("--- Request Success ---");
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Content-Type', 'application/json');
        return response.status(200).json({ unavailable: Array.from(unavailableDates) });
  
    } catch (error) {
        console.error("Error within backend function execution:", error.message, error.stack);
        return response.status(500).json({ error: "An internal server error occurred." });
    }
}