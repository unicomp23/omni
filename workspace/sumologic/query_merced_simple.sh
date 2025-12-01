#!/bin/bash
# Query Sumo Logic API for Merced hosts with simpler query (last 6 hours)

# Read credentials
ACCESS_ID=$(grep access_id sumologic.creds.txt | cut -d':' -f2)
ACCESS_KEY=$(grep access_key sumologic.creds.txt | cut -d':' -f2)

# Calculate timestamps (last 6 hours in milliseconds for faster query)
TO_TIME=$(date +%s)000
FROM_TIME=$(date -d '6 hours ago' +%s)000

echo "Querying Sumo Logic for Merced hosts (last 6 hours)"
echo "From: $(date -d @$((FROM_TIME/1000)) '+%Y-%m-%d %H:%M:%S UTC')"
echo "To:   $(date -d @$((TO_TIME/1000)) '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# Simpler query focusing on prod + merced + error/outage terms
cat > /tmp/sumo_query_simple.json <<'EOF'
{
  "query": "merced prod (aws OR outage OR unavailable OR error) | limit 100",
  "from": FROM_TIMESTAMP,
  "to": TO_TIMESTAMP,
  "timeZone": "UTC"
}
EOF

sed -i "s/FROM_TIMESTAMP/${FROM_TIME}/" /tmp/sumo_query_simple.json
sed -i "s/TO_TIMESTAMP/${TO_TIME}/" /tmp/sumo_query_simple.json

echo "Creating search job..."
CREATE_RESPONSE=$(curl -s -X POST "https://api.sumologic.com/api/v1/search/jobs" \
  -u "${ACCESS_ID}:${ACCESS_KEY}" \
  -H "Content-Type: application/json" \
  -d @/tmp/sumo_query_simple.json)

JOB_ID=$(echo "$CREATE_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$JOB_ID" ]; then
  echo "Error creating search job:"
  echo "$CREATE_RESPONSE"
  exit 1
fi

echo "Job ID: $JOB_ID"
echo "Waiting for job to complete..."

# Poll for completion (reduced timeout)
MAX_ATTEMPTS=40
ATTEMPT=0
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  STATUS_RESPONSE=$(curl -s -X GET "https://api.sumologic.com/api/v1/search/jobs/${JOB_ID}" \
    -u "${ACCESS_ID}:${ACCESS_KEY}")

  STATE=$(echo "$STATUS_RESPONSE" | grep -o '"state":"[^"]*"' | head -1 | cut -d'"' -f4)
  MSG_COUNT=$(echo "$STATUS_RESPONSE" | grep -o '"messageCount":[0-9]*' | head -1 | cut -d':' -f2)

  if [ $((ATTEMPT % 5)) -eq 0 ]; then
    echo "State: $STATE (Messages: ${MSG_COUNT:-0})"
  fi

  if [ "$STATE" = "DONE GATHERING RESULTS" ]; then
    echo "Job completed with ${MSG_COUNT:-0} messages"
    break
  elif [ "$STATE" = "CANCELLED" ] || [ "$STATE" = "FAILED" ]; then
    echo "Search job $STATE"
    echo "Response: $STATUS_RESPONSE"
    exit 1
  fi

  sleep 2
  ATTEMPT=$((ATTEMPT + 1))
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
  echo "Query taking too long. Checking partial results..."
fi

# Retrieve results
echo ""
echo "Retrieving results..."
RESULTS=$(curl -s -X GET "https://api.sumologic.com/api/v1/search/jobs/${JOB_ID}/messages?offset=0&limit=100" \
  -u "${ACCESS_ID}:${ACCESS_KEY}")

# Save results
echo "$RESULTS" > merced_results.json
echo "Results saved to: merced_results.json"

# Display results
echo ""
echo "================================================================================"
echo "MERCED HOSTS - AWS/OUTAGE INDICATORS (Last 6 Hours)"
echo "================================================================================"
echo ""

python3 << 'PYEOF'
import json
from datetime import datetime

try:
    with open('merced_results.json', 'r') as f:
        data = json.load(f)

    messages = data.get('messages', [])

    if len(messages) == 0:
        print('No matching entries found in the last 6 hours.')
        print('\nThis could mean:')
        print('  - No AWS outages detected for Merced hosts')
        print('  - Query parameters need adjustment')
        print('  - Try expanding time range to 24 hours')
    else:
        print(f'Found {len(messages)} entries:\n')

        for i, msg in enumerate(messages, 1):
            fields = msg.get('map', {})
            raw = fields.get('_raw', 'N/A')
            host = fields.get('_sourcehost', 'N/A')
            category = fields.get('_sourcecategory', 'N/A')
            timestamp = fields.get('_messagetime', 'N/A')

            if timestamp != 'N/A':
                try:
                    dt = datetime.fromtimestamp(int(timestamp) / 1000)
                    timestamp = dt.strftime('%Y-%m-%d %H:%M:%S UTC')
                except:
                    pass

            print(f'[{i}] {timestamp}')
            print(f'    Host: {host}')
            print(f'    Source: {category}')

            if len(raw) > 250:
                print(f'    Message: {raw[:250]}...')
            else:
                print(f'    Message: {raw}')
            print('-' * 80)

except Exception as e:
    print(f'Error: {e}')
    print('Check merced_results.json for raw data')
PYEOF

# Cleanup
echo ""
echo "Cleaning up..."
curl -s -X DELETE "https://api.sumologic.com/api/v1/search/jobs/${JOB_ID}" \
  -u "${ACCESS_ID}:${ACCESS_KEY}" > /dev/null

echo "Done!"
