// api/mews-availability.js

// Assuming you are using a Node.js version with native fetch
// No need for 'node-fetch' import unless on a very old version

export default async function handler(request, response) {
  // 1. Only allow POST requests
  if (request.method !== 'POST') {
    console.warn(`Received non-POST request: ${request.method}`);
    response.setHeader('Allow', ['POST']);
    return response.status(405).end(`Method ${request.method} Not Allowed`);
  }

  console.log("--- Function Invoked ---"); // Log start

  // 2. Securely get Mews Credentials from Environment Variables & Log Check
  const MEWS_CLIENT_TOKEN = process.env.MEWS_CLIENT_TOKEN;
  const MEWS_ACCESS_TOKEN = process.env.MEWS_ACCESS_TOKEN;
  const MEWS_CONNECTOR_API_URL = process.env.MEWS_CONNECTOR_API_URL;
  const MEWS_SERVICE_ID = process.env.MEWS_SERVICE_ID;

  console.log("--- Environment Variable Check ---");
  console.log("MEWS_CLIENT_TOKEN Loaded:", MEWS_CLIENT_TOKEN ? 'Yes' : 'NO! MISSING!');
  console.log("MEWS_ACCESS_TOKEN Loaded:", MEWS_ACCESS_TOKEN ? 'Yes' : 'NO! MISSING!');
  console.log("MEWS_SERVICE_ID Loaded:", MEWS_SERVICE_ID || 'NO! MISSING!');
  console.log("MEWS_CONNECTOR_API_URL Loaded:", MEWS_CONNECTOR_API_URL || 'NO! MISSING!');
  console.log("--- End Environment Variable Check ---");

  if (!MEWS_CLIENT_TOKEN || !MEWS_ACCESS_TOKEN || !MEWS_SERVICE_ID || !MEWS_CONNECTOR_API_URL) {
    console.error("FATAL: One or more required Mews environment variables are missing.");
    // Returning 500 is appropriate as it's a server config issue
    return response.status(500).json({ error: "Server configuration error." });
  }

  // 3. Get data from the frontend request body
  let villaId, startDate, endDate;
  try {
    ({ villaId, startDate, endDate } = request.body);
    console.log("Received Request Body:", JSON.stringify(request.body)); // Log received data

    if (!villaId || !startDate || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new Error("Missing or invalid parameters: villaId, startDate, endDate required (YYYY-MM-DD).");
    }
  } catch (error) {
    console.error("Error parsing request body:", error.message);
    return response.status(400).json({ error: error.message || "Invalid request body." });
  }

  // 4. Prepare the request to Mews Connector API
  // Endpoint confirmed from docs: /api/connector/v1/resources/getAvailability
  const mewsEndpoint = `${MEWS_CONNECTOR_API_URL}/api/connector/v1/resources/getAvailability`;

  // Payload structure confirmed from docs: Tokens go in the body for Connector API
  const mewsPayload = {
    ClientToken: MEWS_CLIENT_TOKEN,
    AccessToken: MEWS_ACCESS_TOKEN,
    ServiceId: MEWS_SERVICE_ID,
    StartUtc: `${startDate}T00:00:00Z`, // Using UTC start of day
    EndUtc: `${endDate}T23:59:59Z`,   // Using UTC end of day (covers the whole end date)
    CategoryIds: [villaId],
    // Add other relevant optional parameters if needed, e.g., States: ["Confirmed", "Optional"] ? Check docs.
  };

  // Log the exact payload BEFORE sending
  console.log(`Calling Mews API Endpoint: ${mewsEndpoint}`);
  console.log("Sending Mews Payload:", JSON.stringify(mewsPayload));

  try {
    // 5. Call the Mews Connector API
    const mewsApiResponse = await fetch(mewsEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Connector API Auth uses tokens in body, usually no extra Auth headers needed
      },
      body: JSON.stringify(mewsPayload),
    });

    // Log the raw response status AND headers (can sometimes contain useful info)
    console.log(`Mews Response Status: ${mewsApiResponse.status}`);
    // console.log("Mews Response Headers:", JSON.stringify(Object.fromEntries(mewsApiResponse.headers.entries()))); // Can be verbose

    if (!mewsApiResponse.ok) {
      // Try to get text body for ANY non-ok response for better debugging
      const errorBodyText = await mewsApiResponse.text();
      console.error(`Mews API Error Response Body: ${errorBodyText}`);
      // Throw specific error based on status
      throw new Error(`Mews API request failed with status ${mewsApiResponse.status}`);
    }

    // Attempt to parse JSON only if response is OK
    const mewsData = await mewsApiResponse.json();
    // Log first part of successful response data
    console.log("Received Mews API OK Response (structure may vary):", JSON.stringify(mewsData).substring(0, 500) + "...");

    // 6. Process the Mews response to find unavailable dates
    const unavailableDates = new Set();
    const targetCategoryId = villaId;

    // *** IMPORTANT: Adapt this based on ACTUAL successful response structure ***
    if (mewsData.ResourceAvailabilities && Array.isArray(mewsData.ResourceAvailabilities)) {
       mewsData.ResourceAvailabilities.forEach(dayData => {
           const dateStr = dayData.Date?.substring(0, 10); // Use optional chaining
           if (!dateStr) return; // Skip if date is missing

           let isAvailable = false;
           // Find the resource availability data for the specific category we requested
           const targetResourceData = dayData.Resources?.find(res => res.CategoryId === targetCategoryId);

           if (targetResourceData && targetResourceData.Count > 0) {
               isAvailable = true;
           }
           // Alternative check: Check if dayData.AvailableCount exists and applies to the specific category? Needs doc verification.

           if (!isAvailable) {
               unavailableDates.add(dateStr);
           }
       });
    } else {
       console.warn("Mews response structure might be different than expected. Could not process ResourceAvailabilities.");
       // Log the actual keys received if the structure is wrong
       console.warn("Mews Response Keys:", Object.keys(mewsData));
    }

    console.log("Processed unavailable dates:", Array.from(unavailableDates));

    // 7. Send the simplified response back to the frontend
    console.log("--- Request Success ---");
    // Set CORS header - better to configure in vercel.json for production
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); // Allow POST and OPTIONS for preflight
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return response.status(200).json({ unavailable: Array.from(unavailableDates) });

  } catch (error) {
    // Log the caught error
    console.error("Error within backend function execution:", error.message, error.stack);
    // Don't expose detailed internal errors to the client
    return response.status(500).json({ error: "An internal server error occurred." });
  }
}

// Add handling for OPTIONS preflight requests needed for CORS in browsers
// This can be done more robustly with framework/middleware or vercel.json config
// But adding basic handling here for completeness
export async function OPTIONS(request) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return response.status(204).end(); // No Content for OPTIONS
}
//