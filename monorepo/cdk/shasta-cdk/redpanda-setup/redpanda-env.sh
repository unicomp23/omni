#!/bin/bash
# RedPanda Cluster Environment Variables
# Source this file to set up rpk connectivity: source redpanda-env.sh

# Core connectivity
export RPK_BROKERS="10.1.0.159:9092,10.1.1.20:9092,10.1.2.35:9092"
export REDPANDA_CLUSTER_IPS="10.1.0.159,10.1.1.20,10.1.2.35"
export REDPANDA_PUBLIC_IPS="54.226.22.150,98.84.41.8,3.85.233.65"
export LOAD_TEST_INSTANCE_IP="54.221.61.216"

# Service URLs
export RPK_SCHEMA_REGISTRY_URL="http://10.1.0.159:8081"
export RPK_ADMIN_API_URL="http://10.1.0.159:33145"
export RPK_REST_PROXY_URL="http://10.1.0.159:8082"

# Connection settings
export RPK_TLS_ENABLED="false"
export RPK_SASL_MECHANISM=""

# AWS region for this cluster
export AWS_DEFAULT_REGION="us-east-1"

echo "RedPanda environment variables loaded:"
echo "  Brokers: $RPK_BROKERS"
echo "  Schema Registry: $RPK_SCHEMA_REGISTRY_URL"
echo "  Admin API: $RPK_ADMIN_API_URL"
echo "  Load Test Instance: $LOAD_TEST_INSTANCE_IP"
