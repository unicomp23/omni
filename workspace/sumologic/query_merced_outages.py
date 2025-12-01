#!/usr/bin/env python3
"""
Query Sumo Logic API for Merced hosts indicating possible AWS outages
"""

import requests
import json
import time
from datetime import datetime, timedelta
import sys

# Read credentials
with open('sumologic.creds.txt', 'r') as f:
    lines = f.readlines()
    access_id = lines[0].split(':')[1].strip()
    access_key = lines[1].split(':')[1].strip()

# Sumo Logic API endpoint
SUMO_API_URL = "https://api.sumologic.com/api/v1"

# Calculate time range (last 24 hours)
end_time = datetime.utcnow()
start_time = end_time - timedelta(hours=24)

# Convert to milliseconds since epoch
to_timestamp = int(end_time.timestamp() * 1000)
from_timestamp = int(start_time.timestamp() * 1000)

print(f"Querying from {start_time.isoformat()} to {end_time.isoformat()}")
print(f"Time range: {from_timestamp} to {to_timestamp}\n")

# Search query for Merced hosts with potential AWS outage indicators
search_query = """
_sourceCategory=*prod* merced
(error OR outage OR unavailable OR timeout OR "connection refused" OR "service unavailable"
 OR "unable to connect" OR "network error" OR "aws" OR "503" OR "504" OR "502")
| where _sourceCategory matches "*prod*"
| fields _raw, _sourceCategory, _sourceHost, _messageTime
| sort by _messageTime desc
| limit 1000
"""

# Create search job
print("Creating search job...")
search_url = f"{SUMO_API_URL}/search/jobs"
search_payload = {
    "query": search_query,
    "from": from_timestamp,
    "to": to_timestamp,
    "timeZone": "UTC"
}

response = requests.post(
    search_url,
    auth=(access_id, access_key),
    headers={'Content-Type': 'application/json'},
    json=search_payload
)

if response.status_code != 202:
    print(f"Error creating search job: {response.status_code}")
    print(response.text)
    sys.exit(1)

search_job = response.json()
job_id = search_job['id']
print(f"Search job created: {job_id}")

# Poll for job completion
status_url = f"{SUMO_API_URL}/search/jobs/{job_id}"
print("Waiting for search job to complete...")

while True:
    status_response = requests.get(
        status_url,
        auth=(access_id, access_key)
    )

    if status_response.status_code != 200:
        print(f"Error checking job status: {status_response.status_code}")
        print(status_response.text)
        sys.exit(1)

    status_data = status_response.json()
    state = status_data['state']

    print(f"Job state: {state} (Message count: {status_data.get('messageCount', 0)})")

    if state == 'DONE GATHERING RESULTS':
        break
    elif state == 'CANCELLED' or state == 'FAILED':
        print(f"Search job {state}")
        sys.exit(1)

    time.sleep(2)

# Retrieve results
print("\nRetrieving results...")
results_url = f"{SUMO_API_URL}/search/jobs/{job_id}/messages"
results_response = requests.get(
    results_url,
    auth=(access_id, access_key),
    params={'offset': 0, 'limit': 1000}
)

if results_response.status_code != 200:
    print(f"Error retrieving results: {results_response.status_code}")
    print(results_response.text)
    sys.exit(1)

results = results_response.json()
messages = results.get('messages', [])

print(f"\nFound {len(messages)} potential AWS outage indicators for Merced hosts\n")
print("=" * 100)

# Process and display results
for i, msg in enumerate(messages, 1):
    fields = msg.get('map', {})
    raw_message = fields.get('_raw', 'N/A')
    source_category = fields.get('_sourcecategory', 'N/A')
    source_host = fields.get('_sourcehost', 'N/A')
    message_time = fields.get('_messagetime', 'N/A')

    # Convert timestamp if available
    if message_time != 'N/A':
        try:
            msg_dt = datetime.fromtimestamp(int(message_time) / 1000)
            message_time = msg_dt.strftime('%Y-%m-%d %H:%M:%S UTC')
        except:
            pass

    print(f"\n[{i}] Time: {message_time}")
    print(f"    Host: {source_host}")
    print(f"    Source: {source_category}")
    print(f"    Message: {raw_message[:200]}{'...' if len(raw_message) > 200 else ''}")
    print("-" * 100)

# Save full results to file
output_file = 'merced_outage_results.json'
with open(output_file, 'w') as f:
    json.dump(results, f, indent=2)

print(f"\nFull results saved to: {output_file}")

# Delete search job
print(f"\nCleaning up search job {job_id}...")
requests.delete(status_url, auth=(access_id, access_key))
print("Done!")
