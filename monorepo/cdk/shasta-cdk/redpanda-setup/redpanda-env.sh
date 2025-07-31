#!/bin/bash
# RedPanda Cluster Environment Variables
# Source this file to set up rpk connectivity: source redpanda-env.sh

# Core connectivity
export RPK_BROKERS="10.1.0.157:9092,10.1.0.200:9092,10.1.0.81:9092"
export REDPANDA_CLUSTER_IPS="10.1.0.157,10.1.0.200,10.1.0.81"
export REDPANDA_PUBLIC_IPS="54.167.78.5,35.173.180.188,35.153.140.39"
export LOAD_TEST_INSTANCE_IP="54.158.29.11"

# Service URLs
export RPK_SCHEMA_REGISTRY_URL="http://10.1.0.157:8081"
export RPK_ADMIN_API_URL="http://10.1.0.157:33145"
export RPK_REST_PROXY_URL="http://10.1.0.157:8082"

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
