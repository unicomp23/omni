# Bixby-to-Master Latency Monitoring

## Overview
This document describes how to monitor and analyze latency between Bixby and Tecate Master using correlation IDs and structured logging for Sumo Logic.

## Implementation Details

### Latency IDs
- Each RegisterStream and NotifyStream request from Bixby includes a unique UUID latency ID
- The latency ID allows tracking a single request from Bixby through to Master processing
- Latency IDs are logged at key points to measure latency

### Log Points

#### Bixby Side
1. **Request Sent**: Logged when Bixby sends the request
   - Fields: `latencyId`, `streamUrl`, `startTimeMs`, `type=request_sent`
2. **Response Received**: Logged when Bixby receives the response
   - Fields: `latencyId`, `latencyMs`, `endTimeMs`, `type=response_received`

#### Master Side
1. **Request Received**: Logged when Master receives the request
   - Fields: `latencyId`, `streamUrl`, `receiveTimeMs`, `type=request_received`
2. **Processing Start**: Logged just before application business logic runs
   - Fields: `latencyId`, `streamUrl`, `processingStartMs`, `networkLatencyMs`, `type=processing_start`

## Sumo Logic Queries

### 1. RegisterStream Latency Distribution (5-minute window)
```
_sourceCategory=bixby/logs "RegisterStream COMPLETE"
| parse "latencyId=* " as latencyId
| parse "latencyMs=* " as latency
| timeslice 5m
| num(latency) as latency_ms
| min(latency_ms) as min_latency,
  max(latency_ms) as max_latency,
  avg(latency_ms) as avg_latency,
  median(latency_ms) as median_latency,
  pct(latency_ms, 25) as p25_latency,
  pct(latency_ms, 75) as p75_latency,
  pct(latency_ms, 99) as p99_latency,
  pct(latency_ms, 99.9) as p999_latency,
  pct(latency_ms, 99.99) as p9999_latency,
  count as request_count by _timeslice
| fields _timeslice, min_latency, p25_latency, median_latency, p75_latency, p99_latency, p999_latency, p9999_latency, max_latency, avg_latency, request_count
| sort by _timeslice desc
```

### 2. NotifyStream Latency Distribution (5-minute window)
```
_sourceCategory=bixby/logs "NotifyStream COMPLETE"
| parse "latencyId=* " as latencyId
| parse "latencyMs=* " as latency
| timeslice 5m
| num(latency) as latency_ms
| min(latency_ms) as min_latency,
  max(latency_ms) as max_latency,
  avg(latency_ms) as avg_latency,
  median(latency_ms) as median_latency,
  pct(latency_ms, 25) as p25_latency,
  pct(latency_ms, 75) as p75_latency,
  pct(latency_ms, 99) as p99_latency,
  pct(latency_ms, 99.9) as p999_latency,
  pct(latency_ms, 99.99) as p9999_latency,
  count as request_count by _timeslice
| fields _timeslice, min_latency, p25_latency, median_latency, p75_latency, p99_latency, p999_latency, p9999_latency, max_latency, avg_latency, request_count
| sort by _timeslice desc
```

### 3. Combined RegisterStream and NotifyStream Latency (Hourly)
```
(_sourceCategory=bixby/logs "RegisterStream COMPLETE") OR (_sourceCategory=bixby/logs "NotifyStream COMPLETE")
| parse "latencyId=* " as latencyId
| parse "latencyMs=* " as latency
| parse regex "(?<operation>RegisterStream|NotifyStream) COMPLETE"
| timeslice 1h
| num(latency) as latency_ms
| min(latency_ms) as min_latency,
  max(latency_ms) as max_latency,
  avg(latency_ms) as avg_latency,
  median(latency_ms) as median_latency,
  pct(latency_ms, 25) as p25_latency,
  pct(latency_ms, 75) as p75_latency,
  pct(latency_ms, 99) as p99_latency,
  pct(latency_ms, 99.9) as p999_latency,
  pct(latency_ms, 99.99) as p9999_latency,
  count as request_count by _timeslice, operation
| fields _timeslice, operation, min_latency, p25_latency, median_latency, p75_latency, p99_latency, p999_latency, p9999_latency, max_latency, avg_latency, request_count
| sort by _timeslice desc, operation
```

### 4. Network vs Processing Latency Analysis (Master Side)
```
_sourceCategory=tecate/master "PROCESSING"
| parse "latencyId=* " as latencyId
| parse "networkLatencyMs=* " as network_latency
| parse regex "(?<operation>RegisterStream|NotifyStream) PROCESSING"
| timeslice 5m
| num(network_latency) as network_ms
| avg(network_ms) as avg_network_latency,
  median(network_ms) as median_network_latency,
  pct(network_ms, 99) as p99_network_latency by _timeslice, operation
| fields _timeslice, operation, avg_network_latency, median_network_latency, p99_network_latency
| sort by _timeslice desc
```

### 5. Trace Individual Request (Using Correlation ID)
```
"latencyId=YOUR_LATENCY_ID_HERE"
| sort by _messagetime asc
| fields _messagetime, _raw
```

### 6. High Latency Requests (>100ms)
```
_sourceCategory=bixby/logs ("RegisterStream COMPLETE" OR "NotifyStream COMPLETE")
| parse "latencyId=* " as latencyId
| parse "latencyMs=* " as latency
| parse "streamUrl=* " as streamUrl
| parse regex "(?<operation>RegisterStream|NotifyStream) COMPLETE"
| where num(latency) > 100
| fields _messagetime, operation, latencyId, streamUrl, latency
| sort by latency desc
```

### 7. Latency Trend Over Time
```
_sourceCategory=bixby/logs ("RegisterStream COMPLETE" OR "NotifyStream COMPLETE")
| parse "latencyMs=* " as latency
| parse regex "(?<operation>RegisterStream|NotifyStream) COMPLETE"
| timeslice 15m
| num(latency) as latency_ms
| avg(latency_ms) as avg_latency,
  pct(latency_ms, 50) as median_latency,
  pct(latency_ms, 99) as p99_latency by _timeslice, operation
| transpose row _timeslice column operation
```

## Dashboard Setup

### Recommended Panels
1. **Latency Heatmap**: Shows distribution of latencies over time
2. **Percentile Chart**: Line chart showing p50, p75, p99, p99.9 over time
3. **Request Volume**: Bar chart showing request count per time period
4. **High Latency Alert Table**: Table of requests exceeding SLA thresholds
5. **Network vs Processing Split**: Stacked bar showing breakdown of latency components

### Alert Configuration
Set up alerts for:
- P99 latency > 200ms sustained for 5 minutes
- P50 latency > 50ms sustained for 10 minutes
- Request failure rate > 1%
- Sudden spike in latency (>2x normal)

## Troubleshooting

### Missing Latency IDs
If you see `latencyId=no-latency-id` in logs, it means:
- Client is using an older version without latency ID support
- Proto files are not properly synchronized between Bixby and Tecate

### Calculating End-to-End Latency
To calculate true end-to-end latency including Master processing:
1. Find the request sent time from Bixby logs
2. Find the processing complete time from Master logs
3. Join on latency ID to calculate total latency

### Network Latency Analysis
The `networkLatencyMs` field in Master logs represents:
- Time from when Bixby sends the request
- To when Master receives it at the TCP level
- Before any application processing occurs

This helps identify if latency is due to:
- Network issues (high networkLatencyMs)
- Application processing (low networkLatencyMs but high total latency)