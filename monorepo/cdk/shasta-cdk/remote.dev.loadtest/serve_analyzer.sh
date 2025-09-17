#!/bin/bash

# Simple HTTP server for latency analyzer
# Serves both the HTML analyzer and the JSONL data file

echo "🚀 Starting RedPanda Latency Analyzer Server..."
echo ""

# Check if bucket_analysis.jsonl exists
if [ ! -f "bucket_analysis.jsonl" ]; then
    echo "⚠️  Warning: bucket_analysis.jsonl not found in current directory"
    echo "   Generate it with: go run cmd/analyze/analyze_latency.go -5min -jsonl ./downloads"
    echo ""
fi

# Check if latency_analyzer.html exists
if [ ! -f "latency_analyzer.html" ]; then
    echo "❌ Error: latency_analyzer.html not found!"
    exit 1
fi

echo "📊 Files in directory:"
ls -lh bucket_analysis.jsonl latency_analyzer.html 2>/dev/null || true
echo ""

# Try Python 3 first, then Python 2
if command -v python3 &> /dev/null; then
    echo "🌐 Starting server at http://localhost:8000"
    echo "📱 Open http://localhost:8000/latency_analyzer.html in your browser"
    echo ""
    echo "Press Ctrl+C to stop the server"
    python3 -m http.server 8000
elif command -v python &> /dev/null; then
    echo "🌐 Starting server at http://localhost:8000"
    echo "📱 Open http://localhost:8000/latency_analyzer.html in your browser"
    echo ""
    echo "Press Ctrl+C to stop the server"
    python -m SimpleHTTPServer 8000
else
    echo "❌ Error: Python not found. Install Python to run the server."
    echo ""
    echo "Alternative: Use any static file server:"
    echo "  - npx serve ."
    echo "  - php -S localhost:8000"
    echo "  - ruby -run -e httpd . -p 8000"
    exit 1
fi
