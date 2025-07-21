# RedPanda Cluster Deployment Steps

## 🎯 **Approach: CDK for Infrastructure, Bash for RedPanda**

This deployment uses a **separated approach**:
1. **CDK** deploys AWS infrastructure (EC2, VPC, security groups)
2. **Bash scripts** install and configure RedPanda software

## 📋 **Prerequisites (5 minutes)**

1. **AWS CLI configured:**
   ```bash
   aws configure
   aws sts get-caller-identity  # Verify credentials
   ```

2. **AWS CDK installed:**
   ```bash
   npm install -g aws-cdk
   cdk --version
   ```

3. **EC2 Key Pair in us-east-1:**
   ```bash
   aws ec2 describe-key-pairs --key-names john.davis --region us-east-1
   # Create if needed: aws ec2 create-key-pair --key-name john.davis --output text --query 'KeyMaterial' > john.davis.pem
   ```

4. **Project setup:**
   ```bash
   cd /root/repo/dev/omni/monorepo/cdk/shasta-cdk
   npm install
   ```

## 🏗️ **Step 1: Deploy AWS Infrastructure (CDK) - 10-15 minutes**

5. **Deploy infrastructure:**
   ```bash
   ./deploy.sh deploy
   
   # Or manually:
   # ./scripts/aws-infrastructure-deploy.sh deploy
   ```

   **What this deploys:**
   - ✅ VPC with 3 AZs (public/private subnets)
   - ✅ Security groups for RedPanda ports
   - ✅ 3x i4i.2xlarge instances (RedPanda nodes)
   - ✅ 1x c5n.4xlarge instance (load testing)
   - ✅ High-performance GP3 storage
   - ✅ IAM roles, SSM access

   **What this does NOT deploy:**
   - ❌ RedPanda software
   - ❌ Cluster configuration
   - ❌ Performance testing tools

6. **Verify infrastructure:**
   ```bash
   ./deploy.sh status
   
   # Should show 4 running instances:
   # - 3 RedPanda nodes (redpanda-node-id: 0, 1, 2)
   # - 1 Load test instance
   ```

## ⚙️ **Step 2: Install RedPanda (Bash Scripts) - 10-15 minutes**

7. **Automated setup:**
   ```bash
   # Copy john.davis.pem to current directory if not already there
   cp ~/john.davis.pem .
   
   # Run automated setup
   ./deploy.sh setup
   
   # Or manually:
   # ./scripts/setup-cluster-post-deploy.sh
   ```

   **What this does:**
   - 🔧 Copies scripts to all instances
   - 📦 Installs RedPanda binary on each node
   - ⚙️ Configures 3-node cluster with low-latency settings
   - 🧪 Sets up load testing environment
   - ✅ Verifies cluster health
   - 🚀 Runs quick performance test

## 🧪 **Step 3: Verify and Test - 5 minutes**

8. **Connect to load test instance:**
   ```bash
   # Get public IP from step 6 output
   ssh -i john.davis.pem ec2-user@<load-test-public-ip>
   ```

9. **Check cluster status:**
   ```bash
   rpk cluster info --brokers $BOOTSTRAP_SERVERS
   rpk topic list --brokers $BOOTSTRAP_SERVERS
   ```

10. **Run performance tests:**
    ```bash
    # Quick test
    ./redpanda-performance-tests.sh quick
    
    # Full test suite
    ./redpanda-performance-tests.sh all
    
    # Specific tests
    ./redpanda-performance-tests.sh throughput
    ./redpanda-performance-tests.sh latency
    ```

## 🔗 **Access Methods**

### SSH Access
```bash
# Load test instance (has public IP)
ssh -i john.davis.pem ec2-user@<load-test-public-ip>

# RedPanda nodes (private IPs - access via load test instance or bastion)
ssh -i john.davis.pem ec2-user@<redpanda-private-ip>
```

### AWS SSM Session Manager (no key required)
```bash
# List instances
aws ec2 describe-instances --filters "Name=tag:shasta-role,Values=redpanda-node,load-test"

# Connect to any instance
aws ssm start-session --target <instance-id>
```

## 📊 **Manual Installation (Alternative)**

If you prefer manual control:

### On each RedPanda node:
```bash
# SSH to each node
ssh -i john.davis.pem ec2-user@<node-ip>

# Copy scripts
scp -i john.davis.pem scripts/install-redpanda.sh ec2-user@<node-ip>:
scp -i john.davis.pem scripts/setup-redpanda-cluster.sh ec2-user@<node-ip>:

# Install and configure (run on each node with appropriate NODE_ID)
sudo ./install-redpanda.sh
NODE_ID=0 ./setup-redpanda-cluster.sh  # Use 0, 1, 2 for each node
```

### On load test instance:
```bash
ssh -i john.davis.pem ec2-user@<load-test-ip>

# Copy performance scripts
scp -i john.davis.pem scripts/redpanda-performance-tests.sh ec2-user@<load-test-ip>:

# Set up environment
export BOOTSTRAP_SERVERS="<redpanda-ip1>:9092,<redpanda-ip2>:9092,<redpanda-ip3>:9092"
echo "export BOOTSTRAP_SERVERS=\"$BOOTSTRAP_SERVERS\"" >> ~/.bashrc

# Run tests
./redpanda-performance-tests.sh quick
```

## 🧹 **Cleanup**

When you're done:

```bash
./deploy.sh destroy
# Or: ./scripts/aws-infrastructure-deploy.sh destroy
```

⚠️ **Warning:** This will permanently delete all AWS resources!

## 🛠️ **Troubleshooting**

### Infrastructure Issues
- Check CloudFormation console for stack status
- Verify AWS permissions and key pair existence
- Ensure CDK is bootstrapped: `cdk bootstrap`

### RedPanda Issues
- Check service status: `sudo systemctl status redpanda`
- View logs: `sudo journalctl -u redpanda -f`
- Test connectivity: `telnet <node-ip> 9092`

### Script Issues
- Ensure scripts are executable: `chmod +x scripts/*.sh`
- Check SSH connectivity and key permissions: `chmod 400 john.davis.pem`
- Verify instances are running: `./deploy.sh status`

## 📈 **Performance Expectations**

With the low-latency optimizations:
- **Throughput**: 100K+ messages/second per partition
- **Latency**: Sub-millisecond p99 within same AZ
- **Storage**: 16K IOPS, 1GB/s throughput per node
- **Network**: Enhanced networking on i4i instances

## 🎯 **Summary**

**Total Time:** ~30-35 minutes
1. **Infrastructure (CDK):** 10-15 minutes
2. **RedPanda Setup (Bash):** 10-15 minutes  
3. **Testing & Verification:** 5 minutes

This approach gives you:
- ✅ **Full control** over each deployment phase
- ✅ **Easy troubleshooting** with separated concerns
- ✅ **Production-ready** low-latency cluster
- ✅ **Comprehensive testing** tools included 