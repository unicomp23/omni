#!/bin/bash
# RedPanda Cluster Environment Variables
# Source this file to set up rpk connectivity: source redpanda-env.sh

# Core connectivity
export RPK_BROKERS="10.1.0.217:9092,10.1.1.237:9092,10.1.2.12:9092"
export REDPANDA_CLUSTER_IPS="10.1.0.217,10.1.1.237,10.1.2.12"
export REDPANDA_PUBLIC_IPS="3.84.214.214,34.232.50.167,44.210.115.179"
export LOAD_TEST_INSTANCE_IP="18.234.250.45"

# Service URLs
export RPK_SCHEMA_REGISTRY_URL="http://10.1.0.217:8081"
export RPK_ADMIN_API_URL="http://10.1.0.217:33145"
export RPK_REST_PROXY_URL="http://10.1.0.217:8082"

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
