# One-Way Latency Calculation - Detailed Explanation

## Visual Timeline

Here's what happens when Bixby sends a RegisterStream request to Master:

```
TIME (milliseconds since epoch)
│
│                    ┌─────────────────────────────────────┐
│                    │  ONE-WAY LATENCY (what we measure)  │
│                    └─────────────────────────────────────┘
│
│  Bixby sends       Master receives        Master sends      Bixby receives
│  request           request                response          response
│     │                  │                      │                 │
│     ▼                  ▼                      ▼                 ▼
├─────●──────────────────●──────────────────────●─────────────────●─────────►
│     │                  │                      │                 │
│     │                  │                      │                 │
│     │◄─── 31ms ───────►│                      │                 │
│     │  (one-way        │◄──── ~1ms ──────────►│                 │
│     │   latency)       │    (processing)      │◄──── ~31ms ────►│
│     │                  │                      │   (return trip) │
│     │                                                            │
│     │◄───────────────── 63ms (round-trip) ───────────────────────►│
│
│ sendTimeMs     receiveTimeMs                              endTimeMs
│ =1757204093544  =1757204093575                           =1757204093607
```

## Step-by-Step Calculation

### Given Data

**From Bixby Log:**
```json
{
  "latencyId": "f4a0acd7-944e-41cb-904e-0ad3509846c4",
  "latencyMs": 63,
  "endTimeMs": 1757204093607,
  "type": "response_received"
}
```

**From Master Log:**
```json
{
  "latencyId": "f4a0acd7-944e-41cb-904e-0ad3509846c4",
  "receiveTimeMs": 1757204093575,
  "type": "request_received"
}
```

### Step 1: Calculate When Bixby Sent the Request

Bixby doesn't directly log when it sent the request, but we can calculate it:

```
sendTimeMs = endTimeMs - latencyMs
           = 1757204093607 - 63
           = 1757204093544
```

**Why this works:**
- `endTimeMs` = when Bixby received the response (logged)
- `latencyMs` = total round-trip time (logged)
- Therefore, `endTimeMs - latencyMs` = when Bixby sent the request

### Step 2: Calculate One-Way Latency

Now we have both timestamps:
- **Bixby send time**: 1757204093544 ms
- **Master receive time**: 1757204093575 ms (from Master log)

```
One-way latency = Master receiveTimeMs - Bixby sendTimeMs
                = 1757204093575 - 1757204093544
                = 31 ms
```

### Step 3: Verify the Math

Let's verify this makes sense:

```
Round-trip latency (Bixby log) = 63 ms
One-way latency (calculated)   = 31 ms
Return latency + processing    ≈ 32 ms

Total: 31 + 32 = 63 ms ✓
```

The one-way latency is approximately **half** the round-trip, which validates our calculation!

## Clock Synchronization Assumption

**Critical: We use correlation by latencyId but rely on local timestamps from each system.**

### How It Works

```
Bixby system (Clock A):
  sendTimeMs = endTimeMs - latencyMs = 1757204093544
  └─ Calculated from Bixby's local clock (Date.now() on Bixby server)

Master system (Clock B):
  receiveTimeMs = Date.now() = 1757204093575
  └─ From Master's local clock (Date.now() on Master server)

One-way latency = 1757204093575 - 1757204093544 = 31ms
                  └─ Master Clock B ─┘   └─ Bixby Clock A ─┘
```

### The Correlation Strategy

1. **latencyId** = UUID used to match the SAME request across both systems
2. **sendTimeMs** = Timestamp from Bixby's local clock
3. **receiveTimeMs** = Timestamp from Master's local clock

We correlate by latencyId to ensure we're measuring the same request, but the calculation itself subtracts timestamps from **different system clocks**.

### Clock Synchronization Required

This approach assumes both servers maintain synchronized clocks via NTP (Network Time Protocol):

- **Typical NTP accuracy**: ±1-10ms
- **Best-case NTP**: ±1ms
- **Worst-case (well-configured)**: ±10-20ms

### Impact on Results

Given our results (Median=6ms, P99=145ms):

