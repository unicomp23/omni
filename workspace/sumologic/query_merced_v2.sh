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

# Create JSON payload file
cat > /tmp/sumo_query.json <<'EOF'
{
  "query": "_sourceCategory=*prod* merced (error OR outage OR unavailable OR timeout OR \"connection refused\" OR \"service unavailable\" OR \"unable to connect\" OR \"network error\" OR aws OR 503 OR 504 OR 502) | fields _raw, _sourceCategory, _sourceHost, _messageTime | sort by _messageTime desc | limit 500",
  "from": FROM_TIMESTAMP,
  "to": TO_TIMESTAMP,
  "timeZone": "UTC"
}
EOF

# Replace timestamps
sed -i "s/FROM_TIMESTAMP/${FROM_TIME}/" /tmp/sumo_query.json
sed -i "s/TO_TIMESTAMP/${TO_TIME}/" /tmp/sumo_query.json

echo "Creating search job..."
CREATE_RESPONSE=$(curl -s -X POST "https://api.sumologic.com/api/v1/search/jobs" \
  -u "${ACCESS_ID}:${ACCESS_KEY}" \
  -H "Content-Type: application/json" \
  -d @/tmp/sumo_query.json)

JOB_ID=$(echo "$CREATE_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

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

  STATE=$(echo "$STATUS_RESPONSE" | grep -o '"state":"[^"]*"' | head -1 | cut -d'"' -f4)
  MSG_COUNT=$(echo "$STATUS_RESPONSE" | grep -o '"messageCount":[0-9]*' | head -1 | cut -d':' -f2)

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
RESULTS=$(curl -s -X GET "https://api.sumologic.com/api/v1/search/jobs/${JOB_ID}/messages?offset=0&limit=500" \
  -u "${ACCESS_ID}:${ACCESS_KEY}")

# Save results to file
echo "$RESULTS" > merced_outage_results.json
echo "Full results saved to: merced_outage_results.json"

# Parse and display results
echo ""
echo "================================================================================"
echo "POTENTIAL AWS OUTAGE INDICATORS FOR MERCED HOSTS (PROD) - Last 24 Hours"
echo "================================================================================"
echo ""

# Extract and display using Python
python3 << 'PYEOF'
import json
from datetime import datetime

try:
    with open('merced_outage_results.json', 'r') as f:
        data = json.load(f)

    messages = data.get('messages', [])
    print(f'Total messages found: {len(messages)}\n')

    if len(messages) == 0:
        print('No matching entries found.')
    else:
        for i, msg in enumerate(messages[:30], 1):  # Show first 30
            fields = msg.get('map', {})
            raw = fields.get('_raw', 'N/A')
            host = fields.get('_sourcehost', 'N/A')
            category = fields.get('_sourcecategory', 'N/A')
            timestamp = fields.get('_messagetime', 'N/A')

            # Convert timestamp
            if timestamp != 'N/A':
                try:
                    dt = datetime.fromtimestamp(int(timestamp) / 1000)
                    timestamp = dt.strftime('%Y-%m-%d %H:%M:%S UTC')
                except:
                    pass

            print(f'[{i}] {timestamp}')
            print(f'    Host: {host}')
            print(f'    Source: {category}')

            # Truncate long messages
            if len(raw) > 200:
                print(f'    Message: {raw[:200]}...')
            else:
                print(f'    Message: {raw}')
            print('-' * 80)

        if len(messages) > 30:
            print(f'\n... and {len(messages) - 30} more entries (see merced_outage_results.json)')

except Exception as e:
    print(f'Error parsing results: {e}')
    print('Check merced_outage_results.json for raw data')
PYEOF

# Cleanup
echo ""
echo "Cleaning up search job..."
curl -s -X DELETE "https://api.sumologic.com/api/v1/search/jobs/${JOB_ID}" \
  -u "${ACCESS_ID}:${ACCESS_KEY}" > /dev/null

echo "Done!"
