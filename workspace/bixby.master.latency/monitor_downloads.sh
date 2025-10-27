#!/bin/bash

# Monitor ongoing downloads

echo "=================================="
echo "DOWNLOAD PROGRESS MONITOR"
echo "=================================="
echo ""

# Check if downloads are running
BIXBY_PID=$(cat /tmp/bixby_prod_download.pid 2>/dev/null)
MASTER_PID=$(cat /tmp/master_prod_download.pid 2>/dev/null)

if [ -n "$BIXBY_PID" ] && ps -p $BIXBY_PID > /dev/null 2>&1; then
    echo "✅ Bixby download: RUNNING (PID: $BIXBY_PID)"
else
    echo "⏹️  Bixby download: STOPPED"
fi

if [ -n "$MASTER_PID" ] && ps -p $MASTER_PID > /dev/null 2>&1; then
    echo "✅ Master download: RUNNING (PID: $MASTER_PID)"
else
    echo "⏹️  Master download: STOPPED"
fi

echo ""
echo "=================================="
echo "BIXBY DOWNLOAD (last 10 lines):"
echo "=================================="
tail -10 bixby_prod_download.log 2>/dev/null || echo "No log file yet"

echo ""
echo "=================================="
echo "MASTER DOWNLOAD (last 10 lines):"
echo "=================================="
tail -10 master_prod_download.log 2>/dev/null || echo "No log file yet"

echo ""
echo "=================================="
echo "FILE COUNTS:"
echo "=================================="
BIXBY_COUNT=$(ls -1 latency.study/bixby_logs/chunk_*.json 2>/dev/null | wc -l)
MASTER_COUNT=$(ls -1 latency.study/master_logs/master_chunk_*.json 2>/dev/null | wc -l)

echo "📦 Bixby chunks: $BIXBY_COUNT / 2,304 expected (30-min chunks)"
echo "📦 Master chunks: $MASTER_COUNT / 2,304 expected (30-min chunks)"

# Calculate progress
if [ $BIXBY_COUNT -gt 0 ]; then
    BIXBY_PCT=$(python3 -c "print(f'{$BIXBY_COUNT * 100 / 2304:.1f}')")
    echo "   Bixby progress: ${BIXBY_PCT}%"
fi

if [ $MASTER_COUNT -gt 0 ]; then
    MASTER_PCT=$(python3 -c "print(f'{$MASTER_COUNT * 100 / 2304:.1f}')")
    echo "   Master progress: ${MASTER_PCT}%"
fi

echo ""
echo "To stop downloads:"
echo "  kill $BIXBY_PID $MASTER_PID"
echo ""
echo "To view full logs:"
echo "  tail -f bixby_prod_download.log"
echo "  tail -f master_prod_download.log"
