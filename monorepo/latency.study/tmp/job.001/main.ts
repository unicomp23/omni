// deno-lint-ignore-file no-explicit-any
import { encode as base64Encode } from "https://deno.land/std@0.177.0/encoding/base64.ts";
import { parse as csvParse } from "https://deno.land/std@0.177.0/encoding/csv.ts";

// Sumo Logic API configuration
const SUMO_API_ENDPOINT = "https://api.sumologic.com/api/v1";
let SUMO_ACCESS_ID: string;
let SUMO_ACCESS_KEY: string;

function getCredentials() {
    SUMO_ACCESS_ID = Deno.env.get("SUMO_ACCESS_ID") || "";
    SUMO_ACCESS_KEY = Deno.env.get("SUMO_ACCESS_KEY") || "";

    if (!SUMO_ACCESS_ID) {
        SUMO_ACCESS_ID = prompt("Enter your Sumo Logic Access ID:") || "";
    }
    if (!SUMO_ACCESS_KEY) {
        SUMO_ACCESS_KEY = prompt("Enter your Sumo Logic Access Key:") || "";
    }

    if (!SUMO_ACCESS_ID || !SUMO_ACCESS_KEY) {
        throw new Error("Sumo Logic credentials are required.");
    }
}

async function createSearchJob(query: string, fromTime: string, toTime: string): Promise<string> {
    const url = `${SUMO_API_ENDPOINT}/search/jobs`;
    const headers = new Headers({
        "Authorization": `Basic ${base64Encode(`${SUMO_ACCESS_ID}:${SUMO_ACCESS_KEY}`)}`,
        "Content-Type": "application/json",
    });

    const body = JSON.stringify({
        query,
        from: fromTime,
        to: toTime,
        timeZone: "UTC", // Explicitly set timezone to UTC
    });

    console.log("Creating search job with parameters:", { query, fromTime, toTime });

    const response = await fetch(url, {
        method: "POST",
        headers,
        body,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create search job: ${response.statusText}. Error: ${errorText}`);
    }

    const data = await response.json();
    return data.id;
}

async function getJobStatus(jobId: string): Promise<string> {
    const url = `${SUMO_API_ENDPOINT}/search/jobs/${jobId}`;
    const headers = new Headers({
        "Authorization": `Basic ${base64Encode(`${SUMO_ACCESS_ID}:${SUMO_ACCESS_KEY}`)}`,
    });

    const response = await fetch(url, { headers });

    if (!response.ok) {
        throw new Error(`Failed to get job status: ${response.statusText}`);
    }

    const data = await response.json();
    return data.state;
}

async function getJobResults(jobId: string): Promise<any> {
    const url = `${SUMO_API_ENDPOINT}/search/jobs/${jobId}/messages?offset=0&limit=10000`;
    const headers = new Headers({
        "Authorization": `Basic ${base64Encode(`${SUMO_ACCESS_ID}:${SUMO_ACCESS_KEY}`)}`,
    });

    const response = await fetch(url, { headers });

    if (!response.ok) {
        throw new Error(`Failed to get job results: ${response.statusText}`);
    }

    return await response.json();
}

function parseUTCDate(dateString: string): Date {
    if (!dateString) {
        throw new Error("Invalid date string: empty or undefined");
    }

    // Regular expression to match the date string format
    const regex = /^([A-Za-z]{3}) (\d{1,2}) at (\d{1,2}):(\d{2}) (AM|PM)$/;
    const match = dateString.match(regex);

    if (!match) {
        throw new Error(`Invalid date string format: ${dateString}`);
    }

    const [_, monthStr, dayStr, hourStr, minuteStr, meridiem] = match;

    const monthIndex = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ].indexOf(monthStr);

    if (monthIndex === -1) {
        throw new Error(`Invalid month: ${monthStr}`);
    }

    let year = new Date().getFullYear();
    let hours = parseInt(hourStr, 10);
    const minutes = parseInt(minuteStr, 10);
    const day = parseInt(dayStr, 10);

    // Adjust hours based on 'AM'/'PM'
    if (meridiem === 'PM' && hours !== 12) {
        hours += 12;
    } else if (meridiem === 'AM' && hours === 12) {
        hours = 0;
    }

    let parsedDate = new Date(Date.UTC(year, monthIndex, day, hours, minutes));

    // If the parsed date is in the future, assume it's from the previous year
    if (parsedDate > new Date()) {
        year--;
        parsedDate = new Date(Date.UTC(year, monthIndex, day, hours, minutes));
    }

    return parsedDate;
}

async function main() {
    await getCredentials();

    const csvContent = await Deno.readTextFile("./pager.duty.stage.alerts.csv");
    const lines = csvContent.split('\n').slice(1); // Skip the header row

    for (const line of lines) {
        const fields = line.split(',');
        if (fields.length < 7) {
            console.error("Skipping record due to insufficient fields:", line);
            continue;
        }

        try {
            const utcTimestamp = parseUTCDate(fields[6].trim());
            const fromTime = new Date(utcTimestamp.getTime() - 4 * 60 * 1000).toISOString();
            const toTime = utcTimestamp.toISOString();

            console.log("Processing record:", fields);
            console.log("Parsed UTC timestamp:", utcTimestamp.toISOString());
            console.log("From time:", fromTime);
            console.log("To time:", toTime);

            const query = `_index=media_infrequent _collector=*yosemite*stage* "WRITEHEAD"
            | parse "POST /* id*start=* *msec" as endpoint, trash1, trash2, msec
            | timeslice 4m
            | avg(msec) as avg_msec, count as count by endpoint, _timeslice`;

            const jobId = await createSearchJob(query, fromTime, toTime);
            console.log(`Search job created with ID: ${jobId} for timestamp ${toTime}`);

            let jobStatus;
            let retryCount = 0;
            const maxRetries = 30; // Maximum number of retries (2.5 minutes)

            do {
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for 5 seconds
                jobStatus = await getJobStatus(jobId);
                console.log(`Job status: ${jobStatus}`);
                retryCount++;

                if (retryCount >= maxRetries) {
                    console.error(`Job ${jobId} did not complete within the expected time. Current status: ${jobStatus}`);
                    break;
                }
            } while (jobStatus !== "DONE GATHERING RESULTS");

            if (jobStatus === "DONE GATHERING RESULTS") {
                const results = await getJobResults(jobId);
                console.log(`Results for timestamp ${toTime}:`);
                console.log(JSON.stringify(results, null, 2));
            }

            // Optional: Delete the search job to free up resources
            // await deleteSearchJob(jobId);
        } catch (error) {
            console.error(`Error processing record:`, fields, error.message);
        }
    }
}

// Optional: Implement a function to delete the search job
async function deleteSearchJob(jobId: string): Promise<void> {
    const url = `${SUMO_API_ENDPOINT}/search/jobs/${jobId}`;
    const headers = new Headers({
        "Authorization": `Basic ${base64Encode(`${SUMO_ACCESS_ID}:${SUMO_ACCESS_KEY}`)}`,
    });

    const response = await fetch(url, { 
        method: 'DELETE',
        headers 
    });

    if (!response.ok) {
        console.error(`Failed to delete search job ${jobId}: ${response.statusText}`);
    } else {
        console.log(`Successfully deleted search job ${jobId}`);
    }
}

// Run the main function
main();

