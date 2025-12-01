#!/bin/bash
# Query Sumo Logic API for eng + big sur + merced endpoint errors

# Read credentials
ACCESS_ID=$(grep access_id sumologic.creds.txt | cut -d':' -f2)
ACCESS_KEY=$(grep access_key sumologic.creds.txt | cut -d':' -f2)

# Calculate timestamps (last 12 hours in milliseconds)
TO_TIME=$(date +%s)000
FROM_TIME=$(date -d '12 hours ago' +%s)000

echo "Querying Sumo Logic for 'eng' + 'big sur' + Merced errors (last 12 hours)"
echo "From: $(date -d @$((FROM_TIME/1000)) '+%Y-%m-%d %H:%M:%S UTC')"
echo "To:   $(date -d @$((TO_TIME/1000)) '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# Query for eng + bigsur/big sur + merced
cat > /tmp/sumo_eng_bigsur.json <<'EOF'
{
  "query": "(eng OR engineering) (bigsur OR big-sur OR \"big sur\") merced (error OR warning OR timeout OR failed OR unavailable) | fields _raw, _sourceCategory, _sourceHost, _messageTime | sort by _messageTime desc | limit 500",
  "from": FROM_TIMESTAMP,
  "to": TO_TIMESTAMP,
  "timeZone": "UTC"
}
EOF

sed -i "s/FROM_TIMESTAMP/${FROM_TIME}/" /tmp/sumo_eng_bigsur.json
sed -i "s/TO_TIMESTAMP/${TO_TIME}/" /tmp/sumo_eng_bigsur.json

echo "Creating search job..."
CREATE_RESPONSE=$(curl -s -X POST "https://api.sumologic.com/api/v1/search/jobs" \
  -u "${ACCESS_ID}:${ACCESS_KEY}" \
  -H "Content-Type: application/json" \
  -d @/tmp/sumo_eng_bigsur.json)

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
echo "$RESULTS" > eng_bigsur_merced_errors.json
echo "Results saved to: eng_bigsur_merced_errors.json"

# Display results
echo ""
echo "================================================================================"
echo "ENG + BIG SUR + MERCED ENDPOINT ERRORS (Last 12 Hours)"
echo "================================================================================"
echo ""

python3 << 'PYEOF'
import json
import re
from datetime import datetime
from collections import Counter, defaultdict

try:
    with open('eng_bigsur_merced_errors.json', 'r') as f:
        data = json.load(f)

    messages = data.get('messages', [])

    if len(messages) == 0:
        print('No errors found for "eng + big sur + merced" combination.')
        print('\nTrying individual searches to narrow down...')
    else:
        print(f'Found {len(messages)} error entries:\n')

        # Categorize errors
        error_types = Counter()
        hosts = Counter()
        sources = Counter()
        endpoints = Counter()
        time_distribution = defaultdict(int)
        detailed_errors = []

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

            # Extract Merced endpoint
            endpoint_match = re.search(r'merced[^\s]*\.(prod|com)[^\s]*(:\d+)?(/[^\s]+)?', raw, re.IGNORECASE)
            if endpoint_match:
                endpoints[endpoint_match.group(0)] += 1

            # Categorize error types
            raw_lower = raw.lower()
            if 'bad file' in raw_lower or 'request send error' in raw_lower:
                error_types['Connection Errors (Bad FD)'] += 1
            elif 'timeout' in raw_lower or 'timed out' in raw_lower:
                error_types['Timeout Errors'] += 1
            elif 'connection refused' in raw_lower or 'econnrefused' in raw_lower:
                error_types['Connection Refused'] += 1
            elif 'unavailable' in raw_lower or '503' in raw:
                error_types['Service Unavailable (503)'] += 1
            elif 'failed' in raw_lower and 'public-key' in raw_lower:
                error_types['Public Key Failures'] += 1
            elif '500' in raw or '502' in raw or '504' in raw:
                error_types['HTTP 5xx Errors'] += 1
            elif 'warning' in raw_lower:
                error_types['Warnings'] += 1
            elif 'error' in raw_lower:
                error_types['General Errors'] += 1
            else:
                error_types['Other'] += 1

            detailed_errors.append({
                'raw': raw,
                'host': host,
                'source': source,
                'timestamp': timestamp
            })

        # Display statistics
        print('ERROR CATEGORIES:')
        print('=' * 80)
        for error_type, count in error_types.most_common():
            percentage = count * 100 / len(messages)
            print(f'  {error_type}: {count} ({percentage:.1f}%)')
        print()

        print('TOP AFFECTED HOSTS:')
        print('=' * 80)
        for host, count in hosts.most_common(15):
            print(f'  {host}: {count} errors')
        print()

        print('SOURCE CATEGORIES:')
        print('=' * 80)
        for source, count in sources.most_common(10):
            print(f'  {source}: {count}')
        print()

        if endpoints:
            print('MERCED ENDPOINTS AFFECTED:')
            print('=' * 80)
            for endpoint, count in endpoints.most_common(10):
                print(f'  {endpoint}: {count} errors')
            print()

        print('HOURLY DISTRIBUTION:')
        print('=' * 80)
        for hour in sorted(time_distribution.keys()):
            count = time_distribution[hour]
            if time_distribution:
                bar = '█' * min(int(count / max(time_distribution.values()) * 50), 50)
            else:
                bar = ''
            print(f'{hour}: {bar} ({count})')
        print()

        # Show sample errors
        print('DETAILED ERROR MESSAGES:')
        print('=' * 80)
        for i, error in enumerate(detailed_errors[:20], 1):
            timestamp = error['timestamp']
            if timestamp != 'N/A':
                try:
                    dt = datetime.fromtimestamp(int(timestamp) / 1000)
                    timestamp = dt.strftime('%Y-%m-%d %H:%M:%S UTC')
                except:
                    pass

            print(f'\n[{i}] {timestamp}')
            print(f'    Host: {error["host"]}')
            print(f'    Source: {error["source"]}')

            raw = error['raw']
            if len(raw) > 300:
                print(f'    Message: {raw[:300]}...')
            else:
                print(f'    Message: {raw}')
            print('-' * 80)

        if len(detailed_errors) > 20:
            print(f'\n... and {len(detailed_errors) - 20} more errors')

        # Key insights
        print('\n\n')
        print('KEY INSIGHTS:')
        print('=' * 80)

        connection_errors = error_types.get('Connection Errors (Bad FD)', 0)
        timeout_errors = error_types.get('Timeout Errors', 0)
        pubkey_errors = error_types.get('Public Key Failures', 0)

        if connection_errors > 0:
            print(f'• {connection_errors} connection failures (Bad file descriptor)')
            print('  - Hosts unable to reach Merced endpoint')

        if timeout_errors > 0:
            print(f'• {timeout_errors} timeout errors')
            print('  - Requests exceeding timeout threshold')

        if pubkey_errors > 0:
            print(f'• {pubkey_errors} public key acquisition failures')
            print('  - Authentication/token validation issues')

        if len(messages) > 10:
            print(f'\n⚠️  Total {len(messages)} errors detected')
            print('   - Eng/BigSur hosts experiencing Merced connectivity issues')

