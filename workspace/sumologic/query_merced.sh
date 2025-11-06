#!/bin/bash
# Query Sumo Logic API for Merced hosts indicating possible AWS outages

# Read credentials
ACCESS_ID=$(grep access_id sumologic.creds.txt | cut -d':' -f2)
ACCESS_KEY=$(grep access_key sumologic.creds.txt | cut -d':' -f2)

# Calculate timestamps (last 24 hours in milliseconds)
TO_TIME=$(date +%s)000
FROM_TIME=$(date -d '24 hours ago' +%s)000

echo "Querying Sumo Logic for Merced outage indicators (last 24 hours)"
echo "From: $(date -d @$((FROM_TIME/1000)) '+%Y-%m-%d %H:%M:%S UTC')"
echo "To:   $(date -d @$((TO_TIME/1000)) '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# Search query for Merced hosts with AWS outage indicators
QUERY='_sourceCategory=*prod* merced (error OR outage OR unavailable OR timeout OR "connection refused" OR "service unavailable" OR "unable to connect" OR "network error" OR "aws" OR "503" OR "504" OR "502") | where _sourceCategory matches "*prod*" | fields _raw, _sourceCategory, _sourceHost, _messageTime | sort by _messageTime desc | limit 1000'

# Create search job
echo "Creating search job..."
CREATE_RESPONSE=$(curl -s -X POST "https://api.sumologic.com/api/v1/search/jobs" \
  -u "${ACCESS_ID}:${ACCESS_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"${QUERY}\",
    \"from\": ${FROM_TIME},
    \"to\": ${TO_TIME},
    \"timeZone\": \"UTC\"
  }")

JOB_ID=$(echo "$CREATE_RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

if [ -z "$JOB_ID" ]; then
  echo "Error creating search job:"
  echo "$CREATE_RESPONSE"
  exit 1
fi

echo "Job ID: $JOB_ID"
echo "Waiting for job to complete..."

# Poll for completion
MAX_ATTEMPTS=60
ATTEMPT=0
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  STATUS_RESPONSE=$(curl -s -X GET "https://api.sumologic.com/api/v1/search/jobs/${JOB_ID}" \
    -u "${ACCESS_ID}:${ACCESS_KEY}")

  STATE=$(echo "$STATUS_RESPONSE" | grep -o '"state":"[^"]*"' | cut -d'"' -f4)
  MSG_COUNT=$(echo "$STATUS_RESPONSE" | grep -o '"messageCount":[0-9]*' | cut -d':' -f2)

  echo "State: $STATE (Messages: ${MSG_COUNT:-0})"

  if [ "$STATE" = "DONE GATHERING RESULTS" ]; then
    break
  elif [ "$STATE" = "CANCELLED" ] || [ "$STATE" = "FAILED" ]; then
    echo "Search job $STATE"
    exit 1
  fi

  sleep 3
  ATTEMPT=$((ATTEMPT + 1))
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
  echo "Timeout waiting for search job"
  exit 1
fi

# Retrieve results
echo ""
echo "Retrieving results..."
RESULTS=$(curl -s -X GET "https://api.sumologic.com/api/v1/search/jobs/${JOB_ID}/messages?offset=0&limit=1000" \
  -u "${ACCESS_ID}:${ACCESS_KEY}")

# Save results to file
echo "$RESULTS" > merced_outage_results.json
echo "Full results saved to: merced_outage_results.json"

# Parse and display results
echo ""
echo "================================================================================"
echo "POTENTIAL AWS OUTAGE INDICATORS FOR MERCED HOSTS (PROD)"
echo "================================================================================"
echo ""

# Extract message count
TOTAL_MESSAGES=$(echo "$RESULTS" | grep -o '"messages":\[' | wc -l)
echo "Found entries: Check merced_outage_results.json for full details"
echo ""

# Pretty print sample results
echo "$RESULTS" | python3 -c "
import sys
import json
try:
    data = json.load(sys.stdin)
    messages = data.get('messages', [])
    print(f'Total messages found: {len(messages)}')
    print()
    for i, msg in enumerate(messages[:20], 1):  # Show first 20
        fields = msg.get('map', {})
        raw = fields.get('_raw', 'N/A')
        host = fields.get('_sourcehost', 'N/A')
        category = fields.get('_sourcecategory', 'N/A')
        timestamp = fields.get('_messagetime', 'N/A')

        # Convert timestamp
        if timestamp != 'N/A':
            from datetime import datetime
            try:
                dt = datetime.fromtimestamp(int(timestamp) / 1000)
                timestamp = dt.strftime('%Y-%m-%d %H:%M:%S UTC')
            except:
                pass

        print(f'[{i}] {timestamp}')
        print(f'    Host: {host}')
        print(f'    Source: {category}')
        print(f'    Message: {raw[:150]}...')
        print('-' * 80)
        print()

    if len(messages) > 20:
        print(f'... and {len(messages) - 20} more entries (see merced_outage_results.json)')
except Exception as e:
    print(f'Error parsing results: {e}')
    print('Check merced_outage_results.json for raw data')
" 2>/dev/null || echo "Install python3 to parse results, or check merced_outage_results.json manually"

# Cleanup
echo ""
echo "Cleaning up search job..."
curl -s -X DELETE "https://api.sumologic.com/api/v1/search/jobs/${JOB_ID}" \
  -u "${ACCESS_ID}:${ACCESS_KEY}" > /dev/null

echo "Done!"
