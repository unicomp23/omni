#!/bin/bash

# Test script to demonstrate authentication detection
# This will show how the code detects SASL/TLS requirements

set -e

echo "🧪 Testing Authentication Detection"
echo "=================================="

# Test with your current environment
echo "📋 Your current environment:"
echo "   REDPANDA_BROKERS: $REDPANDA_BROKERS"
echo "   REDPANDA_USER: $REDPANDA_USER"
echo "   REDPANDA_PASS: ${REDPANDA_PASS:+*****}"
echo ""

# Quick Go program to test detection logic
cat > auth_test.go << 'EOF'
package main

import (
	"fmt"
	"os"
	"strings"
)

func requiresTLS(brokers []string) bool {
	if tlsEnabled := os.Getenv("REDPANDA_TLS_ENABLED"); tlsEnabled == "true" {
		return true
	}
	for _, broker := range brokers {
		if strings.Contains(broker, ".cloud.redpanda.com") || strings.Contains(broker, ":30292") {
			return true
		}
	}
	return false
}

func requiresSASL(brokers []string) bool {
	if saslEnabled := os.Getenv("REDPANDA_SASL_ENABLED"); saslEnabled == "true" {
		return true
	}
	if user := os.Getenv("REDPANDA_USER"); user != "" {
		if pass := os.Getenv("REDPANDA_PASS"); pass != "" {
			return true
		}
	}
	for _, broker := range brokers {
		if strings.Contains(broker, ".cloud.redpanda.com") || strings.Contains(broker, ":30292") {
			return true
		}
	}
	return false
}

func main() {
	brokersEnv := os.Getenv("REDPANDA_BROKERS")
	if brokersEnv == "" {
		fmt.Println("❌ REDPANDA_BROKERS not set")
		return
	}
	brokers := strings.Split(brokersEnv, ",")
	
	fmt.Printf("🔍 Detection Results:\n")
	fmt.Printf("   Brokers: %v\n", brokers)
	fmt.Printf("   TLS Required: %t\n", requiresTLS(brokers))
	fmt.Printf("   SASL Required: %t\n", requiresSASL(brokers))
	fmt.Printf("   User: %s\n", os.Getenv("REDPANDA_USER"))
	fmt.Printf("   Pass Set: %t\n", os.Getenv("REDPANDA_PASS") != "")
}
EOF

echo "🔨 Compiling test..."
go build -o auth_test auth_test.go

echo "🚀 Running detection test..."
./auth_test

echo ""
echo "✅ Expected for your setup:"
echo "   TLS Required: false (internal brokers)"
echo "   SASL Required: true (credentials provided)"
echo ""
echo "💡 This means SASL authentication should now be used!"

# Cleanup
rm -f auth_test auth_test.go
