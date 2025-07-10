# VS Code SSH over AWS SSM Session Manager

## Overview
SSH over SSM eliminates the need for a bastion host and provides secure access to private EC2 instances through AWS Systems Manager Session Manager. This is more secure because:

- No SSH keys stored on instances
- No open SSH ports (22) required
- All traffic goes through AWS's secure infrastructure
- Full audit trail in CloudTrail
- Works with private instances without internet access

## Prerequisites
1. AWS CLI installed and configured
2. Session Manager plugin for AWS CLI
3. VS Code with Remote-SSH extension
4. EC2 instances with SSM agent installed (your CDK stack already does this)

## Step 1: Install Session Manager Plugin

### On macOS:
```bash
curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/mac/sessionmanager-bundle.zip" -o "sessionmanager-bundle.zip"
unzip sessionmanager-bundle.zip
sudo ./sessionmanager-bundle/install -i /usr/local/sessionmanagerplugin -b /usr/local/bin/session-manager-plugin
```

### On Linux:
```bash
curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/linux_64bit/session-manager-plugin.rpm" -o "session-manager-plugin.rpm"
sudo yum install -y session-manager-plugin.rpm
```

### On Windows:
Download and run the installer from:
https://s3.amazonaws.com/session-manager-downloads/plugin/latest/windows/SessionManagerPluginSetup.exe

## Step 2: Configure SSH to Use SSM

Add this to your `~/.ssh/config`:

```ssh
# SSM SSH Configuration for Shasta Infrastructure
Host shasta-producer-ssm-*
    User ec2-user
    ProxyCommand aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters 'portNumber=%p' --region us-east-1
    IdentityFile ~/.ssh/john.davis.pem
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    ServerAliveInterval 60
    ForwardAgent yes

# Generic SSM pattern for any instance
Host i-*
    User ec2-user
    ProxyCommand aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters 'portNumber=%p' --region us-east-1
    IdentityFile ~/.ssh/john.davis.pem
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    ServerAliveInterval 60
    ForwardAgent yes
```

## Step 3: Get Instance IDs

Run the provided script to get instance IDs:

```bash
chmod +x get_instance_ids_ssm.sh
./get_instance_ids_ssm.sh
```

## Step 4: Test SSM Connection

### Test basic SSM connection:
```bash
# Replace <instance-id> with actual instance ID
aws ssm start-session --target <instance-id> --region us-east-1
```

### Test SSH over SSM:
```bash
# Using the SSH config
ssh shasta-producer-0
```

## Step 5: Configure VS Code for SSH over SSM

### Method 1: Direct Instance ID Connection
Add specific hosts to your SSH config using the output from the script:

```ssh
Host shasta-producer-0
    HostName i-1234567890abcdef0  # Replace with actual instance ID
    User ec2-user
    ProxyCommand aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters 'portNumber=%p' --region us-east-1
    IdentityFile ~/.ssh/john.davis.pem
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    ServerAliveInterval 60
    ForwardAgent yes
```

### Method 2: Generic Pattern
Use the generic pattern for any instance:

```ssh
# Connect directly using instance ID
Host i-*
    User ec2-user
    ProxyCommand aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters 'portNumber=%p' --region us-east-1
    IdentityFile ~/.ssh/john.davis.pem
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    ServerAliveInterval 60
    ForwardAgent yes
```

Then connect using: `ssh i-1234567890abcdef0`

## Step 6: VS Code Remote SSH

1. Open VS Code
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
3. Type "Remote-SSH: Connect to Host..."
4. Enter either:
   - `shasta-producer-0` (if using named hosts)
   - `i-1234567890abcdef0` (direct instance ID)

## Advantages of SSH over SSM

### Security Benefits:
- **No bastion host required** - eliminates attack surface
- **No SSH keys on instances** - AWS manages authentication
- **No open ports** - all traffic tunneled through AWS
- **Full audit trail** - all sessions logged in CloudTrail
- **IAM-based access control** - use AWS permissions

### Operational Benefits:
- **No network dependency** - works from anywhere with AWS access
- **No VPN required** - direct connection through AWS
- **Works with private instances** - no internet gateway needed
- **Automatic session management** - AWS handles connection lifecycle

## Required IAM Permissions

Your CDK stack already includes these, but for reference:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "ssm:StartSession",
                "ssm:TerminateSession",
                "ssm:ResumeSession",
                "ssm:DescribeSessions",
                "ssm:GetConnectionStatus",
                "ssm:DescribeInstanceInformation",
                "ssm:DescribeInstanceProperties",
                "ssmmessages:CreateControlChannel",
                "ssmmessages:CreateDataChannel",
                "ssmmessages:OpenControlChannel",
                "ssmmessages:OpenDataChannel",
                "ec2:DescribeInstances"
            ],
            "Resource": "*"
        }
    ]
}
```

## Troubleshooting

### Common Issues:

1. **Session Manager plugin not found**:
   ```bash
   # Verify installation
   session-manager-plugin --version
   ```

2. **SSM agent not running**:
   ```bash
   # Check on instance
   sudo systemctl status amazon-ssm-agent
   ```

3. **Permission denied**:
   - Verify AWS credentials are configured
   - Check IAM permissions for SSM
   - Ensure instance has SSM role attached

4. **Connection timeout**:
   - Verify instance is running
   - Check SSM agent status
   - Ensure VPC endpoints are configured (your CDK stack has these)

### Debug Commands:

```bash
# List SSM-managed instances
aws ssm describe-instance-information --region us-east-1

# Check instance SSM status
aws ssm describe-instance-information --region us-east-1 --instance-information-filter-list key=InstanceIds,valueSet=i-1234567890abcdef0

# Test session manager directly
aws ssm start-session --target i-1234567890abcdef0 --region us-east-1

# SSH with verbose output
ssh -v shasta-producer-0
```

## Comparison: Bastion vs SSM

| Feature | Bastion Host | SSH over SSM |
|---------|--------------|--------------|
| Security | Requires bastion maintenance | No additional infrastructure |
| Cost | Additional EC2 instance | No extra cost |
| Complexity | SSH key management | AWS credential management |
| Audit | SSH logs only | Full CloudTrail integration |
| Access Control | Security groups | IAM policies |
| Network | Requires public subnet | Works with private-only |

## Migration Strategy

You can use both approaches simultaneously:

1. **Keep bastion** for traditional SSH workflows
2. **Use SSM** for VS Code and development
3. **Gradually migrate** teams to SSM approach
4. **Decommission bastion** when fully migrated

This gives you flexibility while maintaining security and operational excellence. 