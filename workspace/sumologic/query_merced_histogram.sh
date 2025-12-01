#!/bin/bash
# Query Sumo Logic API for Merced error histogram (last 12 hours)

# Read credentials
ACCESS_ID=$(grep access_id sumologic.creds.txt | cut -d':' -f2)
ACCESS_KEY=$(grep access_key sumologic.creds.txt | cut -d':' -f2)

# Calculate timestamps (last 12 hours in milliseconds)
TO_TIME=$(date +%s)000
FROM_TIME=$(date -d '12 hours ago' +%s)000

echo "Querying Sumo Logic for Merced error histogram (last 12 hours)"
echo "From: $(date -d @$((FROM_TIME/1000)) '+%Y-%m-%d %H:%M:%S UTC')"
echo "To:   $(date -d @$((TO_TIME/1000)) '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# Query with aggregation for histogram
cat > /tmp/sumo_histogram.json <<'EOF'
{
  "query": "merced prod error | timeslice 1h | count by _timeslice, _raw | sort by _count desc | limit 500",
  "from": FROM_TIMESTAMP,
  "to": TO_TIMESTAMP,
  "timeZone": "UTC"
}
EOF

sed -i "s/FROM_TIMESTAMP/${FROM_TIME}/" /tmp/sumo_histogram.json
sed -i "s/TO_TIMESTAMP/${TO_TIME}/" /tmp/sumo_histogram.json

echo "Creating search job..."
CREATE_RESPONSE=$(curl -s -X POST "https://api.sumologic.com/api/v1/search/jobs" \
  -u "${ACCESS_ID}:${ACCESS_KEY}" \
  -H "Content-Type: application/json" \
  -d @/tmp/sumo_histogram.json)

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
  RECORD_COUNT=$(echo "$STATUS_RESPONSE" | grep -o '"recordCount":[0-9]*' | head -1 | cut -d':' -f2)
  MSG_COUNT=$(echo "$STATUS_RESPONSE" | grep -o '"messageCount":[0-9]*' | head -1 | cut -d':' -f2)

  if [ $((ATTEMPT % 5)) -eq 0 ]; then
    echo "State: $STATE (Records: ${RECORD_COUNT:-0}, Messages: ${MSG_COUNT:-0})"
  fi

  if [ "$STATE" = "DONE GATHERING RESULTS" ]; then
    echo "Job completed with ${RECORD_COUNT:-0} records, ${MSG_COUNT:-0} messages"
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

# Retrieve aggregated results (records for histogram)
echo ""
echo "Retrieving histogram results..."
RECORDS=$(curl -s -X GET "https://api.sumologic.com/api/v1/search/jobs/${JOB_ID}/records?offset=0&limit=500" \
  -u "${ACCESS_ID}:${ACCESS_KEY}")

# Save results
echo "$RECORDS" > merced_histogram_records.json
echo "Records saved to: merced_histogram_records.json"

# Display histogram
echo ""
echo "================================================================================"
echo "MERCED ERROR MESSAGE HISTOGRAM (Last 12 Hours)"
echo "================================================================================"
echo ""

python3 << 'PYEOF'
import json
from datetime import datetime
from collections import defaultdict
import re

try:
    with open('merced_histogram_records.json', 'r') as f:
        data = json.load(f)

    records = data.get('records', [])

    if len(records) == 0:
        print('No aggregated records found.')
        print('Trying to analyze raw messages instead...')
    else:
        print(f'Found {len(records)} aggregated error patterns:\n')

        # Group by error pattern
        error_patterns = defaultdict(int)
        time_buckets = defaultdict(lambda: defaultdict(int))

        for record in records:
            fields = record.get('map', {})
            raw = fields.get('_raw', 'N/A')
            count = int(fields.get('_count', 1))
            timeslice = fields.get('_timeslice', 'unknown')

            # Extract key error pattern
            error_key = raw
            if len(raw) > 100:
                # Try to extract the key error message
                if 'error' in raw.lower():
                    # Find error message
                    match = re.search(r'(error[^:]*:[^,\n]{0,100})', raw, re.IGNORECASE)
                    if match:
                        error_key = match.group(1)
                    else:
                        error_key = raw[:100] + '...'
                else:
                    error_key = raw[:100] + '...'

            error_patterns[error_key] += count
            time_buckets[timeslice][error_key] += count

        # Sort by count
        sorted_errors = sorted(error_patterns.items(), key=lambda x: x[1], reverse=True)

        print('TOP ERROR MESSAGES BY FREQUENCY:')
        print('=' * 80)
        for i, (error, count) in enumerate(sorted_errors[:30], 1):
            print(f'\n[{i}] Count: {count}')
            if len(error) > 200:
                print(f'    Message: {error[:200]}...')
            else:
                print(f'    Message: {error}')

        if len(sorted_errors) > 30:
            print(f'\n... and {len(sorted_errors) - 30} more error patterns')

        # Time distribution
        print('\n\n')
        print('TIME DISTRIBUTION:')
        print('=' * 80)
        sorted_times = sorted(time_buckets.items())
        for timeslice, errors in sorted_times:
            if timeslice != 'unknown':
                try:
                    ts = datetime.fromtimestamp(int(timeslice) / 1000)
                    time_str = ts.strftime('%Y-%m-%d %H:%M')
                except:
                    time_str = str(timeslice)
            else:
                time_str = 'Unknown time'

            total = sum(errors.values())
            print(f'{time_str}: {total} errors')

except Exception as e:
    print(f'Error: {e}')
    import traceback
    traceback.print_exc()
    print('\nCheck merced_histogram_records.json for raw data')
PYEOF

# Cleanup
echo ""
echo "Cleaning up..."
curl -s -X DELETE "https://api.sumologic.com/api/v1/search/jobs/${JOB_ID}" \
  -u "${ACCESS_ID}:${ACCESS_KEY}" > /dev/null

echo "Done!"