except Exception as e:
    print(f'Error: {e}')
    import traceback
    traceback.print_exc()
    print('\nCheck eng_bigsur_merced_errors.json for raw data')
PYEOF

# If no results, try alternative searches
if [ "${MSG_COUNT:-0}" -eq 0 ]; then
  echo ""
  echo "================================================================================"
  echo "No results found. Trying alternative searches..."
  echo "================================================================================"
  echo ""

  # Try just "eng" + "merced"
  echo "Searching for: eng + merced (without big sur filter)..."

  cat > /tmp/sumo_eng_only.json <<EOF
{
  "query": "(eng OR engineering) merced (error OR warning) | fields _sourceHost | count by _sourceHost | limit 50",
  "from": $FROM_TIME,
  "to": $TO_TIME,
  "timeZone": "UTC"
}
EOF

  CREATE_RESPONSE=$(curl -s -X POST "https://api.sumologic.com/api/v1/search/jobs" \
    -u "${ACCESS_ID}:${ACCESS_KEY}" \
    -H "Content-Type: application/json" \
    -d @/tmp/sumo_eng_only.json)

  JOB_ID2=$(echo "$CREATE_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [ -n "$JOB_ID2" ]; then
    sleep 5
    for i in {1..20}; do
      STATUS=$(curl -s -X GET "https://api.sumologic.com/api/v1/search/jobs/${JOB_ID2}" \
        -u "${ACCESS_ID}:${ACCESS_KEY}")

      STATE=$(echo "$STATUS" | grep -o '"state":"[^"]*"' | head -1 | cut -d'"' -f4)
      RECORDS=$(echo "$STATUS" | grep -o '"recordCount":[0-9]*' | head -1 | cut -d':' -f2)

      if [ "$STATE" = "DONE GATHERING RESULTS" ]; then
        echo "Found ${RECORDS:-0} hosts with 'eng' + 'merced' errors"

        if [ "${RECORDS:-0}" -gt 0 ]; then
          RESULTS=$(curl -s -X GET "https://api.sumologic.com/api/v1/search/jobs/${JOB_ID2}/records?offset=0&limit=50" \
            -u "${ACCESS_ID}:${ACCESS_KEY}")

          echo ""
          echo "$RESULTS" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    records = data.get('records', [])
    print('Hosts with eng + merced errors:')
    for r in records:
        fields = r.get('map', {})
        host = fields.get('_sourcehost', 'N/A')
        count = fields.get('_count', 0)
        # Check if bigsur related
        if 'big' in host.lower() or 'sur' in host.lower():
            print(f'  ⭐ {host}: {count} errors (BIGSUR-related!)')
        else:
            print(f'  {host}: {count} errors')
except: pass
" 2>/dev/null
        fi

        curl -s -X DELETE "https://api.sumologic.com/api/v1/search/jobs/${JOB_ID2}" \
          -u "${ACCESS_ID}:${ACCESS_KEY}" > /dev/null
        break
      fi

      sleep 2
    done
  fi
fi

# Cleanup
echo ""
echo "Cleaning up..."
curl -s -X DELETE "https://api.sumologic.com/api/v1/search/jobs/${JOB_ID}" \
  -u "${ACCESS_ID}:${ACCESS_KEY}" > /dev/null

echo "Done!"
