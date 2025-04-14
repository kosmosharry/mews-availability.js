// api/mews-availability.js

// Use import if your Node version/package.json supports ES Modules, otherwise use require
// import fetch from 'node-fetch'; // Use if installed and needed

export default async function handler(request, response) {
  // 1. Only allow POST requests
  if (request.method !== 'POST') {
    response.setHeader('Allow', ['POST']);
    return response.status(405).end(`Method ${request.method} Not Allowed`);
  }

  // 2. Securely get Mews Credentials from Environment Variables
  const MEWS_CLIENT_TOKEN = process.env.MEWS_CLIENT_TOKEN;
  const MEWS_ACCESS_TOKEN = process.env.MEWS_ACCESS_TOKEN;
  const MEWS_CONNECTOR_API_URL = process.env.MEWS_CONNECTOR_API_URL || "https://api.mews.com"; // Or staging URL if needed
  const MEWS_SERVICE_ID = process.env.MEWS_SERVICE_ID; // Your main Stay Service ID

  if (!MEWS_CLIENT_TOKEN || !MEWS_ACCESS_TOKEN || !MEWS_SERVICE_ID) {
    console.error("Missing Mews environment variables");
    return response.status(500).json({ error: "Server configuration error." });
  }

  // 3. Get data from the frontend request body
  let villaId, startDate, endDate;
  try {
    // Vercel automatically parses JSON bodies if Content-Type is correct
    ({ villaId, startDate, endDate } = request.body);

    // Basic validation
    if (!villaId || !startDate || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new Error("Missing or invalid parameters: villaId, startDate, endDate required (YYYY-MM-DD).");
    }
  } catch (error) {
    console.error("Error parsing request body:", error);
    return response.status(400).json({ error: error.message || "Invalid request body." });
  }

  // 4. Prepare the request to Mews Connector API
  //    *** IMPORTANT: Verify the exact endpoint and payload from Mews Docs ***
  //    This example assumes an endpoint like 'getResourcesAvailability' exists
  const mewsEndpoint = `${MEWS_CONNECTOR_API_URL}/api/connector/v1/resources/getAvailability`; // Replace if different!

  const mewsPayload = {
    ClientToken: MEWS_CLIENT_TOKEN,
    AccessToken: MEWS_ACCESS_TOKEN,
    ServiceId: MEWS_SERVICE_ID,
    StartUtc: `${startDate}T00:00:00Z`, // Assuming UTC, adjust if needed
    EndUtc: `${endDate}T23:59:59Z`,   // Assuming UTC, adjust if needed
    SpaceCategoryIds: [villaId], // Filter by the specific villa
    // Add any other required parameters based on Mews Docs
  };

  console.log(`Calling Mews API (${mewsEndpoint}) for Villa: ${villaId}, Dates: ${startDate} - ${endDate}`);

  try {
    // 5. Call the Mews Connector API
    const mewsApiResponse = await fetch(mewsEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Add other specific headers if required by Mews Connector API Auth
      },
      body: JSON.stringify(mewsPayload),
    });

    if (!mewsApiResponse.ok) {
      const errorBody = await mewsApiResponse.text();
      console.error(`Mews API Error (${mewsApiResponse.status}): ${errorBody}`);
      throw new Error(`Mews API request failed with status ${mewsApiResponse.status}`);
    }

    const mewsData = await mewsApiResponse.json();
    console.log("Received Mews API Response (structure may vary):", JSON.stringify(mewsData).substring(0, 500) + "..."); // Log snippet

    // 6. Process the Mews response to find unavailable dates
    //    *** CRITICAL: Adapt this logic based on the ACTUAL structure of the Mews response ***
    //    Example assumption: response has ResourceAvailabilities array with Dates and Counts per Category
    const unavailableDates = new Set();
    const targetCategoryId = villaId; // The ID we requested

    // This is a HYPOTHETICAL structure - adjust based on Mews response!
    if (mewsData.ResourceAvailabilities && Array.isArray(mewsData.ResourceAvailabilities)) {
       mewsData.ResourceAvailabilities.forEach(dayData => {
           const dateStr = dayData.Date.substring(0, 10); // Extract YYYY-MM-DD

           let isAvailable = false;
           if (dayData.Resources && Array.isArray(dayData.Resources)) {
               const targetResource = dayData.Resources.find(res => res.CategoryId === targetCategoryId);
               if (targetResource && targetResource.Count > 0) {
                   isAvailable = true;
               }
           }
           // Or maybe it's simpler: dayData.AvailableCount > 0 ?

           if (!isAvailable) {
               unavailableDates.add(dateStr);
           }
       });
    } else {
       console.warn("Unexpected Mews response structure for availability processing.");
       // Depending on the actual response, you might need a different parsing strategy.
    }

    console.log("Processed unavailable dates:", Array.from(unavailableDates));

    // 7. Send the simplified response back to the frontend
    response.setHeader('Access-Control-Allow-Origin', '*'); // Basic CORS - Adjust for production!
    response.setHeader('Content-Type', 'application/json');
    return response.status(200).json({ unavailable: Array.from(unavailableDates) });

  } catch (error) {
    console.error("Error in backend function:", error);
    return response.status(500).json({ error: "An internal server error occurred." });
  }
}