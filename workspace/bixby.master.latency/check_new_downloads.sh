#!/bin/bash
# Quick check to see if new chunks are being downloaded

echo "Checking for new downloads (Sept 28+)..."
echo ""

BIXBY_NEW=$(grep -c "📦 Chunk" bixby_download.log 2>/dev/null || echo "0")
MASTER_NEW=$(grep -c "📦 Chunk" master_download.log 2>/dev/null || echo "0")

if [ "$BIXBY_NEW" -gt 0 ] || [ "$MASTER_NEW" -gt 0 ]; then
    echo "✅ New chunks being downloaded!"
    echo "   Bixby: $BIXBY_NEW chunks downloaded"
    echo "   Master: $MASTER_NEW chunks downloaded"
    echo ""
    echo "Latest downloads:"
    grep "📦 Chunk" bixby_download.log 2>/dev/null | tail -3
    grep "📦 Chunk" master_download.log 2>/dev/null | tail -3
else
    echo "⏭️  Still skipping existing chunks (Sept 7-27)"
    echo "   Will start downloading new chunks at chunk #2016 (Sept 28)"
    echo ""
    echo "Current position:"
    tail -1 bixby_download.log 2>/dev/null | grep "Chunk"
    tail -1 master_download.log 2>/dev/null | grep "Chunk"
fi
