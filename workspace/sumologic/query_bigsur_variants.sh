#!/bin/bash
# Query Sumo Logic API for BigSur variants with Merced errors

# Read credentials
ACCESS_ID=$(grep access_id sumologic.creds.txt | cut -d':' -f2)
ACCESS_KEY=$(grep access_key sumologic.creds.txt | cut -d':' -f2)

# Calculate timestamps (last 12 hours in milliseconds)
TO_TIME=$(date +%s)000
FROM_TIME=$(date -d '12 hours ago' +%s)000

echo "Querying Sumo Logic for BigSur variants (trying multiple naming patterns)..."
echo "From: $(date -d @$((FROM_TIME/1000)) '+%Y-%m-%d %H:%M:%S UTC')"
echo "To:   $(date -d @$((TO_TIME/1000)) '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# Try different BigSur naming patterns
QUERIES=(
  "(big-sur OR big_sur OR \"big sur\") prod merced (error OR warning)"
  "sierra prod merced (error OR warning)"
  "monterey prod merced (error OR warning)"
  "catalina prod merced (error OR warning)"
)

QUERY_NAMES=(
  "big-sur/big_sur"
  "sierra"
  "monterey"
  "catalina"
)

for i in "${!QUERIES[@]}"; do
  QUERY="${QUERIES[$i]}"
  NAME="${QUERY_NAMES[$i]}"

  echo "----------------------------------------"
  echo "Trying pattern: $NAME"
  echo "Query: $QUERY"
  echo ""

  # Create query JSON
  cat > /tmp/sumo_query_variant.json <<EOF
{
  "query": "$QUERY | limit 100",
  "from": $FROM_TIME,
  "to": $TO_TIME,
  "timeZone": "UTC"
}
EOF

  # Create search job
  CREATE_RESPONSE=$(curl -s -X POST "https://api.sumologic.com/api/v1/search/jobs" \
    -u "${ACCESS_ID}:${ACCESS_KEY}" \
    -H "Content-Type: application/json" \
    -d @/tmp/sumo_query_variant.json)

  JOB_ID=$(echo "$CREATE_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [ -z "$JOB_ID" ]; then
    echo "Error creating search job"
    continue
  fi

  # Wait for completion (shorter timeout)
  MAX_ATTEMPTS=20
  ATTEMPT=0
  while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    STATUS_RESPONSE=$(curl -s -X GET "https://api.sumologic.com/api/v1/search/jobs/${JOB_ID}" \
      -u "${ACCESS_ID}:${ACCESS_KEY}")

    STATE=$(echo "$STATUS_RESPONSE" | grep -o '"state":"[^"]*"' | head -1 | cut -d'"' -f4)
    MSG_COUNT=$(echo "$STATUS_RESPONSE" | grep -o '"messageCount":[0-9]*' | head -1 | cut -d':' -f2)

    if [ "$STATE" = "DONE GATHERING RESULTS" ]; then
      echo "Found: ${MSG_COUNT:-0} messages"

      if [ "${MSG_COUNT:-0}" -gt 0 ]; then
        # Retrieve and show sample
        RESULTS=$(curl -s -X GET "https://api.sumologic.com/api/v1/search/jobs/${JOB_ID}/messages?offset=0&limit=5" \
          -u "${ACCESS_ID}:${ACCESS_KEY}")

        echo "$RESULTS" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    messages = data.get('messages', [])
    for msg in messages[:3]:
        fields = msg.get('map', {})
        raw = fields.get('_raw', '')
        host = fields.get('_sourcehost', 'N/A')
        print(f'  Host: {host}')
        print(f'  Message: {raw[:150]}...')
        print()
except: pass
" 2>/dev/null
      fi

      curl -s -X DELETE "https://api.sumologic.com/api/v1/search/jobs/${JOB_ID}" \
        -u "${ACCESS_ID}:${ACCESS_KEY}" > /dev/null
      break
    fi

    sleep 2
    ATTEMPT=$((ATTEMPT + 1))
  done

  echo ""
done

# Now try a broader query to find what hosts exist
echo "========================================================================"
echo "Searching for any hosts that might be BigSur-related..."
echo ""

cat > /tmp/sumo_host_search.json <<EOF
{
  "query": "prod merced error | fields _sourceHost | count by _sourceHost | sort by _count desc | limit 20",
  "from": $FROM_TIME,
  "to": $TO_TIME,
  "timeZone": "UTC"
}
EOF

CREATE_RESPONSE=$(curl -s -X POST "https://api.sumologic.com/api/v1/search/jobs" \
  -u "${ACCESS_ID}:${ACCESS_KEY}" \
  -H "Content-Type: application/json" \
  -d @/tmp/sumo_host_search.json)

JOB_ID=$(echo "$CREATE_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$JOB_ID" ]; then
  echo "Finding top hosts with Merced errors..."

  MAX_ATTEMPTS=30
  ATTEMPT=0
  while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    STATUS_RESPONSE=$(curl -s -X GET "https://api.sumologic.com/api/v1/search/jobs/${JOB_ID}" \
      -u "${ACCESS_ID}:${ACCESS_KEY}")

    STATE=$(echo "$STATUS_RESPONSE" | grep -o '"state":"[^"]*"' | head -1 | cut -d'"' -f4)
    RECORD_COUNT=$(echo "$STATUS_RESPONSE" | grep -o '"recordCount":[0-9]*' | head -1 | cut -d':' -f2)

    if [ "$STATE" = "DONE GATHERING RESULTS" ]; then
      echo "Found ${RECORD_COUNT:-0} unique hosts"

      if [ "${RECORD_COUNT:-0}" -gt 0 ]; then
        RECORDS=$(curl -s -X GET "https://api.sumologic.com/api/v1/search/jobs/${JOB_ID}/records?offset=0&limit=20" \
          -u "${ACCESS_ID}:${ACCESS_KEY}")

        echo ""
        echo "Top hosts with Merced errors:"
        echo "$RECORDS" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    records = data.get('records', [])
    for record in records:
        fields = record.get('map', {})
        host = fields.get('_sourcehost', 'N/A')
        count = fields.get('_count', 0)
        print(f'  {host}: {count} errors')
except: pass
" 2>/dev/null
      fi

      curl -s -X DELETE "https://api.sumologic.com/api/v1/search/jobs/${JOB_ID}" \
        -u "${ACCESS_ID}:${ACCESS_KEY}" > /dev/null
      break
    fi

    sleep 2
    ATTEMPT=$((ATTEMPT + 1))
  done
fi

echo ""
echo "Done!"
