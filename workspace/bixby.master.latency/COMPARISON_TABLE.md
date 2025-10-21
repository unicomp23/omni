# Bixby Latency Metrics - Ready for Comparison

## Overall Period Statistics
**Period**: September 7-27, 2025 (~20 days)
**Samples**: 8,545,284 measurements
**Measurement**: Round-trip latency (Bixby client perspective)

| Metric | Value (ms) | Notes |
|--------|------------|-------|
| **Min** | 0.000 | Best case |
| **Median** | 12.000 | Typical request |
| **Max** | 46,984.000 | Worst outlier |
| **P99** | 287.000 | 99% under this |
| **P99.9** | 296.000 | 99.9% under this |
| **P99.99** | 1,091.510 | 99.99% under this |

---

## Sample Hourly Breakdown

### Low Traffic Hours (Sept 7, early)
| Hour | Count | Min | Median | Max | P99 | P99.9 | P99.99 |
|------|-------|-----|--------|-----|-----|-------|--------|
| 2025-09-07 00:00 | 3,242 | 0.00 | 2.00 | 70.00 | 64.00 | 65.00 | 70.00 |
| 2025-09-07 06:00 | 3,634 | 0.00 | 2.00 | 66.00 | 64.00 | 65.00 | 66.00 |
| 2025-09-07 12:00 | 3,998 | 0.00 | 1.00 | 69.00 | 65.00 | 66.00 | 67.80 |

### High Traffic Hours (Sept 8-27)
| Hour | Count | Min | Median | Max | P99 | P99.9 | P99.99 |
|------|-------|-----|--------|-----|-----|-------|--------|
| 2025-09-08 18:00 | 15,698 | 1.00 | 61.00 | 20,354 | 289.00 | 290.00 | 8,566.10 |
| 2025-09-09 12:00 | 19,607 | 1.00 | 12.00 | 11,588 | 295.00 | 300.00 | 6,526.46 |
| 2025-09-15 12:00 | 20,264 | 1.00 | 13.00 | 27,655 | 277.00 | 287.00 | 25,944.11 |
| 2025-09-20 12:00 | 21,029 | 1.00 | 13.00 | 310 | 252.00 | 283.00 | 296.29 |
| 2025-09-26 12:00 | 19,482 | 1.00 | 13.00 | 32,992 | 271.00 | 273.00 | 2,019.36 |

**Typical High-Traffic Pattern**:
- Count: 17,000-21,000 requests/hour
- Median: 12-14 ms
- P99: 240-295 ms
- P99.9: 280-300 ms

---

## For Your Presentation

### One-Way Latency Estimation
If Redpanda measurements are one-way, divide Bixby measurements by 2 for rough comparison:

| Metric | Round-Trip | Estimated One-Way (÷2) |
|--------|------------|------------------------|
| **Median** | 12.000 ms | ~6.000 ms |
| **P99** | 287.000 ms | ~143.500 ms |
| **P99.9** | 296.000 ms | ~148.000 ms |
| **P99.99** | 1,091.510 ms | ~545.755 ms |

⚠️ **Caveat**: This is an approximation. For accurate one-way latency, Master server logs are needed.

---

## Questions to Ask About Redpanda Metrics

1. **What is measured?**
   - Producer → Broker (one-way)?
   - Producer → Broker → Ack (round-trip)?

2. **What percentiles are reported?**
   - Ensure comparing P99, P99.9, P99.99

3. **What was the test duration?**
   - Compare similar time windows

4. **What was the request rate?**
   - Compare similar load levels (our high-traffic: ~17-21k req/hour)

5. **Are outliers included?**
   - Our data includes all measurements, including extreme spikes

---

## Key Talking Points

✅ **Stable median performance**: 12-14ms round-trip under high load
✅ **Consistent P99**: 240-295ms across most hours
✅ **High throughput sustained**: 17,000-21,000 req/hour
⚠️ **Occasional spikes**: P99.99 can reach 1-30 seconds (investigation needed)
📊 **Large dataset**: 8.5M samples over 20 days provides statistical confidence

---

## Files Available
- Full report: `latency_report.txt`
- JSON data: `latency_analysis_report.json`
- All hourly breakdowns included