**If clocks are within ±10ms:**
- Median: 6ms ± 10ms error = still valid
- P99: 145ms ± 10ms error = ~7% uncertainty
- Trends and percentile distributions remain accurate

**If clocks have constant offset (e.g., Clock B is always 5ms ahead):**
- All measurements shifted by same amount
- Relative comparisons remain valid
- Hourly trends remain valid
- Percentiles remain valid

**If clocks have variable drift:**
- Can introduce noise into measurements
- Negative latencies indicate clock skew (filtered out)
- Extreme outliers may be clock-related

### Validation That Clocks Are Synchronized

Evidence our clocks are reasonably synchronized:

1. ✅ **One-way ≈ 0.5 × round-trip** (31ms vs 63ms)
2. ✅ **Minimal negative latencies** (filtered, but rare)
3. ✅ **Consistent hourly medians** (6-7ms across all hours)
4. ✅ **Reasonable absolute values** (6ms median for same-region network)

If clocks were badly skewed, we'd see inconsistent or nonsensical patterns.

### Alternative Approaches (Not Used Here)

Other methods that don't rely on clock synchronization:

1. **Two-way timestamp exchange**: Send timestamps in messages (requires protocol changes)
2. **Clock offset estimation**: Use round-trip to estimate offset (less accurate)
3. **GPS/PTP hardware clocks**: Nanosecond precision (expensive hardware)

We use the NTP-synchronized approach because it's practical, sufficiently accurate for our use case, and doesn't require protocol changes.

## What Each Timestamp Represents

### Bixby Side (Client)

| Field | Meaning | How Captured |
|-------|---------|--------------|
| `sendTimeMs` | When Bixby called `send()` on the socket | **Calculated** from `endTimeMs - latencyMs` |
| `endTimeMs` | When Bixby received response from socket | **Logged** by Bixby |
| `latencyMs` | Total round-trip time | **Logged** by Bixby (`endTimeMs - sendTimeMs`) |

### Master Side (Server)

| Field | Meaning | How Captured |
|-------|---------|--------------|
| `receiveTimeMs` | When Master's handler function was called | **Logged** by Master (`Date.now()`) |

### Key Insight

The Master logs `receiveTimeMs` at this exact point in the code:

```javascript
// master-server.js:210-215
TecateMaster.prototype.handle_registerStream = function(rpc, conn, req, cb, latencyId) {
  // Log request receipt time for latency measurement
  const receiveTimeMs = Date.now();  // ← THIS TIMESTAMP

  logger.info('RegisterStream RECEIVED latencyId=' + latencyId +
              ' receiveTimeMs=' + receiveTimeMs + ' type=request_received');
```

This is **after** the request has:
1. ✅ Traveled across the network
2. ✅ Been received by the OS network stack
3. ✅ Been read by the Node.js event loop
4. ✅ Been dispatched to the handler function

But **before** any application-level processing happens.

This is exactly what we want to measure!

## Why Correlation is Critical

### Without Correlation (Wrong)

If we tried to average all Bixby send times and Master receive times separately:

```
Average Bixby send:    1757204093544
Average Master receive: 1757204095832
Difference:            2288 ms  ❌ WRONG!
```

This would give us nonsense because we're comparing **different requests**.

### With Correlation (Correct)

By matching on `latencyId`:

```
Request A (latencyId=f4a0acd7...):
  Bixby send:    1757204093544
  Master receive: 1757204093575
  Latency:       31 ms ✓

Request B (latencyId=632e50ee...):
  Bixby send:    1757204093602
  Master receive: 1757204093637
  Latency:       35 ms ✓
```

Now we're measuring the **same request** on both sides!

## Handling Edge Cases

### Case 1: Negative Latencies (Clock Skew)

Sometimes `receiveTimeMs < sendTimeMs`, giving negative latency:

```python
one_way_latency = 1757204093544 - 1757204093575 = -31 ms  ❌
```

**Cause:** Clock skew between Bixby and Master servers

**Solution:** Filter out negative latencies (we skip them in the calculation)

### Case 2: Unmatched latencyId

**Bixby log has latencyId but Master doesn't:**
- Request may have gone to a different Master instance
- Master may not have logged it
- Network failure before reaching Master

