# VS Code SSH Setup Guide for Shasta Infrastructure

## Prerequisites
1. VS Code with Remote-SSH extension installed
2. AWS CLI configured with appropriate credentials
3. SSH key file `john.davis.pem` (from your CDK stack)

## Step 1: Get IP Addresses

Run the provided script to get the necessary IP addresses:

```bash
chmod +x get_instance_ips.sh
./get_instance_ips.sh
```

## Step 2: Configure SSH

### Set up SSH key permissions:
```bash
chmod 400 ~/.ssh/john.davis.pem
```

### Add SSH config to `~/.ssh/config`:
Copy the SSH config entries from the script output to your `~/.ssh/config` file.

## Step 3: Test SSH Connection

### Test bastion connection:
```bash
ssh shasta-bastion
```

### Test producer connection through bastion:
```bash
ssh shasta-producer-0
```

## Step 4: VS Code Remote SSH Setup

### Method 1: Using Command Palette
1. Open VS Code
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
3. Type "Remote-SSH: Connect to Host..."
4. Select your configured host (e.g., `shasta-producer-0`)
5. VS Code will establish the connection through the bastion

### Method 2: Using SSH Config
1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
2. Type "Remote-SSH: Open Configuration File..."
3. Select your SSH config file (usually `~/.ssh/config`)
4. Verify your configuration is correct
5. Use `Ctrl+Shift+P` → "Remote-SSH: Connect to Host..."

## Step 5: VS Code Extensions on Remote Host

Once connected, you can install extensions on the remote host:
- Install language extensions (Python, Node.js, etc.)
- Install Git extensions
- Install Docker extensions (since your instances have Docker)

## Troubleshooting

### Common Issues:

1. **Connection timeout**: Check security group rules and ensure bastion host is running
2. **Permission denied**: Verify SSH key permissions (`chmod 400`)
3. **Host key verification failed**: Add `-o StrictHostKeyChecking=no` to SSH config if needed
4. **ProxyJump not working**: Ensure OpenSSH version 7.3+ is installed

### Advanced SSH Config Options:

```ssh
# For debugging connections
Host shasta-producer-*
    User ec2-user
    IdentityFile ~/.ssh/john.davis.pem
    ProxyJump shasta-bastion
    ForwardAgent yes
    ServerAliveInterval 60
    LogLevel DEBUG
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
```

### SSH Agent Setup (Optional):
```bash
# Add key to SSH agent
ssh-add ~/.ssh/john.davis.pem

# List added keys
ssh-add -l
```

## Security Notes

1. The bastion host is accessible from anywhere (0.0.0.0/0) on port 22
2. Producer instances are only accessible from the bastion host
3. Keep your SSH private key secure and never commit it to version control
4. Consider using AWS Systems Manager Session Manager for additional security

## Alternative: AWS Systems Manager Session Manager

Your CDK stack also configures SSM Session Manager. You can use this instead of SSH:

```bash
# Connect to producer instance via SSM
aws ssm start-session --target <instance-id> --region us-east-1
```

## Monitoring and Logging

Your instances have CloudWatch agent installed. You can monitor:
- SSH connection logs: `/var/log/auth.log`
- System logs: `/var/log/messages`
- Docker logs: `docker logs <container-name>` 