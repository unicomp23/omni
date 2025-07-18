import {Duration, Stack, StackProps} from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';

export const REDPANDA_VPC_ID = 'RedpandaVpcId';
export const REDPANDA_SECURITY_GROUP_ID = 'RedpandaSecurityGroupId';
export const REDPANDA_BROKER_IPS = 'RedpandaBrokerIPs';
export const REDPANDA_LOADTEST_IP = 'RedpandaLoadTestIP';
export const REDPANDA_S3_BUCKET_NAME = 'RedpandaS3BucketName';

export class ShastaRedpandaStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        // Create VPC optimized for low latency
        const vpc = new ec2.Vpc(this, 'RedpandaVpc', {
            vpcName: 'RedpandaVpc',
            maxAzs: 3,
            ipAddresses: ec2.IpAddresses.cidr('10.1.0.0/16'),
            enableDnsHostnames: true,
            enableDnsSupport: true,
            subnetConfiguration: [
                {
                    subnetType: ec2.SubnetType.PUBLIC,
                    name: 'Public',
                    cidrMask: 24,
                },
                {
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    name: 'Private',
                    cidrMask: 24,
                },
            ],
        });

        // Add VPC endpoints for SSM
        vpc.addInterfaceEndpoint('SsmEndpoint', {
            service: ec2.InterfaceVpcEndpointAwsService.SSM,
        });

        vpc.addInterfaceEndpoint('SsmMessagesEndpoint', {
            service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
        });

        vpc.addInterfaceEndpoint('Ec2MessagesEndpoint', {
            service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
        });



        // Add S3 Gateway endpoint for SSM
        vpc.addGatewayEndpoint('S3Endpoint', {
            service: ec2.GatewayVpcEndpointAwsService.S3,
        });

        // Create security group
        const securityGroup = new ec2.SecurityGroup(this, 'RedpandaSecurityGroup', {
            vpc: vpc,
            description: 'Security group for Redpanda cluster',
            allowAllOutbound: true,
        });

        // Add ingress rules for Redpanda
        securityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(22),
            'SSH access'
        );
        securityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(9092),
            'Kafka API'
        );
        securityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(9644),
            'Admin API'
        );
        securityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(8082),
            'Pandaproxy (REST API)'
        );
        securityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(8081),
            'Schema Registry'
        );
        securityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(33145),
            'RPC port'
        );
        securityGroup.addIngressRule(
            securityGroup,
            ec2.Port.allTraffic(),
            'Allow all traffic within security group'
        );

        // Add ingress rules for EC2 Instance Connect (SSH from AWS service)
        // EC2 Instance Connect IP ranges for us-east-1
        securityGroup.addIngressRule(
            ec2.Peer.ipv4('18.206.107.24/29'),
            ec2.Port.tcp(22),
            'EC2 Instance Connect us-east-1'
        );
        securityGroup.addIngressRule(
            ec2.Peer.ipv4('3.16.146.0/29'),
            ec2.Port.tcp(22),
            'EC2 Instance Connect us-east-1 additional range'
        );

        // Create placement group for low latency
        const placementGroup = new ec2.CfnPlacementGroup(this, 'RedpandaPlacementGroup', {
            strategy: 'cluster',
        });

        // Create S3 bucket for data storage
        const s3Bucket = new s3.Bucket(this, 'RedpandaS3Bucket', {
            bucketName: `redpanda-data-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            versioned: false,
            encryption: s3.BucketEncryption.S3_MANAGED,
        });

        // Create IAM role for EC2 instances
        const ec2Role = new iam.Role(this, 'RedpandaEc2Role', {
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
            ],
        });

        // Add EC2 Instance Connect permissions
        ec2Role.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'ec2-instance-connect:SendSSHPublicKey',
            ],
            resources: [
                `arn:aws:ec2:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:instance/*`,
            ],
            conditions: {
                StringEquals: {
                    'ec2:osuser': ['ec2-user', 'ubuntu', 'root'],
                },
            },
        }));

        // Grant S3 read/write permissions to EC2 role for broker discovery and data storage
        s3Bucket.grantReadWrite(ec2Role);

        // Reference existing key pair for EC2 instances
        const keyPair = ec2.KeyPair.fromKeyPairName(this, 'RedpandaKeyPair', 'john.davis');

        // User data script for Redpanda installation and configuration
        const getBrokerUserData = (brokerId: number, totalBrokers: number) => {
            const userData = ec2.UserData.forLinux({
                shebang: '#!/bin/bash',
            });
            
            userData.addCommands(
                'yum update -y',
                'yum install -y htop iotop ec2-instance-connect jq',
                
                // Install Redpanda
                'curl -1sLf "https://dl.redpanda.com/nzc4ZYQK3WRGd9sy/redpanda/cfg/setup/bash.rpm.sh" | bash',
                'yum install -y redpanda',
                
                // Performance tuning for low latency
                'echo "net.core.rmem_max = 134217728" >> /etc/sysctl.conf',
                'echo "net.core.wmem_max = 134217728" >> /etc/sysctl.conf',
                'echo "net.ipv4.tcp_rmem = 4096 87380 134217728" >> /etc/sysctl.conf',
                'echo "net.ipv4.tcp_wmem = 4096 65536 134217728" >> /etc/sysctl.conf',
                'echo "net.core.netdev_max_backlog = 5000" >> /etc/sysctl.conf',
                'sysctl -p',
                
                // Get instance metadata
                'INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)',
                'LOCAL_IP=$(curl -s http://169.254.169.254/latest/meta-data/local-ipv4)',
                'REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)',
                
                // Store this broker's IP in S3
                `echo "Registering broker ${brokerId} with IP $LOCAL_IP in S3..."`,
                `aws s3 cp - s3://${s3Bucket.bucketName}/cluster/broker-${brokerId}.json <<EOF
{
  "broker_id": ${brokerId},
  "ip_address": "$LOCAL_IP",
  "registered_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "instance_id": "$INSTANCE_ID"
}
EOF`,
                
                // Wait for all brokers to register their IPs in S3 with timeout fallback
                'echo "Waiting for all brokers to register their IPs in S3..."',
                'for i in {1..60}; do',
                `  BROKER_COUNT=$(aws s3 ls s3://${s3Bucket.bucketName}/cluster/ | grep "broker-.*\\.json" | wc -l)`,
                `  if [ "$BROKER_COUNT" -eq "${totalBrokers}" ]; then`,
                '    echo "All brokers registered!"',
                '    break',
                `  elif [ "$BROKER_COUNT" -ge "2" ] && [ "$i" -gt "30" ]; then`,
                '    echo "Found $BROKER_COUNT brokers, proceeding with partial cluster (will auto-heal)"',
                '    break',
                '  fi',
                '  echo "Found $BROKER_COUNT/${totalBrokers} brokers, waiting... (attempt $i/60)"',
                '  sleep 10',
                'done',
                
                // Download all broker info from S3 and extract IPs
                'echo "Downloading broker information from S3..."',
                `aws s3 sync s3://${s3Bucket.bucketName}/cluster/ /tmp/cluster/`,
                'if ls /tmp/cluster/broker-*.json 1> /dev/null 2>&1; then',
                '  BROKER_IPS=$(cat /tmp/cluster/broker-*.json | jq -r ".ip_address" | sort -V | tr "\\n" " " | sed "s/ $//")',
                '  echo "Broker IPs from S3: $BROKER_IPS"',
                'else',
                '  echo "⚠️  No broker files found, using self-IP only for bootstrap"',
                '  BROKER_IPS="$LOCAL_IP"',
                'fi',
                
                // Configure Redpanda
                'mkdir -p /etc/redpanda',
                'cat > /etc/redpanda/redpanda.yaml << EOF',
                'redpanda:',
                '  data_directory: /var/lib/redpanda/data',
                `  node_id: ${brokerId}`,
                '  rpc_server:',
                '    address: 0.0.0.0',
                '    port: 33145',
                '  kafka_api:',
                '    - address: 0.0.0.0',
                '      port: 9092',
                '  admin:',
                '    - address: 0.0.0.0',
                '      port: 9644',
                '  seed_servers:',
                'EOF',
                
                // Add seed servers dynamically
                'BROKER_IP_ARRAY=($BROKER_IPS)',
                'for ip in "${BROKER_IP_ARRAY[@]}"; do',
                '  echo "    - host:" >> /etc/redpanda/redpanda.yaml',
                '  echo "        address: $ip" >> /etc/redpanda/redpanda.yaml',
                '  echo "        port: 33145" >> /etc/redpanda/redpanda.yaml',
                'done',
                
                // Add performance settings
                'cat >> /etc/redpanda/redpanda.yaml << EOF',
                '  ',
                '  # Low latency optimizations',
                '  group_initial_rebalance_delay_ms: 0',
                '  group_new_member_join_timeout_ms: 5000',
                '  log_segment_size: 134217728',
                '  compacted_log_segment_size: 134217728',
                '  max_compacted_log_segment_size: 536870912',
                '  ',
                '  # Performance tuning',
                '  disable_batch_cache: false',
                '  batch_cache_ttl_ms: 1000',
                '  ',
                'pandaproxy:',
                '  pandaproxy_api:',
                '    - address: 0.0.0.0',
                '      port: 8082',
                '      ',
                'schema_registry:',
                '  schema_registry_api:',
                '    - address: 0.0.0.0',
                '      port: 8081',
                'EOF',
                
                // Validate configuration before starting
                'echo "Validating Redpanda configuration..."',
                'redpanda --config-file /etc/redpanda/redpanda.yaml --check || echo "⚠️  Config validation failed, proceeding anyway"',
                
                // Start Redpanda service
                'echo "Starting Redpanda service..."',
                'systemctl enable redpanda',
                'systemctl start redpanda',
                
                // Wait for service to be ready
                'echo "Waiting for Redpanda to start..."',
                'for i in {1..30}; do',
                '  if systemctl is-active --quiet redpanda; then',
                '    echo "✓ Redpanda service is running"',
                '    break',
                '  fi',
                '  echo "Waiting for Redpanda service... (attempt $i/30)"',
                '  sleep 2',
                'done',
                
                // Install RPK
                'curl -LO https://github.com/redpanda-data/redpanda/releases/latest/download/rpk-linux-amd64.zip',
                'unzip rpk-linux-amd64.zip',
                'mv rpk /usr/local/bin/',
                'chmod +x /usr/local/bin/rpk',
                
                // Wait for service to start
                'sleep 30',
                
                            // Configure RPK with modern syntax
            'rpk profile create cluster 2>/dev/null || true',
            'rpk profile set brokers "localhost:9092"',
                'rpk profile use cluster',
                
                // Mark broker as ready
                `echo "Broker ${brokerId} ready at $(date)" | aws s3 cp - s3://${s3Bucket.bucketName}/cluster/broker-${brokerId}-ready.txt`,
            );
            
            return userData;
        };

        // Get subnets for each AZ
        const privateSubnets = vpc.privateSubnets;
        const publicSubnets = vpc.publicSubnets;

        // Create launch template for broker instances
        const brokerLaunchTemplate = new ec2.LaunchTemplate(this, 'RedpandaBrokerLaunchTemplate', {
            launchTemplateName: 'RedpandaBrokerLaunchTemplate',
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.C5N, ec2.InstanceSize.XLARGE),
            machineImage: ec2.MachineImage.latestAmazonLinux2(),
            securityGroup: securityGroup,
            role: ec2Role,
            keyPair: keyPair,
            blockDevices: [
                {
                    deviceName: '/dev/xvda',
                    volume: ec2.BlockDeviceVolume.ebs(100, {
                        volumeType: ec2.EbsDeviceVolumeType.GP3,
                        iops: 3000,
                        throughput: 125,
                    }),
                },
            ],
        });

        // Create broker instances using CfnInstance with Launch Template
        const brokerInstances: ec2.CfnInstance[] = [];

        for (let i = 0; i < 3; i++) {
            const brokerInstance = new ec2.CfnInstance(this, `RedpandaBroker${i + 1}`, {
                launchTemplate: {
                    launchTemplateId: brokerLaunchTemplate.launchTemplateId,
                    version: brokerLaunchTemplate.latestVersionNumber,
                },
                subnetId: privateSubnets[i].subnetId,
                userData: cdk.Fn.base64(getBrokerUserData(i, 3).render()),
            });

            brokerInstances.push(brokerInstance);
            
            // Add dependency on placement group
            brokerInstance.addDependency(placementGroup);
        }

        // Create load test instance with minimal user data
        const loadTestUserData = ec2.UserData.forLinux({
            shebang: '#!/bin/bash',
        });
        
        loadTestUserData.addCommands(
            'yum update -y',
            'yum install -y htop iotop python3 python3-pip git awscli ec2-instance-connect jq nc',
            
            // Install Redpanda (for RPK client)
            'curl -1sLf "https://dl.redpanda.com/nzc4ZYQK3WRGd9sy/redpanda/cfg/setup/bash.rpm.sh" | bash',
            'yum install -y redpanda',
            
            // Install RPK
            'curl -LO https://github.com/redpanda-data/redpanda/releases/latest/download/rpk-linux-amd64.zip',
            'unzip rpk-linux-amd64.zip',
            'mv rpk /usr/local/bin/',
            'chmod +x /usr/local/bin/rpk',
            
            // Install Python dependencies
            'pip3 install boto3 requests',
            
            // Set S3 bucket name as environment variable
            `echo 'export REDPANDA_S3_BUCKET=${s3Bucket.bucketName}' >> /home/ec2-user/.bashrc`,
            `echo 'export REDPANDA_S3_BUCKET=${s3Bucket.bucketName}' >> /root/.bashrc`,
            
            // Create a simple broker discovery script
            'cat > /home/ec2-user/discover_brokers.sh << "EOF"',
            '#!/bin/bash',
            'echo "Discovering Redpanda brokers..."',
            'mkdir -p /tmp/cluster',
            `aws s3 sync s3://${s3Bucket.bucketName}/cluster/ /tmp/cluster/ 2>/dev/null`,
            '# Check if any broker JSON files exist (fix shell syntax)',
            'if ls /tmp/cluster/broker-*.json 1> /dev/null 2>&1; then',
            '  BROKER_IPS=$(cat /tmp/cluster/broker-*.json | jq -r ".ip_address" | sort -V | tr "\\n" "," | sed "s/,$//")',
            '  BROKER_STRING=$(echo $BROKER_IPS | sed "s/,/:9092,/g"):9092',
            '  echo "Found brokers: $BROKER_IPS"',
            '  echo "Broker connection string: $BROKER_STRING"',
            '  # Use modern RPK syntax',
            '  rpk profile create cluster 2>/dev/null || true',
            '  rpk profile set brokers "$BROKER_STRING"',
            '  rpk profile use cluster',
            '  echo "export REDPANDA_BROKER_IPS=$BROKER_IPS" >> ~/.bashrc',
            '  echo "export REDPANDA_BROKERS=$BROKER_STRING" >> ~/.bashrc',
            '  echo "✓ RPK configured with brokers: $BROKER_STRING"',
            'else',
            '  echo "⚠️  No broker JSON files found in S3. Brokers may still be starting up."',
            'fi',
            'EOF',
            'chmod +x /home/ec2-user/discover_brokers.sh',
            'chown ec2-user:ec2-user /home/ec2-user/discover_brokers.sh',
            
            // Run broker discovery
            'sudo -u ec2-user /home/ec2-user/discover_brokers.sh',
            
            // Create a simple welcome message
            'cat > /home/ec2-user/README.md << "EOF"',
            '# Redpanda Load Test Instance',
            '',
            'Welcome to the Redpanda load test instance!',
            '',
            '## Quick Start',
            '1. Run `./discover_brokers.sh` to find and configure brokers',
            '2. Use `rpk cluster info` to check cluster status',
            '3. Use `rpk topic list` to see available topics',
            '',
            '## Environment Variables',
            '- REDPANDA_S3_BUCKET: S3 bucket for cluster data',
            '- REDPANDA_BROKER_IPS: Comma-separated broker IPs',
            '- REDPANDA_BROKERS: Broker connection string',
            '',
            '## Basic Commands',
            '- `rpk cluster health` - Check cluster health',
            '- `rpk topic create test --partitions 3` - Create topic',
            '- `echo "test" | rpk topic produce test` - Produce message',
            '- `rpk topic consume test --offset start --num 1` - Consume message',
            'EOF',
            'chown ec2-user:ec2-user /home/ec2-user/README.md',
            `aws s3 sync s3://$BUCKET/cluster/ /tmp/cluster/`,
            'BROKER_IPS=$(cat /tmp/cluster/broker-*.json 2>/dev/null | jq -r ".ip_address" | sort -V | tr "\\n" "," | sed "s/,$//")',
            'BROKER_STRING=$(echo $BROKER_IPS | sed "s/,/:9092,/g"):9092',
            '',
            'echo "Discovered broker IPs: $BROKER_IPS"',
            'echo "Broker string: $BROKER_STRING"',
            'echo',
            '',
            'if [ -z "$BROKER_IPS" ]; then',
            '    echo "✗ No broker IPs found!"',
            '    exit 1',
            'fi',
            '',
            '# Create RPK profile with discovered brokers',
            'echo "2. Setting up RPK profile..."',
            'rpk profile create cluster 2>/dev/null || true',
            'rpk profile set brokers "$BROKER_STRING"',
            'rpk profile use cluster',
            '',
            '# Test cluster health',
            'echo "3. Testing cluster health..."',
            'if rpk cluster health; then',
            '    echo "✓ Cluster health check passed"',
            'else',
            '    echo "✗ Cluster health check failed"',
            '    echo "Brokers may still be starting up..."',
            'fi',
            'echo',
            '',
            '# Test cluster info',
            'echo "4. Getting cluster information..."',
            'if rpk cluster info; then',
            '    echo "✓ Cluster info retrieved"',
            'else',
            '    echo "✗ Failed to get cluster info"',
            'fi',
            'echo',
            '',
            '# Test individual brokers',
            'echo "5. Testing individual brokers..."',
            'IFS="," read -ra BROKER_ARRAY <<< "$BROKER_IPS"',
            'for broker in "${BROKER_ARRAY[@]}"; do',
            '    echo "Testing broker $broker:9092..."',
            '    if timeout 10 rpk cluster info --brokers $broker:9092 > /dev/null 2>&1; then',
            '        echo "✓ Broker $broker:9092 is responsive"',
            '    else',
            '        echo "✗ Broker $broker:9092 is not responsive"',
            '    fi',
            'done',
            'echo',
            '',
            '# Test basic topic operations',
            'echo "6. Testing topic operations..."',
            'TEST_TOPIC="validation-test-$(date +%s)"',
            'echo "Creating test topic: $TEST_TOPIC"',
            '',
            'if rpk topic create $TEST_TOPIC --partitions 3 --replicas 3; then',
            '    echo "✓ Topic creation successful"',
            '    ',
            '    # Test produce/consume',
            '    echo "Testing produce/consume..."',
            '    TEST_MESSAGE="test-message-$(date +%s)"',
            '    ',
            '    if echo "$TEST_MESSAGE" | rpk topic produce $TEST_TOPIC --key test-key; then',
            '        echo "✓ Message production successful"',
            '        ',
            '        # Try to consume the message',
            '        if timeout 10 rpk topic consume $TEST_TOPIC --offset start --num 1 | grep -q "$TEST_MESSAGE"; then',
            '            echo "✓ Message consumption successful"',
            '        else',
            '            echo "✗ Message consumption failed"',
            '        fi',
            '    else',
            '        echo "✗ Message production failed"',
            '    fi',
            '    ',
            '    # Clean up test topic',
            '    echo "Cleaning up test topic..."',
            '    if rpk topic delete $TEST_TOPIC; then',
            '        echo "✓ Test topic deleted"',
            '    else',
            '        echo "✗ Failed to delete test topic"',
            '    fi',
            'else',
            '    echo "✗ Topic creation failed"',
            'fi',
            'echo',
            '',
            '# Test admin API',
            'echo "7. Testing admin API..."',
            'IFS="," read -ra BROKER_ARRAY <<< "$BROKER_IPS"',
            'ADMIN_BROKER=${BROKER_ARRAY[0]}',
            'if curl -s -m 5 http://$ADMIN_BROKER:9644/v1/cluster/health_overview > /dev/null; then',
            '    echo "✓ Admin API accessible on $ADMIN_BROKER:9644"',
            'else',
            '    echo "✗ Admin API not accessible on $ADMIN_BROKER:9644"',
            'fi',
            'echo',
            '',
            '# Network latency test',
            'echo "8. Network latency test..."',
            'for ip in "${BROKER_ARRAY[@]}"; do',
            '    if ping -c 1 -W 1 $ip > /dev/null 2>&1; then',
            '        LATENCY=$(ping -c 1 $ip | grep "time=" | cut -d"=" -f4 | cut -d" " -f1)',
            '        echo "✓ Ping to $ip: ${LATENCY}ms"',
            '    else',
            '        echo "✗ Ping to $ip failed"',
            '    fi',
            'done',
            'echo',
            '',
            'echo "=== Validation Complete ==="',
            'echo "Broker IPs: $BROKER_IPS"',
            'echo "Use \"rpk cluster info\" for more details"',
            'echo "To run performance tests: python3 ~/latency_test.py"',
            'echo "To test S3 integration: python3 ~/s3_test.py"',
            'EOF',
            'chmod +x /home/ec2-user/validate_cluster.sh',
            'chown ec2-user:ec2-user /home/ec2-user/validate_cluster.sh',
            
            // Create quick-start script for immediate testing
            'cat > /home/ec2-user/quick_test.sh << EOF',
            '#!/bin/bash',
            '',
            'echo "=== Quick Redpanda Cluster Test ==="',
            '',
            '# Get broker IPs from S3',
            'echo "Getting broker IPs from S3..."',
            `BUCKET=$(aws cloudformation describe-stacks --stack-name ${this.stackName} --query 'Stacks[0].Outputs[?OutputKey==\`RedpandaS3BucketName\`].OutputValue' --output text)`,
            'mkdir -p /tmp/cluster',
            `aws s3 sync s3://$BUCKET/cluster/ /tmp/cluster/`,
            'BROKER_IPS=$(cat /tmp/cluster/broker-*.json 2>/dev/null | jq -r ".ip_address" | sort -V | tr "\\n" "," | sed "s/,$//")',
            'BROKER_STRING=$(echo $BROKER_IPS | sed "s/,/:9092,/g"):9092',
            '',
            'if [ -z "$BROKER_IPS" ]; then',
            '    echo "✗ No broker IPs found! Brokers may still be starting up."',
            '    exit 1',
            'fi',
            '',
            'echo "Found brokers: $BROKER_IPS"',
            '',
            '# Setup RPK profile',
            'echo "Setting up RPK profile..."',
            'rpk profile create cluster 2>/dev/null || true',
            'rpk profile set brokers "$BROKER_STRING"',
            'rpk profile use cluster',
            '',
            '# Quick cluster test',
            'echo "Testing cluster..."',
            'rpk cluster info',
            'echo',
            'rpk cluster health',
            'echo',
            '',
            '# Test topic operations',
            'echo "Testing topic operations..."',
            'rpk topic create quick-test --partitions 1 --replicas 3',
            'echo "Hello Redpanda!" | rpk topic produce quick-test',
            'echo "Consuming message:"',
            'timeout 5 rpk topic consume quick-test --offset start --num 1',
            'rpk topic delete quick-test',
            '',
            'echo "=== Quick test complete! ==="',
            'echo "For full validation, run: ./validate_cluster.sh"',
            'EOF',
            'chmod +x /home/ec2-user/quick_test.sh',
            'chown ec2-user:ec2-user /home/ec2-user/quick_test.sh',
            
            // Create environment setup script
            'cat > /home/ec2-user/setup_env.sh << EOF',
            '#!/bin/bash',
            '',
            'echo "=== Setting up Redpanda Environment ==="',
            '',
            '# Get broker IPs from S3',
            `BUCKET=$(aws cloudformation describe-stacks --stack-name ${this.stackName} --query 'Stacks[0].Outputs[?OutputKey==\`RedpandaS3BucketName\`].OutputValue' --output text)`,
            'mkdir -p /tmp/cluster',
            `aws s3 sync s3://$BUCKET/cluster/ /tmp/cluster/`,
            'BROKER_IPS=$(cat /tmp/cluster/broker-*.json 2>/dev/null | jq -r ".ip_address" | sort -V | tr "\\n" "," | sed "s/,$//")',
            'BROKER_STRING=$(echo $BROKER_IPS | sed "s/,/:9092,/g"):9092',
            '',
            'if [ ! -z "$BROKER_IPS" ]; then',
            '    echo "export REDPANDA_BROKER_IPS=$BROKER_IPS" >> ~/.bashrc',
            '    echo "export REDPANDA_BROKERS=$BROKER_STRING" >> ~/.bashrc',
            '    echo "export REDPANDA_S3_BUCKET=$BUCKET" >> ~/.bashrc',
            '    ',
            '    # Setup RPK profile',
            '    rpk profile create cluster 2>/dev/null || true',
            '    rpk profile set brokers "$BROKER_STRING"',
            '    rpk profile use cluster',
            '    ',
            '    echo "✓ Environment variables set"',
            '    echo "✓ RPK profile configured"',
            '    echo "Run: source ~/.bashrc"',
            'else',
            '    echo "✗ No broker IPs found yet"',
            'fi',
            'EOF',
            'chmod +x /home/ec2-user/setup_env.sh',
            'chown ec2-user:ec2-user /home/ec2-user/setup_env.sh',
            
            // Create README file
            'cat > /home/ec2-user/README.md << EOF',
            '# Redpanda Cluster Testing',
            '',
            'This instance is configured for testing your Redpanda cluster.',
            '',
            '## Available Scripts',
            '',
            '### Quick Test (Recommended)',
            '```bash',
            './quick_test.sh',
            '```',
            'Runs a fast cluster validation with basic produce/consume test.',
            '',
            '### Full Validation',
            '```bash',
            './validate_cluster.sh',
            '```',
            'Comprehensive cluster validation including:',
            '- Broker discovery from S3',
            '- Cluster health and info',
            '- Individual broker testing',
            '- Topic operations',
            '- Admin API testing',
            '- Network latency testing',
            '',
            '### Environment Setup',
            '```bash',
            './setup_env.sh',
            'source ~/.bashrc',
            '```',
            'Sets up environment variables and RPK profile for manual testing.',
            '',
            '### Performance Testing',
            '```bash',
            'python3 latency_test.py',
            '```',
            'Advanced latency testing with statistics.',
            '',
            '### S3 Integration Test',
            '```bash',
            'python3 s3_test.py',
            '```',
            'Tests S3 connectivity and operations.',
            '',
            '## Manual RPK Commands',
            '',
            'After running `setup_env.sh`, you can use RPK directly:',
            '',
            '```bash',
            '# Cluster operations',
            'rpk cluster info',
            'rpk cluster health',
            'rpk cluster nodes',
            '',
            '# Topic operations',
            'rpk topic create my-topic --partitions 3 --replicas 3',
            'rpk topic list',
            'rpk topic describe my-topic',
            '',
            '# Produce/consume',
            'echo "Hello World" | rpk topic produce my-topic',
            'rpk topic consume my-topic --offset start',
            '',
            '# Topic cleanup',
            'rpk topic delete my-topic',
            '```',
            '',
            '## Troubleshooting',
            '',
            '### If brokers are not found:',
            '1. Wait 5-10 minutes for brokers to start',
            '2. Check S3 for broker registration:',
            '   ```bash',
            `   aws s3 ls s3://$(aws cloudformation describe-stacks --stack-name ${this.stackName} --query "Stacks[0].Outputs[?OutputKey==\`RedpandaS3BucketName\`].OutputValue" --output text)/cluster/`,
            '   ```',
            '3. Check broker instance status:',
            '   ```bash',
            `   aws ec2 describe-instances --filters "Name=tag:Name,Values=${this.stackName}/RedpandaBroker*" --query "Reservations[].Instances[].[InstanceId,State.Name]" --output table`,
            '   ```',
            '',
            '### Direct broker access:',
            '```bash',
            '# Connect to broker via SSM',
            `BROKER_ID=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=${this.stackName}/RedpandaBroker1" --query "Reservations[0].Instances[0].InstanceId" --output text)`,
            'aws ssm start-session --target $BROKER_ID',
            '```',
            '',
            '## Architecture',
            '',
            '- **Brokers**: 3 x c5n.xlarge instances in private subnets',
            '- **Discovery**: S3-based broker IP discovery',
            '- **Storage**: GP3 EBS volumes + S3 for metadata',
            '- **Networking**: VPC with placement groups for low latency',
            '- **Monitoring**: Admin API on port 9644',
            '',
            '## Expected Performance',
            '',
            '- **P50 Latency**: < 5ms',
            '- **P95 Latency**: < 15ms',
            '- **P99 Latency**: < 25ms',
            '- **Throughput**: 10K+ msgs/sec per partition',
            '',
            'Performance will vary based on message size, partition count, and replication factor.',
            'EOF',
            'chown ec2-user:ec2-user /home/ec2-user/README.md',
        );

        const loadTestInstance = new ec2.Instance(this, 'RedpandaLoadTest', {
            vpc: vpc,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.C5N, ec2.InstanceSize.LARGE),
            machineImage: ec2.MachineImage.latestAmazonLinux2(),
            securityGroup: securityGroup,
            vpcSubnets: {
                subnets: [publicSubnets[0]],
            },
            role: ec2Role,
            userData: loadTestUserData,
            keyPair: keyPair,
            associatePublicIpAddress: true,
        });

        // Add dependencies - load test instance should start after brokers
        for (const broker of brokerInstances) {
            loadTestInstance.node.addDependency(broker);
        }

        // Outputs
        new cdk.CfnOutput(this, REDPANDA_VPC_ID, {
            value: vpc.vpcId,
            description: 'Redpanda VPC ID',
            exportName: REDPANDA_VPC_ID,
        });

        new cdk.CfnOutput(this, REDPANDA_SECURITY_GROUP_ID, {
            value: securityGroup.securityGroupId,
            description: 'Redpanda Security Group ID',
            exportName: REDPANDA_SECURITY_GROUP_ID,
        });

        new cdk.CfnOutput(this, REDPANDA_BROKER_IPS, {
            value: brokerInstances.map(instance => instance.attrPrivateIp).join(','),
            description: 'Redpanda Broker Private IPs',
            exportName: REDPANDA_BROKER_IPS,
        });

        new cdk.CfnOutput(this, REDPANDA_LOADTEST_IP, {
            value: loadTestInstance.instancePublicIp,
            description: 'Redpanda Load Test Instance Public IP',
            exportName: REDPANDA_LOADTEST_IP,
        });

        new cdk.CfnOutput(this, REDPANDA_S3_BUCKET_NAME, {
            value: s3Bucket.bucketName,
            description: 'Redpanda S3 Bucket Name',
            exportName: REDPANDA_S3_BUCKET_NAME,
        });

        new cdk.CfnOutput(this, 'RedpandaKeyPairName', {
            value: 'john.davis',
            description: 'Redpanda Key Pair Name for EC2 access',
        });
    }
} 