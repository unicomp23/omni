# Bixby-Master Latency Analysis Summary

## Test Period
- **Start**: September 7, 2025 00:00:02 UTC
- **End**: September 27, 2025 07:21:55 UTC
- **Duration**: ~20 days
- **Total Measurements**: 8,545,284 latency samples

## Measurement Type
**IMPORTANT**: The current measurements represent **round-trip latency** from Bixby's perspective:
- Measured from when Bixby sends RegisterStream/NotifyStream request
- Until Bixby receives the response back from Master
- Log entries show `type=response_received`

### To Calculate True One-Way Latency
To get the actual one-way latency (Bixby sent → Master received), we would need:
1. Master server logs with `receiveTimeMs` timestamps
2. Correlate using `latencyId` to match Bixby send time with Master receive time
3. Formula: `One-way = Master.receiveTimeMs - Bixby.sendTimeMs`

Without Master logs, a rough approximation would be:
`One-way ≈ (Round-trip - Master processing time) / 2`

From the Master server code analysis (src/master/master-server.js), processing time is typically logged as `processingLatencyMs`.

---

## Overall Statistics (Round-Trip)

| Metric | Value |
|--------|-------|
| **Count** | 8,545,284 |
| **Min** | 0.000 ms |
| **Median** | 12.000 ms |
| **Max** | 46,984.000 ms |
| **P99** | 287.000 ms |
| **P99.9** | 296.000 ms |
| **P99.99** | 1,091.510 ms |

---

## Key Observations

### 1. Baseline Period (Sept 7-8, early hours)
- Lower traffic volume (~3,000-4,000 req/hour)
- Very low latency: median 1-2ms, P99 64-66ms
- Stable performance

### 2. Traffic Increase (Sept 8, 17:00 onwards)
- Volume increased 4-5x (~17,000-20,000 req/hour)
- Median latency increased to 12-14ms
- P99 latency jumped to 287-295ms
- P99.9 remained stable at ~296ms

### 3. Latency Spikes
Several hours show extreme P99.99 latencies due to outliers:
- Sept 8 13:00: 28,516ms (29.3s max)
- Sept 8 14:00: 31,085ms (32.0s max)
- Sept 8 18:00: 8,566ms (20.4s max)
- Multiple other hours with 20-30s spikes

### 4. Sustained Performance
Despite spikes, the system maintained:
- Consistent median: 12-14ms
- Consistent P99: 240-295ms
- Suggests spikes are isolated events, not systemic degradation

---

## Hourly Breakdown (Sample)

### Early Period (Low Traffic)
```
Hour                 Count    Min  Median    Max    P99   P99.9  P99.99
2025-09-07 00:00     3,242   0.00    2.00  70.00  64.00   65.00   70.00
2025-09-07 12:00     3,998   0.00    1.00  69.00  65.00   66.00   67.80
```

### High Traffic Period
```
Hour                 Count    Min  Median    Max    P99   P99.9  P99.99
2025-09-08 18:00    15,698   1.00   61.00  20354  289.00  290.00 8566.10
2025-09-09 00:00    17,816   1.00   12.00   1302  288.00  291.00  531.04
2025-09-20 12:00    21,029   1.00   13.00    310  252.00  283.00  296.29
2025-09-26 16:00    21,010   1.00   13.00  26254  280.00  317.00 24444.44
```

---

## Comparison Framework for Redpanda

To compare with Redpanda measurements:

1. **Ensure measurement parity**: Confirm Redpanda metrics are also round-trip (or adjust accordingly)

2. **Key metrics to compare**:
   - Median latency
   - P99 latency
   - P99.9 latency
   - P99.99 latency

3. **Per-hour analysis**: Compare during similar load periods

4. **Overall statistics**: Compare across the full test duration

---

## Data Files

- **Full Report**: `latency_report.txt` (42 KB) - All hourly breakdowns
- **JSON Data**: `latency_analysis_report.json` (88 KB) - Machine-readable format
- **Analysis Script**: `analyze_latency.py` - Reproducible analysis
- **Raw Data**: `latency.study/` directory (1,944 JSON files)

---

## Next Steps

1. **Obtain Master logs** from SumoLogic to calculate true one-way latency
   - Query: `_view="tecate_master" AND (RegisterStream OR NotifyStream) AND receiveTimeMs`
   - Match using `latencyId` field

2. **Compare with Redpanda** using the same measurement methodology

3. **Investigate spike causes** in hours with extreme P99.99 values
   - Correlate with deployment events, network issues, or GC pauses
   - Check if spikes are evenly distributed or concentrated on specific instances

4. **Analyze by message type** (RegisterStream vs NotifyStream) if needed
