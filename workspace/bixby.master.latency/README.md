# Bixby-Master One-Way Latency Analysis

This repository contains tools and data for analyzing true one-way network latency between Bixby clients and Master servers.

## Overview

When Bixby sends a `RegisterStream` or `NotifyStream` request to Master, we want to measure the actual network latency from when Bixby **sent** the request to when Master **received** it and was ready to process it.

### The Problem with Round-Trip Latency

Initially, we only had Bixby client logs which measure **round-trip time**:
```
Round-trip latency = Time from request sent → response received
                   = One-way (Bixby → Master) + Processing time + One-way (Master → Bixby)
```

This doesn't give us the true one-way latency we need.

### The Solution: Correlation by latencyId

Both Bixby and Master log a unique `latencyId` for each request. By correlating these logs, we can calculate true one-way latency:

```
One-way latency = Master receiveTimeMs - Bixby sendTimeMs
```

## How the Calculation Works

### Step 1: Extract Timestamps from Bixby Logs

Bixby logs contain:
- `latencyId`: Unique identifier for each request
- `latencyMs`: Round-trip time (how long it took to get response)
- `endTimeMs`: Timestamp when response was received

We calculate the **send time**:
```python
sendTimeMs = endTimeMs - latencyMs
```

**Example Bixby log entry:**
```
RegisterStream COMPLETE
  latencyId=f4a0acd7-944e-41cb-904e-0ad3509846c4
  latencyMs=63
  endTimeMs=1757204093607
```

Therefore:
```
sendTimeMs = 1757204093607 - 63 = 1757204093544
```

### Step 2: Extract Timestamps from Master Logs

Master logs contain:
- `latencyId`: Same unique identifier
- `receiveTimeMs`: Timestamp when Master received the request

**Example Master log entry:**
```
RegisterStream RECEIVED
  latencyId=f4a0acd7-944e-41cb-904e-0ad3509846c4
  receiveTimeMs=1757204093575
```

### Step 3: Correlate and Calculate

Match entries by `latencyId` and calculate:
```
One-way latency = receiveTimeMs - sendTimeMs
                = 1757204093575 - 1757204093544
                = 31 ms
```

This is the **true network latency** from Bixby to Master!

### Validation

Notice that the one-way latency (31ms) is roughly **half** the round-trip latency (63ms), which validates our approach. The other half includes:
- Master processing time (~1-5ms)
- Return network latency (Master → Bixby)

## Directory Structure

```
bixby.master.latency/
├── README.md                          # This file
├── analyze_latency.py                 # Original round-trip analysis
├── calculate_oneway_latency.py        # One-way latency calculation
├── latency_report.txt                 # Round-trip results
├── oneway_latency_report.txt          # One-way results (FINAL)
├── oneway_latency_report.json         # One-way results (JSON)
│
└── latency.study/                     # Downloaded logs
    ├── download_chunks.js             # Script to download Bixby logs
    ├── download_master_chunks.js      # Script to download Master logs
    │
    ├── bixby_logs/                    # Client-side logs (1,942 files)
    │   ├── chunk_20250907_0000.json
    │   ├── chunk_20250907_0015.json
    │   └── ...
    │
    └── master_logs/                   # Server-side logs (2,012 files)
        ├── master_chunk_20250907_0000.json
        ├── master_chunk_20250907_0015.json
        └── ...
```

## Data Collection

### Time Period
September 7 - September 27, 2025 (20 days)

### Data Volume
- **Bixby logs**: 1,942 files, ~10 GB, 8.5M log entries
- **Master logs**: 2,012 files, ~5.1 GB, 4.4M log entries
- **Matched entries**: 4.2M correlated pairs

### Collection Method
Logs were downloaded from SumoLogic in 15-minute chunks:
- **Bixby query**: `_view="media_bixby" AND latencyMs`
- **Master query**: `"RegisterStream RECEIVED" AND receiveTimeMs`

## Running the Analysis

### Prerequisites
```bash
python3 (with standard library)
```

### Calculate One-Way Latency
```bash
./calculate_oneway_latency.py
```

