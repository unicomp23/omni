#!/bin/bash
# RedPanda Cluster Environment Variables
# Source this file to set up rpk connectivity: source redpanda-env.sh

# Core connectivity
export RPK_BROKERS="10.1.0.139:9092,10.1.1.36:9092,10.1.2.253:9092"
export REDPANDA_CLUSTER_IPS="10.1.0.139,10.1.1.36,10.1.2.253"
export REDPANDA_PUBLIC_IPS="3.85.207.26,44.201.65.160,44.210.127.51"
export LOAD_TEST_INSTANCE_IP="35.175.206.219"

# Service URLs
export RPK_SCHEMA_REGISTRY_URL="http://10.1.0.139:8081"
export RPK_ADMIN_API_URL="http://10.1.0.139:33145"
export RPK_REST_PROXY_URL="http://10.1.0.139:8082"

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
