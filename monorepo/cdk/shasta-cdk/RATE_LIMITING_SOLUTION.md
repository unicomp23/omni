# AWS API Rate Limiting Solution for Redpanda Deployment

## Problem Description

The original issue was encountering AWS API rate limiting errors when deploying multiple EC2 instances simultaneously. This typically happens when:

1. Multiple instances are created at the same time
2. Each instance's SSM agent tries to register simultaneously
3. The `describe-instance-information` API calls exceed the rate limit
4. The error message indicates "Rate exceeded" for EC2 operations

## Solutions Implemented

### 1. Code-Level Improvements in `shasta-redpanda-stack.ts`

#### A. Exponential Backoff for SSM Registration
- **Before**: Simple retry loop with fixed 10-second delays
- **After**: Exponential backoff with jitter to prevent thundering herd
- **Implementation**: 
  - Base delay: 10 seconds
  - Exponential growth: delay = base_delay * (2^retry_count)
  - Jitter: Random 0-5 seconds added to prevent synchronized retries
  - Maximum retries: 10 attempts over ~10 minutes

#### B. Staggered Instance Startup
- **Purpose**: Prevent all instances from making API calls simultaneously
- **Implementation**: Each broker instance waits `i * 30` seconds before starting
- **Result**: Broker 1 starts immediately, Broker 2 waits 30s, Broker 3 waits 60s

#### C. Enhanced IAM Permissions
- **Added**: Additional EC2 permissions for describe operations
- **Permissions**: `ec2:DescribeInstanceInformation`, `ec2:DescribeInstanceAttribute`, etc.
- **Purpose**: Ensure instances have proper permissions for API calls

### 2. Deployment Status Checker Script

#### Features
- **File**: `check_redpanda_deployment.sh`
- **Purpose**: Monitor deployment with built-in retry logic
- **Capabilities**:
  - Checks CloudFormation stack status
  - Monitors EC2 instance status
  - Verifies SSM agent registration
  - Handles rate limiting with exponential backoff

#### Usage
```bash
# Basic usage
./check_redpanda_deployment.sh

# With different region
./check_redpanda_deployment.sh --region us-west-2

# Show help
./check_redpanda_deployment.sh --help
```

## Alternative Solutions (Manual AWS Console Steps)

If you prefer to handle this through the AWS Console as originally described:

### IAM Role Configuration
1. Navigate to IAM console → Roles
2. Find role: `AWSReservedSSO_admin_6ea8bcb335328753`
3. Add inline policy with EC2 describe permissions
4. Attach role to problematic instances

### Instance-Level Configuration
1. EC2 console → Instances
2. Select instance ID: `i-05fb6cdc993b243aa`
3. Actions → Instance settings → Attach/Replace IAM role
4. Apply the enhanced role

## Best Practices Going Forward

### 1. Deployment Strategy
- **Staged Deployment**: Deploy instances in batches rather than all at once
- **Health Checks**: Wait for each batch to be healthy before proceeding
- **Monitoring**: Use CloudWatch to monitor API call rates

### 2. Error Handling
- **Retry Logic**: Always implement exponential backoff for AWS API calls
- **Graceful Degradation**: Continue deployment even if some API calls fail
- **Logging**: Comprehensive logging for troubleshooting

### 3. Infrastructure as Code
- **CDK/CloudFormation**: Use infrastructure as code for consistent deployments
- **Parameterization**: Make retry settings configurable
- **Testing**: Test deployments in staging environments first

## Monitoring and Troubleshooting

### CloudWatch Metrics to Monitor
- `AWS/EC2` → `StatusCheckFailed`
- `AWS/SSM` → `CommandsSucceeded/Failed`
- `AWS/Usage` → API call rates

### Common Issues and Solutions
1. **Rate Limiting**: Increase delays between API calls
2. **SSM Agent Not Responding**: Check VPC endpoints and security groups
3. **Instance Startup Failures**: Review CloudWatch logs and user data scripts

### Troubleshooting Commands
```bash
# Check instance status
aws ec2 describe-instances --instance-ids i-xxxxx

# Check SSM agent status
aws ssm describe-instance-information --query "InstanceInformationList[?InstanceId=='i-xxxxx']"

# View CloudFormation events
aws cloudformation describe-stack-events --stack-name ShastaRedpandaStack
```

## Testing the Solution

### 1. Deploy the Updated Stack
```bash
# Deploy with the new improvements
cdk deploy ShastaRedpandaStack
```

### 2. Monitor Deployment
```bash
# Use the status checker script
./check_redpanda_deployment.sh
```

### 3. Verify Functionality
```bash
# Check if all instances are running
aws ec2 describe-instances --filters "Name=tag:Purpose,Values=RedpandaBroker" --query "Reservations[].Instances[].State.Name"

# Verify SSM connectivity
aws ssm describe-instance-information --query "InstanceInformationList[?contains(InstanceId, 'i-')].[InstanceId,PingStatus]" --output table
```

## Conclusion

The implemented solution addresses the rate limiting issue through:
1. **Proactive measures**: Staggered deployment and exponential backoff
2. **Enhanced permissions**: Proper IAM roles and policies
3. **Monitoring tools**: Status checker script for ongoing monitoring
4. **Best practices**: Retry logic and graceful error handling

This approach is more robust than manual console fixes and provides a foundation for scalable, production-ready deployments. 