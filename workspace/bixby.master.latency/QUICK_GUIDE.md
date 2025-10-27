# Quick Guide: Gap Detection and Filling

## TL;DR

To fill gaps in your data, just re-run the download scripts:

```bash
cd latency.study
./download_chunks.js          # Fills gaps in bixby_logs
./download_master_chunks.js   # Fills gaps in master_logs
```

They automatically skip existing chunks and only download what's missing!

---

## Complete Workflow

### 1. Check for gaps
```bash
./detect_gaps.py latency.study/bixby_logs
./detect_gaps.py latency.study/master_logs
```

**Output:**
- Shows missing 15-minute intervals
- Identifies timestamp discontinuities
- Reports in `gap_analysis_*.json`

### 2. Fill the gaps
```bash
cd latency.study

# Make sure credentials are set
export SUMO_ACCESS_ID="your-access-id"
export SUMO_ACCESS_KEY="your-access-key"

# Just re-run the download scripts!
./download_chunks.js
./download_master_chunks.js
```

**What happens:**
- ⏭️ Skips chunks that already exist
- 📦 Downloads only missing chunks
- Shows summary: "New chunks downloaded: X"

### 3. Verify gaps are filled
```bash
./detect_gaps.py latency.study/bixby_logs
./detect_gaps.py latency.study/master_logs
```

---

## Current Status

Based on latest gap detection:

**bixby_logs:**
- 1,942 / 1,950 chunks (99.6% complete)
- Missing 8 chunks:
  - Sept 17: 19:45-21:30 (7 chunks = 1h 45min)
  - Sept 23: 05:45 (1 chunk = 15min)

**master_logs:**
- 2,012 / 2,015 chunks (99.85% complete)
- Missing 3-4 single chunks (15 min each)

---

## Options

### Skip existing (default)
```bash
./download_chunks.js
```
Only downloads missing chunks. Fast!

### Force re-download
```bash
./download_chunks.js --force
```
Re-downloads ALL chunks, overwriting existing files. Use if you suspect corrupted data.

---

## Why This Approach?

**Before:** Separate gap detection → gap analysis → gap filling scripts (4 scripts, 1,155 lines)

**Now:** Same script handles both initial download and gap filling (3 scripts, 378 lines)
- ✅ **67% less code**: Extracted common logic to shared library
- ✅ **Simpler**: One workflow for everything
- ✅ **DRY**: Zero code duplication
- ✅ **Faster**: Automatically skips existing chunks
- ✅ **Safer**: Idempotent operations
- ✅ **Maintainable**: Changes in one place

---

## Troubleshooting

**Script downloads 0 new chunks but gaps still exist:**
- Check that the date range in the script covers your gap
- Verify SumoLogic credentials are correct
- Check if data exists in SumoLogic for that time period

**Want to see which chunks will be downloaded:**
- The script shows which chunks it skips (⏭️) vs downloads (📦)
- Check the summary at the end for "New chunks downloaded"

**Script is slow:**
- Expected: ~5 seconds per chunk downloaded
- Skipping existing chunks is very fast (<1 sec per chunk)
- Use `--force` only when necessary
