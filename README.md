# Kosmos Stargazing Resort - Custom Mews Availability Calendar - Backend

Developed for the custom booking widget on [Kosmos Stargazing Resort & Spa website](https://www.kosmosresort.com), This repository contains a Vercel Serverless Function that acts as a secure backend proxy to the Mews Connector API. Its primary purpose is to fetch availability data for a given room category, process it, and provide a simplified list of unavailable dates to a consuming frontend application.

This service was created to keep Mews API credentials secure on the server-side and to handle specific API inconsistencies and data processing logic in a centralized place.

## Architecture

*   **Frontend:** The user interface is built and hosted on **Webflow**. It uses custom code embeds for CSS styling and JavaScript logic.
    *   **Repository:** The source code for the frontend function is located at: [harryg02/Kosmos-Booking_Calendar-Frontend](https://github.com/harryg02/Kosmos-Booking-Calendar-Frontend)
    *   **UI Library:** [Flatpickr.js](https://flatpickr.js.org/) is used to render the interactive calendar.
    *   **Logic:** Custom Vanilla JavaScript handles user interactions (opening the calendar), calling the backend API, processing availability data, and constructing the final Mews deeplink.

*   **Backend:** A Node.js serverless function is deployed on **Vercel** to act as a secure proxy.
    *   **Repository:** The source code for the backend function is located at: [kosmosharry/mews-availability.js](https://github.com/kosmosharry/mews-availability.js)
    *   **Function:** This function receives requests from the Webflow frontend, securely calls the Mews Connector API (`/api/connector/v1/services/getAvailability`) with protected credentials, processes the availability data, and returns a simplified list of unavailable dates to the frontend.


## Features

- **Secure Credential Handling:** Mews API tokens are managed via environment variables and are never exposed to the client.
- **Single, Simple Endpoint:** Provides one POST endpoint to check availability.
- **Data Processing:** Transforms the complex response from the Mews API into a simple array of unavailable date strings (YYYY-MM-DD).
- **API Workarounds:** Implements specific, documented workarounds for inconsistencies discovered in the Mews Demo API.

## API Endpoint Documentation

### POST /api/mews-availability

Fetches availability for a specified room category over a given date range.

#### Request Body

The request must be application/json.

| Field     | Type   | Required | Description                                   |
|-----------|--------|----------|-----------------------------------------------|
| villaId   | String | Yes      | The CategoryId of the room type in Mews.     |
| startDate | String | Yes      | The start date of the range (YYYY-MM-DD).    |
| endDate   | String | Yes      | The end date of the range (YYYY-MM-DD).      |

**Example Request:**

```json
{
  "villaId": "2ca7c7bb-f754-4108-8e27-b046006cd46a",
  "startDate": "2025-04-01",
  "endDate": "2025-05-31"
}
```

#### Success Response (200 OK)

Returns a JSON object containing a single key, `unavailable`, which holds an array of date strings.

**Example Response:**

```json
{
  "unavailable": [
    "2025-04-16",
    "2025-04-28",
    "2025-05-07",
    "2025-05-08",
    "2025-05-09",
    "2025-05-10",
    "2025-05-11",
    "2025-05-12"
  ]
}
```
## Getting Started

### Prerequisites

- Node.js (v18 or later recommended)
- Vercel Account and Vercel CLI installed (`npm i -g vercel`)
- Mews API Credentials

### Setup & Installation

1. **Clone the repository:**
   ```bash
   git clone git@github.com:kosmosharry/mews-availability.js.git
   cd ./mews-availability.js
   ```

2. **Install dependencies (if any):**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Create a file named `.env.local` in the project root. This file is ignored by Git.
   ```env
   # .env.local
   MEWS_CLIENT_TOKEN="YOUR_MEWS_CLIENT_TOKEN"
   MEWS_ACCESS_TOKEN="YOUR_MEWS_ACCESS_TOKEN"
   MEWS_CONNECTOR_API_URL="https://api.mews-demo.com" # Or the production URL
   MEWS_SERVICE_ID="YOUR_STAY_SERVICE_ID"
   ```

## Local Development & Testing

1. **Start the local development server:**
   ```bash
   vercel dev
   ```

2. **Test the endpoint:**
   Use a tool like curl or Postman to send a POST request to the local server.
   ```bash
   curl -X POST http://localhost:3000/api/mews-availability \
        -H "Content-Type: application/json" \
        -d '{"villaId": "YOUR_VILLA_ID", "startDate": "2025-04-01", "endDate": "2025-05-31"}'
   ```

## Deployment

1. **Deploy to Vercel:**
   ```bash
   vercel --prod
   ```

2. **Set Environment Variables in Vercel:**
   Go to your project's dashboard on Vercel and navigate to "Settings" -> "Environment Variables" to add the same secrets from your `.env.local` file. This ensures the deployed function has access to the Mews API credentials.

## Usage Example (from a Frontend Application)

A frontend application would consume this API using a fetch request.

```javascript
async function fetchUnavailableDates(villaId, startDate, endDate) {
    // The full URL of your deployed Vercel function
    const apiUrl = 'https://your-app-name.vercel.app/api/mews-availability';

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ villaId, startDate, endDate }),
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        return data.unavailable || []; // Returns ["YYYY-MM-DD", ...]
    } catch (error) {
        console.error("Failed to fetch availability:", error);
        return []; // Return empty array on failure
    }
}
```

## Technology Stack

- **Runtime:** Vercel Serverless Functions
- **Language:** Node.js