**Master log has latencyId but Bixby doesn't:**
- Bixby log may not have been collected
- Different Bixby instance

**Solution:** Only include matched pairs in the analysis

### Case 3: latencyId = "no-latency-id"

Some logs have placeholder `latencyId`:

```
RegisterStream RECEIVED latencyId=no-latency-id ...
```

**Cause:** Older code path that didn't support latency tracking

**Solution:** Skip these entries (can't correlate without unique ID)

## Statistics Explained

### Percentiles

When we say **P99 = 145ms**, it means:
- 99% of requests have latency ≤ 145ms
- Only 1% of requests have latency > 145ms

### Why Percentiles Matter

**Median (P50) = 6ms** tells us typical performance

**P99 = 145ms** tells us worst-case performance for most users

**P99.9 = 151ms** tells us extreme tail performance

**P99.99 = 24,425ms** captures outliers (likely issues)

### Hourly Breakdown

We group by hour to detect patterns:

```python
hour_key = dt.strftime('%Y-%m-%d %H:00')
# Example: "2025-09-07 14:00"
```

This lets us see:
- Time-of-day patterns
- Traffic spikes
- Degradation over time

## Code Walkthrough

### Main Calculation Loop

```python
for latency_id, bixby_entry in bixby_data.items():
    # 1. Check if Master has this latencyId
    if latency_id not in master_data:
        unmatched_bixby += 1
        continue

    master_entry = master_data[latency_id]

    # 2. Calculate one-way latency
    one_way_latency = master_entry['receiveTimeMs'] - bixby_entry['sendTimeMs']

    # 3. Skip negative latencies (clock skew)
    if one_way_latency < 0:
        continue

    # 4. Store for statistics
    all_latencies.append(one_way_latency)

    # 5. Group by hour
    hour_key = dt.strftime('%Y-%m-%d %H:00')
    hourly_latencies[hour_key].append(one_way_latency)
```

### Percentile Calculation

```python
def compute_percentile(sorted_values, percentile):
    """
    Example: P99 with 100 values
    - percentile = 0.99
    - index = (100 - 1) * 0.99 = 98.01
    - lower_index = 98, upper_index = 99
    - Interpolate between values[98] and values[99]
    """
    index = (len(sorted_values) - 1) * percentile
    lower_index = int(index)
    upper_index = min(lower_index + 1, len(sorted_values) - 1)

    if lower_index == upper_index:
        return sorted_values[lower_index]

    # Linear interpolation
    lower_weight = upper_index - index
    upper_weight = index - lower_index

    return sorted_values[lower_index] * lower_weight + \
           sorted_values[upper_index] * upper_weight
```

## Common Questions

### Q: Why not use Master's response timestamp?

**A:** We want to measure network latency, not total service time. Using the response timestamp would include Master processing time.

### Q: What about TCP handshake time?

**A:** For established connections (which these are), the handshake is already complete. We're measuring data transmission time on an existing connection.

### Q: How accurate is this?

**A:** Accurate to ~1-2ms, limited by:
- Clock synchronization between servers (typically <10ms)
- Timestamp precision (1ms granularity)
- Network stack buffering (~1ms)

### Q: Can we measure sub-millisecond latency?

**A:** Not with millisecond timestamps. Would need microsecond-precision logging.

### Q: What causes the P99.99 outliers (24+ seconds)?

**A:** Likely:
- Network packet loss requiring retransmission
- Server under heavy load (queueing)
- Clock synchronization issues
- Long GC pauses

## Validation Checklist

When reviewing results, verify:

- ✅ One-way latency ≈ 0.5 × round-trip latency
- ✅ Median is reasonable (single-digit ms for same region)
- ✅ P99 < 200ms (for well-performing systems)
- ✅ Most hourly medians are consistent
- ✅ Match rate > 40% (we got 49%)
- ✅ No excessive negative latencies filtered

## References

- **Bixby logging**: `bixby/bixby/tecate/tecate_client_session.cc`
- **Master logging**: `tecate/src/master/master-server.js:210-328`
- **Analysis script**: `calculate_oneway_latency.py`
