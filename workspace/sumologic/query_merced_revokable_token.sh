#!/bin/bash
# Query Sumo Logic API for Merced /token/revokable endpoint (last 12 hours)

# Read credentials
ACCESS_ID=$(grep access_id sumologic.creds.txt | cut -d':' -f2)
ACCESS_KEY=$(grep access_key sumologic.creds.txt | cut -d':' -f2)

# Calculate timestamps (last 12 hours in milliseconds)
TO_TIME=$(date +%s)000
FROM_TIME=$(date -d '12 hours ago' +%s)000

echo "Querying Sumo Logic for Merced /token/revokable endpoint (last 12 hours)"
echo "From: $(date -d @$((FROM_TIME/1000)) '+%Y-%m-%d %H:%M:%S UTC')"
echo "To:   $(date -d @$((TO_TIME/1000)) '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# Query for revokable token endpoint
cat > /tmp/sumo_revokable.json <<'EOF'
{
  "query": "merced prod /token/revokable OR token/revocable | fields _raw, _sourceCategory, _sourceHost, _messageTime | sort by _messageTime desc | limit 500",
  "from": FROM_TIMESTAMP,
  "to": TO_TIMESTAMP,
  "timeZone": "UTC"
}
EOF

sed -i "s/FROM_TIMESTAMP/${FROM_TIME}/" /tmp/sumo_revokable.json
sed -i "s/TO_TIMESTAMP/${TO_TIME}/" /tmp/sumo_revokable.json

echo "Creating search job..."
CREATE_RESPONSE=$(curl -s -X POST "https://api.sumologic.com/api/v1/search/jobs" \
  -u "${ACCESS_ID}:${ACCESS_KEY}" \
  -H "Content-Type: application/json" \
  -d @/tmp/sumo_revokable.json)

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
RESULTS=$(curl -s -X GET "https://api.sumologic.com/api/v1/search/jobs/${JOB_ID}/messages?offset=0&limit=500" \
  -u "${ACCESS_ID}:${ACCESS_KEY}")

# Save results
echo "$RESULTS" > merced_revokable_results.json
echo "Results saved to: merced_revokable_results.json"

# Display results
echo ""
echo "================================================================================"
echo "MERCED /token/revokable ENDPOINT ANALYSIS (Last 12 Hours)"
echo "================================================================================"
echo ""

python3 << 'PYEOF'
import json
import re
from datetime import datetime
from collections import Counter, defaultdict

try:
    with open('merced_revokable_results.json', 'r') as f:
        data = json.load(f)

    messages = data.get('messages', [])

    if len(messages) == 0:
        print('No entries found for /token/revokable endpoint in the last 12 hours.')
        print('\nNote: Check spelling - it might be "revocable" not "revokable"')
    else:
        print(f'Found {len(messages)} entries:\n')

        # Categorize by status/response
        status_codes = Counter()
        sources = Counter()
        hosts = Counter()
        clients = Counter()
        errors = []
        time_distribution = defaultdict(int)

        for msg in messages:
            fields = msg.get('map', {})
            raw = fields.get('_raw', '')
            host = fields.get('_sourcehost', 'unknown')
            source = fields.get('_sourcecategory', 'unknown')
            timestamp = fields.get('_messagetime', 'N/A')

            hosts[host] += 1
            sources[source] += 1

            # Extract timestamp hour
            if timestamp != 'N/A':
                try:
                    dt = datetime.fromtimestamp(int(timestamp) / 1000)
                    hour_key = dt.strftime('%Y-%m-%d %H:00')
                    time_distribution[hour_key] += 1
                except:
                    pass

            # Extract status code and client IP
            status_match = re.search(r'(\d{3})\s+(\d{3})\s+"POST', raw)
            if status_match:
                status_codes[status_match.group(1)] += 1

            client_match = re.search(r'(\d+\.\d+\.\d+\.\d+):\d+', raw)
            if client_match:
                clients[client_match.group(1)] += 1

            # Check for errors
            if any(code in raw for code in ['500', '502', '503', '504', '4', 'error', 'Error', 'timeout']):
                errors.append({
                    'raw': raw,
                    'timestamp': timestamp,
                    'host': host
                })

        # Display statistics
        print('REQUEST STATISTICS:')
        print('=' * 80)
        print(f'Total Requests: {len(messages)}')
        print()

        if status_codes:
            print('HTTP Status Codes:')
            for code, count in status_codes.most_common():
                status_name = {
                    '200': 'OK',
                    '201': 'Created',
                    '400': 'Bad Request',
                    '401': 'Unauthorized',
                    '403': 'Forbidden',
                    '404': 'Not Found',
                    '500': 'Internal Server Error',
                    '502': 'Bad Gateway',
                    '503': 'Service Unavailable',
                    '504': 'Gateway Timeout'
                }.get(code, '')
                print(f'  {code} {status_name}: {count} ({count*100/len(messages):.1f}%)')
            print()

        print('Top Client IPs:')
        for ip, count in clients.most_common(10):
            print(f'  {ip}: {count} requests')
        print()

        print('Sources:')
        for source, count in sources.most_common():
            print(f'  {source}: {count}')
        print()

        # Time distribution
        print('HOURLY DISTRIBUTION:')
        print('=' * 80)
        for hour in sorted(time_distribution.keys()):
            count = time_distribution[hour]
            bar = '█' * min(int(count / max(time_distribution.values()) * 50), 50)
            print(f'{hour}: {bar} ({count})')
        print()

        # Show errors if any
        if errors:
            print(f'ERRORS DETECTED: {len(errors)}')
            print('=' * 80)
            for i, error in enumerate(errors[:10], 1):
                timestamp = error['timestamp']
                if timestamp != 'N/A':
                    try:
                        dt = datetime.fromtimestamp(int(timestamp) / 1000)
                        timestamp = dt.strftime('%Y-%m-%d %H:%M:%S UTC')
                    except:
                        pass

                print(f'\n[{i}] {timestamp}')
                print(f'    Host: {error["host"]}')
                raw = error['raw']
                if len(raw) > 250:
                    print(f'    Message: {raw[:250]}...')
                else:
                    print(f'    Message: {raw}')

            if len(errors) > 10:
                print(f'\n... and {len(errors) - 10} more errors')
        else:
            print('✅ NO ERRORS DETECTED')
            print('=' * 80)
            print('All requests to /token/revokable completed successfully.')

        # Sample successful requests
        if len(messages) > 0 and len(errors) < len(messages):
            print('\n\nSAMPLE SUCCESSFUL REQUESTS:')
            print('=' * 80)
            success_count = 0
            for msg in messages:
                fields = msg.get('map', {})
                raw = fields.get('_raw', '')
                timestamp = fields.get('_messagetime', 'N/A')

                # Skip errors
                if any(code in raw for code in ['500', '502', '503', '504', 'error', 'Error']):
                    continue

                if timestamp != 'N/A':
                    try:
                        dt = datetime.fromtimestamp(int(timestamp) / 1000)
                        timestamp = dt.strftime('%Y-%m-%d %H:%M:%S')
                    except:
                        pass

                print(f'[{timestamp}] {raw[:200]}...')
                success_count += 1
                if success_count >= 5:
                    break

except Exception as e:
    print(f'Error: {e}')
    import traceback
    traceback.print_exc()
    print('\nCheck merced_revokable_results.json for raw data')
PYEOF

# Cleanup
echo ""
echo "Cleaning up..."
curl -s -X DELETE "https://api.sumologic.com/api/v1/search/jobs/${JOB_ID}" \
  -u "${ACCESS_ID}:${ACCESS_KEY}" > /dev/null

echo "Done!"
