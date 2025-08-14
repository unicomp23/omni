#!/bin/bash

# Get load test instance IP
aws --profile ${AWS_PROFILE:-default} cloudformation describe-stacks \
    --region ${AWS_DEFAULT_REGION:-us-east-2} \
    --stack-name ${STACK_NAME:-RedPandaClusterStack} \
    --query "Stacks[0].Outputs[?OutputKey=='LoadTestInstanceIP'].OutputValue" \
    --output text 