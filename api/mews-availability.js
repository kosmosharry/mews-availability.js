// api/mews-availability.js

// NOTE: We are NOT using date-fns-tz due to user preference and API issues

export default async function handler(request, response) {
    // 1. Method Check & CORS Headers (Keep as is)
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

    // 2. Get & Check Environment Variables (Keep as is)
    const MEWS_CLIENT_TOKEN = process.env.MEWS_CLIENT_TOKEN;
    const MEWS_ACCESS_TOKEN = process.env.MEWS_ACCESS_TOKEN;
    const MEWS_CONNECTOR_API_URL = process.env.MEWS_CONNECTOR_API_URL;
    const MEWS_SERVICE_ID = process.env.MEWS_SERVICE_ID; // Make sure this is correct!

    if (!MEWS_CLIENT_TOKEN || !MEWS_ACCESS_TOKEN || !MEWS_SERVICE_ID || !MEWS_CONNECTOR_API_URL) {
        console.error("FATAL: One or more required Mews environment variables are missing.");
        return response.status(500).json({ error: "Server configuration error." });
    }

    // 3. Get data from request body (Keep as is)
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
    // REVERTED: Using T22:00:00Z as required by this specific Mews ServiceId to avoid 400 error
    // WARNING: This is known to cause inaccurate availability results from the API.
    function formatToMewsRequiredTime(dateString) {
        try {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
              throw new Error(`Invalid date format: ${dateString}. Expected YYYY-MM-DD.`);
            }
            // Using the time that prevents the 400 error for this service
            return `${dateString}T22:00:00.000Z`;
        } catch (error) {
            console.error(`Error formatting date ${dateString}: ${error.message}`);
            throw error; // Re-throw
        }
    }

    // 4. Prepare the request to Mews Connector API
    const mewsEndpoint = `${MEWS_CONNECTOR_API_URL}/api/connector/v1/services/getAvailability`;

    const mewsPayload = {
        ClientToken: MEWS_CLIENT_TOKEN,
        AccessToken: MEWS_ACCESS_TOKEN,
        Client: "Kosmos_Availability_Check_1.0",
        ServiceId: MEWS_SERVICE_ID, // Crucial this ID matches the service needing T22:00:00Z
        FirstTimeUnitStartUtc: formatToMewsRequiredTime(startDate),
        LastTimeUnitStartUtc: formatToMewsRequiredTime(endDate),
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
            let errorJson = {};
            try { errorJson = JSON.parse(errorBodyText); } catch (e) { /* ignore */ }
            throw new Error(`Mews API request failed with status ${mewsApiResponse.status}. Message: ${errorJson.Message || errorBodyText}`);
        }

        const mewsData = await mewsApiResponse.json();
        // console.log("Received Full Mews API Response:", JSON.stringify(mewsData, null, 2)); // For debugging
        console.log("Received Mews API OK Response (Snippet):", JSON.stringify(mewsData).substring(0, 500) + "...");

        // 6. Process the Mews response
        const initialUnavailableDates = new Set();
        const targetCategoryId = villaId;
        const timeUnitField = mewsData.TimeUnitStartsUtc ? 'TimeUnitStartsUtc' : (mewsData.DatesUtc ? 'DatesUtc' : null); // Handle potential field name diff

        if (mewsData.CategoryAvailabilities && Array.isArray(mewsData.CategoryAvailabilities) && timeUnitField && mewsData[timeUnitField] && Array.isArray(mewsData[timeUnitField])) {
            const targetCategoryData = mewsData.CategoryAvailabilities.find(catAvail => catAvail.CategoryId === targetCategoryId);
            const datesArray = mewsData[timeUnitField];

            if (targetCategoryData && targetCategoryData.Availabilities && Array.isArray(targetCategoryData.Availabilities) && targetCategoryData.Availabilities.length === datesArray.length) {
                 datesArray.forEach((dateUtc, index) => {
                    const availableCount = targetCategoryData.Availabilities[index];
                    // Extract date part from whatever timestamp format Mews sends back with T22:00:00Z input
                    const dateString = dateUtc.substring(0, 10);
                    if (typeof availableCount === 'number' && availableCount <= 0) {
                        initialUnavailableDates.add(dateString);
                    }
                });
            } else if (targetCategoryData) {
                 console.warn(`Data mismatch for category ${targetCategoryId}: Time Unit count (${datesArray.length}), Availability count (${targetCategoryData.Availabilities?.length})`);
            } else {
                 console.warn(`Availability data for target CategoryId ${targetCategoryId} not found.`);
            }
        } else {
             console.warn(`Mews response structure unexpected. Keys: ${Object.keys(mewsData)}`);
        }

        console.log("Initial processed unavailable dates:", Array.from(initialUnavailableDates));

        // --- WORKAROUND: Attempt to add potentially missing last day ---
        const finalUnavailableDates = new Set(initialUnavailableDates);
        const sortedDates = Array.from(initialUnavailableDates).sort();

        // Helper to add one day to a YYYY-MM-DD string
        function addOneDay(dateString) {
            const date = new Date(dateString + 'T00:00:00Z'); // Treat as UTC midnight
            date.setUTCDate(date.getUTCDate() + 1);
            return date.toISOString().substring(0, 10);
        }

        for (let i = 0; i < sortedDates.length; i++) {
            const currentDate = sortedDates[i];
            const nextDay = addOneDay(currentDate);

            // If the current date is unavailable, but the *next* day is NOT in the initial list...
            // And if the current date is the end of a consecutive block (or a single day block)
            const isLastOfBlock = (i === sortedDates.length - 1) || (addOneDay(sortedDates[i]) !== sortedDates[i+1]);

            if (isLastOfBlock && !initialUnavailableDates.has(nextDay)) {
                 // ... assume this next day *should* have been unavailable (the check-out day issue)
                 console.log(`WORKAROUND: Adding potentially missing last day: ${nextDay} (following ${currentDate})`);
                 finalUnavailableDates.add(nextDay);
            }
        }
        // --- END WORKAROUND ---

        const finalUnavailableArray = Array.from(finalUnavailableDates).sort();
        console.log("Final unavailable dates (with workaround):", finalUnavailableArray);

        // 7. Send the potentially corrected response back
        console.log("--- Request Success (with workaround) ---");
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Content-Type', 'application/json');
        return response.status(200).json({ unavailable: finalUnavailableArray }); // Send the final array

    } catch (error) {
        console.error("Error within backend function execution:", error.message, error.stack);
        return response.status(500).json({ error: "An internal server error occurred.", details: error.message });
    }
}