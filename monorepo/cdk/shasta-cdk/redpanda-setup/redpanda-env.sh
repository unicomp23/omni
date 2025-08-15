#!/bin/bash
# RedPanda Cluster Environment Variables
# Source this file to set up rpk connectivity: source redpanda-env.sh

# Core connectivity
export RPK_BROKERS="10.1.0.56:9092,10.1.1.250:9092,10.1.2.91:9092"
export REDPANDA_CLUSTER_IPS="10.1.0.56,10.1.1.250,10.1.2.91"
export REDPANDA_PUBLIC_IPS="18.117.183.164,3.143.231.232,3.139.99.135"
export LOAD_TEST_INSTANCE_IP="52.15.232.121"

# Service URLs
export RPK_SCHEMA_REGISTRY_URL="http://10.1.0.56:8081"
export RPK_ADMIN_API_URL="http://10.1.0.56:33145"
export RPK_REST_PROXY_URL="http://10.1.0.56:8082"

# Connection settings
export RPK_TLS_ENABLED="false"
export RPK_SASL_MECHANISM=""

# AWS region for this cluster
export AWS_DEFAULT_REGION="us-east-2"

echo "RedPanda environment variables loaded:"
echo "  Brokers: $RPK_BROKERS"
echo "  Schema Registry: $RPK_SCHEMA_REGISTRY_URL"
echo "  Admin API: $RPK_ADMIN_API_URL"
echo "  Load Test Instance: $LOAD_TEST_INSTANCE_IP"
