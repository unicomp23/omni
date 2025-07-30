#!/bin/bash
# RedPanda Cluster Environment Variables
# Source this file to set up rpk connectivity: source redpanda-env.sh

# Core connectivity
export RPK_BROKERS="10.1.0.27:9092,10.1.1.101:9092,10.1.2.70:9092"
export REDPANDA_CLUSTER_IPS="10.1.0.27,10.1.1.101,10.1.2.70"
export REDPANDA_PUBLIC_IPS="18.212.109.14,3.219.45.27,34.204.69.218"
export LOAD_TEST_INSTANCE_IP="18.234.57.196"

# Service URLs
export RPK_SCHEMA_REGISTRY_URL="http://10.1.0.27:8081"
export RPK_ADMIN_API_URL="http://10.1.0.27:33145"
export RPK_REST_PROXY_URL="http://10.1.0.27:8082"

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
