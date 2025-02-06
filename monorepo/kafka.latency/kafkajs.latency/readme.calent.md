

```text:readme.txt
MSK Cluster Recreation Steps
===========================

This document outlines the steps to recreate an MSK cluster using Terraform after manual deletion.

Prerequisites:
- AWS CLI installed
- Terraform installed 
- Access to AWS account: caylent-poc (060795946368)

Step 1: Configure AWS SSO
aws configure sso

Enter when prompted:
SSO start URL: https://d-90676f6748.awsapps.com/start/#
SSO Region: us-east-1
Select account: caylent-poc
Select role: AdministratorAccess
Name profile: caylent-poc-admin

Step 2: Login to AWS SSO
aws sso login --profile caylent-poc-admin
export AWS_PROFILE=caylent-poc-admin

Step 3: Modify Terraform Provider
Edit terraform/dev/providers.tf to use SSO directly:

provider "aws" {
  region = "us-east-1"
  default_tags {
    tags = {
      Environment        = "dev"
      Project            = "kafka-poc"
      ManagedByTerraform = "True"
    }
  }
  # Remove assume_role block to use SSO directly
}

Step 4: Navigate to Terraform Directory
cd terraform/dev

Step 5: Remove Old MSK Cluster from State
terraform state rm aws_msk_cluster.msk_cluster

Step 6: Apply MSK Cluster Configuration
terraform apply -target=aws_msk_cluster.msk_cluster

Step 7: Confirm Apply
Type 'yes' when prompted

Step 8: Update SSM Parameter with New Broker Addresses
After cluster creation completes (15-20 minutes), update the SSM parameter:

aws ssm put-parameter \
    --name "/cantina/kafka/connect_string" \
    --type "String" \
    --value "b-3.cantinadevmskcluster.o1qw9s.c21.kafka.us-east-1.amazonaws.com:9092,b-2.cantinadevmskcluster.o1qw9s.c21.kafka.us-east-1.amazonaws.com:9092,b-1.cantinadevmskcluster.o1qw9s.c21.kafka.us-east-1.amazonaws.com:9092" \
    --overwrite

Verify the update:
aws ssm get-parameter --name "/cantina/kafka/connect_string" --query "Parameter.Value" --output text

MSK Cluster Configuration Details:
- 3 broker nodes using kafka.m7g.xlarge instances
- Deployed across 3 private subnets
- Kafka version 3.6.0
- Enhanced monitoring enabled
- Logging to S3 bucket "cantina-dev-msk-logs"
- PLAINTEXT authentication (no encryption between client and broker)
- Security group and networking configured via terraform

Troubleshooting:
If you encounter permission issues, verify:
1. AWS SSO login is active (aws sts get-caller-identity)
2. AWS_PROFILE is set correctly
3. Terraform provider configuration doesn't include assume_role block
```

```text:readme.txt
MSK Cluster Recreation Steps
===========================

This document outlines the steps to recreate an MSK cluster using Terraform after manual deletion.

Prerequisites:
- AWS CLI installed
- Terraform installed 
- Access to AWS account: caylent-poc (060795946368)

Step 1: Configure AWS SSO
aws configure sso

Enter when prompted:
SSO start URL: https://d-90676f6748.awsapps.com/start/#
SSO Region: us-east-1
Select account: caylent-poc
Select role: AdministratorAccess
Name profile: caylent-poc-admin

Step 2: Login to AWS SSO
aws sso login --profile caylent-poc-admin
export AWS_PROFILE=caylent-poc-admin

Step 3: Modify Terraform Provider
Edit terraform/dev/providers.tf to use SSO directly:

provider "aws" {
  region = "us-east-1"
  default_tags {
    tags = {
      Environment        = "dev"
      Project            = "kafka-poc"
      ManagedByTerraform = "True"
    }
  }
  # Remove assume_role block to use SSO directly
}

Step 4: Navigate to Terraform Directory
cd terraform/dev

Step 5: Remove Old MSK Cluster from State
terraform state rm aws_msk_cluster.msk_cluster

Step 6: Apply MSK Cluster Configuration
terraform apply -target=aws_msk_cluster.msk_cluster

Step 7: Confirm Apply
Type 'yes' when prompted

Note: MSK cluster creation takes approximately 15-20 minutes to complete.

MSK Cluster Configuration Details:
- 3 broker nodes using kafka.m7g.xlarge instances
- Deployed across 3 private subnets
- Kafka version 3.6.0
- Enhanced monitoring enabled
- Logging to S3 bucket "cantina-dev-msk-logs"
- PLAINTEXT authentication (no encryption between client and broker)
- Security group and networking configured via terraform

Troubleshooting:
If you encounter permission issues, verify:
1. AWS SSO login is active (aws sts get-caller-identity)
2. AWS_PROFILE is set correctly
3. Terraform provider configuration doesn't include assume_role block
```