This will:
1. Load all Bixby logs (~8.5M entries)
2. Load all Master logs (~4.4M entries)
3. Correlate by `latencyId`
4. Calculate one-way latency for each matched pair
5. Generate per-hour and overall statistics
6. Output results to:
   - `oneway_latency_report.txt`
   - `oneway_latency_report.json`

### Re-download Data (if needed)
```bash
cd latency.study

# Set credentials
export SUMO_ACCESS_ID="your-access-id"
export SUMO_ACCESS_KEY="your-access-key"

# Download Bixby logs
./download_chunks.js

# Download Master logs
./download_master_chunks.js
```

## Results

### Overall Statistics (One-Way Latency)

```
Count:       4,156,756 matched requests
Min:             0.000 ms
Median:          6.000 ms
Max:         46,980.000 ms
P99:           145.000 ms
P99.9:         151.000 ms
P99.99:     24,425.298 ms
```

### Comparison: Round-Trip vs One-Way

| Metric | Round-Trip | One-Way | Ratio |
|--------|------------|---------|-------|
| Median | 12 ms | **6 ms** | 2.0x |
| P99 | 287 ms | **145 ms** | 2.0x |
| P99.9 | 296 ms | **151 ms** | 2.0x |

### Interpretation

1. **Median latency of 6ms** indicates typical network path is very fast
2. **P99 of 145ms** shows most requests complete within reasonable time
3. **P99.9 of 151ms** suggests consistent performance
4. **P99.99 has outliers** (~24 seconds) likely due to:
   - Network congestion
   - Server-side issues
   - Clock skew between systems
   - Retransmissions

## Hourly Statistics

The reports include per-hour breakdowns showing:
- How latency varies throughout the day
- Peak usage hours (e.g., Sept 8 18:00 had 7,739 requests)
- Any degradation patterns over time

See `oneway_latency_report.txt` for complete hourly data.

## Important Notes

### Clock Skew
The calculation assumes Bixby and Master clocks are synchronized. Small clock skew (~1-10ms) is acceptable and expected. Large clock skew (>100ms) could affect accuracy.

Negative latencies (where Master time < Bixby time) are filtered out as invalid.

### Unmatched Entries
- **Unmatched Bixby**: 4.3M entries (50%)
  - These requests may have gone to different Master instances not in our dataset
  - Or had `latencyId=no-latency-id`

- **Unmatched Master**: 266K entries (6%)
  - These may be from Bixby instances not in our dataset
  - Or the Bixby logs didn't capture these requests

The 4.2M matched entries represent a solid sample for analysis.

### Measurement Precision
- Timestamps are in milliseconds
- Network latency calculations are accurate to ~1ms
- Sub-millisecond precision is not guaranteed

## Use Cases

This analysis is designed to answer questions like:

1. **"What is the latency from Bixby sending a RegisterStream to Master receiving it?"**
   → **Answer: 6ms median, 145ms P99**

2. **"How does latency vary by hour?"**
   → **See hourly breakdown in report**

3. **"What percentage of requests have latency > 100ms?"**
   → **~1% (P99 = 145ms, so roughly 1% exceed this)**

4. **"Are there any problematic time periods?"**
   → **Check hourly stats for spikes**

## For Next Steps

### Compare with Other Systems
To compare with Tecate or other systems, follow the same methodology:
1. Collect logs with correlation IDs
2. Extract send/receive timestamps
3. Correlate and calculate
4. Generate same statistics format

### Monitor Over Time
Run this analysis periodically to:
- Detect latency degradation
- Validate infrastructure changes
- Track improvement initiatives

### Drill Down on Outliers
To investigate P99.99 outliers:
1. Filter `oneway_latency_report.json` for latencies > 10,000ms
2. Check corresponding Bixby/Master logs for those `latencyId` values
3. Look for patterns (time of day, specific servers, etc.)

## Contact

For questions about this analysis, see the git history or check with the team that set up this workspace.

## References

- **Bixby repo**: `./latency.study/repo/bixby`
- **Master/Tecate repo**: `./latency.study/repo/tecate`
- **Master server code**: `repo/tecate/src/master/master-server.js:210-328`
  - This is where `receiveTimeMs` is logged
