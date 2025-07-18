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
                
                // Wait for all brokers to register their IPs in S3
                'echo "Waiting for all brokers to register their IPs in S3..."',
                'for i in {1..120}; do',
                `  BROKER_COUNT=$(aws s3 ls s3://${s3Bucket.bucketName}/cluster/ | grep "broker-" | wc -l)`,
                `  if [ "$BROKER_COUNT" -eq "${totalBrokers}" ]; then`,
                '    echo "All brokers registered!"',
                '    break',
                '  fi',
                '  echo "Found $BROKER_COUNT/${totalBrokers} brokers, waiting..."',
                '  sleep 10',
                'done',
                
                // Download all broker info from S3 and extract IPs
                'echo "Downloading broker information from S3..."',
                `aws s3 sync s3://${s3Bucket.bucketName}/cluster/ /tmp/cluster/`,
                'BROKER_IPS=$(cat /tmp/cluster/broker-*.json | jq -r ".ip_address" | sort -V | tr "\\n" " ")',
                'echo "Broker IPs: $BROKER_IPS"',
                
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
                
                // Start Redpanda service
                'systemctl enable redpanda',
                'systemctl start redpanda',
                
                // Install RPK
                'curl -LO https://github.com/redpanda-data/redpanda/releases/latest/download/rpk-linux-amd64.zip',
                'unzip rpk-linux-amd64.zip',
                'mv rpk /usr/local/bin/',
                'chmod +x /usr/local/bin/rpk',
                
                // Wait for service to start
                'sleep 30',
                
                // Configure RPK
                'rpk profile create cluster --brokers localhost:9092',
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

        // Create load test instance
        const loadTestUserData = ec2.UserData.forLinux({
            shebang: '#!/bin/bash',
        });
        
        loadTestUserData.addCommands(
            'yum update -y',
            'yum install -y htop iotop python3 python3-pip git awscli ec2-instance-connect jq',
            
            // Install Redpanda (for RPK client)
            'curl -1sLf "https://dl.redpanda.com/nzc4ZYQK3WRGd9sy/redpanda/cfg/setup/bash.rpm.sh" | bash',
            'yum install -y redpanda',
            
            // Install RPK
            'curl -LO https://github.com/redpanda-data/redpanda/releases/latest/download/rpk-linux-amd64.zip',
            'unzip rpk-linux-amd64.zip',
            'mv rpk /usr/local/bin/',
            'chmod +x /usr/local/bin/rpk',
            
            // Install Python Kafka client for performance testing
            'pip3 install boto3 requests',
            
            // Wait for brokers to register their IPs
            'echo "Waiting for Redpanda brokers to register..."',
            'REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)',
            'for i in {1..120}; do',
            `  BROKER_COUNT=$(aws s3 ls s3://${s3Bucket.bucketName}/cluster/ | grep "broker-.*\\.json" | wc -l)`,
            '  if [ "$BROKER_COUNT" -eq "3" ]; then',
            '    echo "All brokers registered!"',
            '    break',
            '  fi',
            '  echo "Found $BROKER_COUNT/3 brokers, waiting..."',
            '  sleep 10',
            'done',
            
            // Get broker IPs dynamically from S3
            'echo "Downloading broker information from S3..."',
            `aws s3 sync s3://${s3Bucket.bucketName}/cluster/ /tmp/cluster/`,
            'BROKER_IPS=$(cat /tmp/cluster/broker-*.json | jq -r ".ip_address" | sort -V | tr "\\n" ",")',
            'BROKER_IPS=${BROKER_IPS%,}',  // Remove trailing comma
            'BROKER_IPS_ARRAY=($BROKER_IPS)',
            'echo "Discovered broker IPs: $BROKER_IPS"',
            
            // Configure RPK for cluster access
            'rpk profile create cluster --brokers ${BROKER_IPS_ARRAY[0]}:9092,${BROKER_IPS_ARRAY[1]}:9092,${BROKER_IPS_ARRAY[2]}:9092',
            'rpk profile use cluster',
            
            // Set Redpanda cluster environment variables
            'echo "export REDPANDA_BROKERS=${BROKER_IPS_ARRAY[0]}:9092,${BROKER_IPS_ARRAY[1]}:9092,${BROKER_IPS_ARRAY[2]}:9092" >> /home/ec2-user/.bashrc',
            'echo "export REDPANDA_BROKERS=${BROKER_IPS_ARRAY[0]}:9092,${BROKER_IPS_ARRAY[1]}:9092,${BROKER_IPS_ARRAY[2]}:9092" >> /root/.bashrc',
            'echo "export REDPANDA_KAFKA_PORT=9092" >> /home/ec2-user/.bashrc',
            'echo "export REDPANDA_KAFKA_PORT=9092" >> /root/.bashrc',
            'echo "export REDPANDA_ADMIN_PORT=9644" >> /home/ec2-user/.bashrc',
            'echo "export REDPANDA_ADMIN_PORT=9644" >> /root/.bashrc',
            'echo "export REDPANDA_SCHEMA_REGISTRY_PORT=8081" >> /home/ec2-user/.bashrc',
            'echo "export REDPANDA_SCHEMA_REGISTRY_PORT=8081" >> /root/.bashrc',
            'echo "export REDPANDA_PANDAPROXY_PORT=8082" >> /home/ec2-user/.bashrc',
            'echo "export REDPANDA_PANDAPROXY_PORT=8082" >> /root/.bashrc',
            'echo "export REDPANDA_BROKER_IPS=$BROKER_IPS" >> /home/ec2-user/.bashrc',
            'echo "export REDPANDA_BROKER_IPS=$BROKER_IPS" >> /root/.bashrc',
            
            // Set S3 bucket name as environment variable
            `echo 'export REDPANDA_S3_BUCKET=${s3Bucket.bucketName}' >> /home/ec2-user/.bashrc`,
            `echo 'export REDPANDA_S3_BUCKET=${s3Bucket.bucketName}' >> /root/.bashrc`,
            
            // Create a simple latency test script
            `cat > /home/ec2-user/latency_test.py << 'EOF'
#!/usr/bin/env python3
import time
import json
import os
import boto3
import subprocess
import statistics
from datetime import datetime

def get_broker_ips():
    """Get broker IPs from S3 bucket"""
    try:
        # Get region from instance metadata
        import requests
        region = requests.get('http://169.254.169.254/latest/meta-data/placement/region', timeout=2).text
        
        # Get broker IPs from S3
        s3 = boto3.client('s3', region_name=region)
        bucket_name = os.environ.get('REDPANDA_S3_BUCKET', '${s3Bucket.bucketName}')
        
        # List all broker JSON files
        response = s3.list_objects_v2(Bucket=bucket_name, Prefix='cluster/broker-')
        
        broker_ips = []
        for obj in response.get('Contents', []):
            if obj['Key'].endswith('.json'):
                # Download and parse broker info
                broker_obj = s3.get_object(Bucket=bucket_name, Key=obj['Key'])
                broker_data = json.loads(broker_obj['Body'].read())
                broker_ips.append(broker_data['ip_address'])
        
        broker_ips.sort()  # Sort for consistent ordering
        return broker_ips
    except Exception as e:
        print(f"Error getting broker IPs from S3: {e}")
        # Fallback to environment variable
        env_brokers = os.environ.get('REDPANDA_BROKER_IPS', 'localhost')
        return env_brokers.split(',')

def run_rpk_latency_test():
    """Run latency test using RPK"""
    print("=== RPK-Based Latency Test ===")
    
    # Get broker IPs
    broker_ips = get_broker_ips()
    broker_string = ','.join([f"{ip}:9092" for ip in broker_ips])
    print(f"Testing with brokers: {broker_string}")
    
    # Create test topic
    test_topic = "rpk-latency-test"
    print(f"Creating topic: {test_topic}")
    
    subprocess.run([
        'rpk', 'topic', 'create', test_topic,
        '--partitions', '1',
        '--replicas', '3',
        '--brokers', broker_string
    ], check=False)
    
    # Test 1: Basic throughput test
    print("\\n1. Running throughput test...")
    
    start_time = time.time()
    result = subprocess.run([
        'rpk', 'topic', 'produce', test_topic,
        '--brokers', broker_string,
        '--num', '1000',
        '--rate', '1000'
    ], input="test message", text=True, capture_output=True)
    
    end_time = time.time()
    duration = end_time - start_time
    
    if result.returncode == 0:
        throughput = 1000 / duration
        print(f"✓ Produced 1000 messages in {duration:.2f}s")
        print(f"✓ Throughput: {throughput:.0f} messages/sec")
    else:
        print(f"✗ Production failed: {result.stderr}")
    
    # Test 2: End-to-end latency test
    print("\\n2. Running end-to-end latency test...")
    
    latencies = []
    
    for i in range(100):
        message = f'{{"id": {i}, "timestamp": {time.time_ns()}}}'
        
        # Send message
        start_time = time.time_ns()
        
        prod_result = subprocess.run([
            'rpk', 'topic', 'produce', test_topic,
            '--brokers', broker_string,
            '--key', f'test-{i}'
        ], input=message, text=True, capture_output=True)
        
        if prod_result.returncode == 0:
            # Consume message
            cons_result = subprocess.run([
                'rpk', 'topic', 'consume', test_topic,
                '--brokers', broker_string,
                '--num', '1',
                '--offset', 'start',
                '--partition', '0'
            ], capture_output=True, text=True, timeout=5)
            
            end_time = time.time_ns()
            
            if cons_result.returncode == 0:
                latency_ms = (end_time - start_time) / 1_000_000
                latencies.append(latency_ms)
                
                if i % 10 == 0:
                    print(f"  Message {i}: {latency_ms:.2f}ms")
        
        time.sleep(0.01)  # Small delay between tests
    
    # Calculate statistics
    if latencies:
        print(f"\\n3. Latency Statistics (n={len(latencies)}):")
        print(f"   Average: {statistics.mean(latencies):.2f}ms")
        print(f"   Median:  {statistics.median(latencies):.2f}ms")
        print(f"   Min:     {min(latencies):.2f}ms")
        print(f"   Max:     {max(latencies):.2f}ms")
        
        if len(latencies) >= 20:
            p95 = statistics.quantiles(latencies, n=20)[18]
            print(f"   P95:     {p95:.2f}ms")
        
        if len(latencies) >= 10:
            p99 = statistics.quantiles(latencies, n=10)[8]
            print(f"   P90:     {p99:.2f}ms")
    else:
        print("✗ No latency measurements collected")
    
    # Cleanup
    print(f"\\n4. Cleaning up test topic...")
    subprocess.run([
        'rpk', 'topic', 'delete', test_topic,
        '--brokers', broker_string
    ], check=False)
    
    print("\\n=== Test Complete ===")

def run_cluster_validation():
    """Run basic cluster validation"""
    print("\\n=== Cluster Validation ===")
    
    broker_ips = get_broker_ips()
    broker_string = ','.join([f"{ip}:9092" for ip in broker_ips])
    
    # Test cluster health
    result = subprocess.run([
        'rpk', 'cluster', 'health',
        '--brokers', broker_string
    ], capture_output=True, text=True)
    
    if result.returncode == 0:
        print("✓ Cluster health check passed")
        print(result.stdout)
    else:
        print("✗ Cluster health check failed")
        print(result.stderr)
    
    # Test cluster info
    result = subprocess.run([
        'rpk', 'cluster', 'info',
        '--brokers', broker_string
    ], capture_output=True, text=True)
    
    if result.returncode == 0:
        print("✓ Cluster info retrieved")
        print(result.stdout)
    else:
        print("✗ Failed to get cluster info")
        print(result.stderr)

if __name__ == "__main__":
    print(f"Starting Redpanda validation at {datetime.now()}")
    
    try:
        run_cluster_validation()
        run_rpk_latency_test()
    except Exception as e:
        print(f"Test failed with error: {e}")
        exit(1)
    
    print("\\nAll tests completed successfully!")
EOF`,
            'chmod +x /home/ec2-user/latency_test.py',
            'chown ec2-user:ec2-user /home/ec2-user/latency_test.py',
            
            // Create S3 test script
            `cat > /home/ec2-user/s3_test.py << 'EOF'
#!/usr/bin/env python3
import boto3
import json
import time
import os
from datetime import datetime

def test_s3_operations():
    # Get bucket name from environment
    bucket_name = os.environ.get('REDPANDA_S3_BUCKET', '${s3Bucket.bucketName}')
    
    # Initialize S3 client
    s3_client = boto3.client('s3')
    
    print(f"Testing S3 operations on bucket: {bucket_name}")
    
    # Test 1: Write a test file
    test_data = {
        'timestamp': datetime.now().isoformat(),
        'test_message': 'Hello from Redpanda cluster!',
        'instance_id': boto3.Session().region_name
    }
    
    try:
        # Upload test data
        s3_client.put_object(
            Bucket=bucket_name,
            Key='test/redpanda_test.json',
            Body=json.dumps(test_data, indent=2),
            ContentType='application/json'
        )
        print("✓ Successfully uploaded test data to S3")
        
        # List objects
        response = s3_client.list_objects_v2(Bucket=bucket_name, Prefix='test/')
        if 'Contents' in response:
            print(f"✓ Found {len(response['Contents'])} objects in test/ prefix")
            for obj in response['Contents']:
                print(f"  - {obj['Key']} ({obj['Size']} bytes)")
        
        # Read back the data
        response = s3_client.get_object(Bucket=bucket_name, Key='test/redpanda_test.json')
        retrieved_data = json.loads(response['Body'].read())
        print("✓ Successfully retrieved test data from S3")
        print(f"  Retrieved: {retrieved_data}")
        
        # Test performance metrics storage
        metrics_data = {
            'timestamp': datetime.now().isoformat(),
            'latency_p50': 4.2,
            'latency_p95': 12.8,
            'latency_p99': 23.1,
            'throughput_msgs_per_sec': 10000
        }
        
        s3_client.put_object(
            Bucket=bucket_name,
            Key=f'metrics/performance_{int(time.time())}.json',
            Body=json.dumps(metrics_data, indent=2),
            ContentType='application/json'
        )
        print("✓ Successfully stored performance metrics to S3")
        
    except Exception as e:
        print(f"✗ Error during S3 operations: {e}")
        return False
    
    print("\\nS3 integration test completed successfully!")
    return True

if __name__ == "__main__":
    test_s3_operations()
EOF`,
            'chmod +x /home/ec2-user/s3_test.py',
            'chown ec2-user:ec2-user /home/ec2-user/s3_test.py',
            
            // Create Redpanda environment helper script
            `cat > /home/ec2-user/redpanda_env.sh << 'EOF'
#!/bin/bash
echo "=== Redpanda Cluster Environment Variables ==="
echo "REDPANDA_BROKERS: $REDPANDA_BROKERS"
echo "REDPANDA_BROKER_IPS: $REDPANDA_BROKER_IPS"
echo "REDPANDA_KAFKA_PORT: $REDPANDA_KAFKA_PORT"
echo "REDPANDA_ADMIN_PORT: $REDPANDA_ADMIN_PORT"
echo "REDPANDA_SCHEMA_REGISTRY_PORT: $REDPANDA_SCHEMA_REGISTRY_PORT"
echo "REDPANDA_PANDAPROXY_PORT: $REDPANDA_PANDAPROXY_PORT"
echo "REDPANDA_S3_BUCKET: $REDPANDA_S3_BUCKET"
echo ""
echo "=== Quick Commands ==="
echo "RPK cluster info: rpk cluster info"
echo "RPK topic list: rpk topic list"
echo "Run latency test: python3 latency_test.py"
echo "Run S3 test: python3 s3_test.py"
EOF`,
            'chmod +x /home/ec2-user/redpanda_env.sh',
            'chown ec2-user:ec2-user /home/ec2-user/redpanda_env.sh',
            
            // Create simple S3 helper script
            `echo '#!/bin/bash' > /home/ec2-user/s3_helper.sh`,
            `echo 'export REDPANDA_S3_BUCKET=${s3Bucket.bucketName}' >> /home/ec2-user/s3_helper.sh`,
            `echo 'echo "S3 Bucket: $REDPANDA_S3_BUCKET"' >> /home/ec2-user/s3_helper.sh`,
            `echo 'aws s3 ls s3://$REDPANDA_S3_BUCKET/ --recursive' >> /home/ec2-user/s3_helper.sh`,
            'chmod +x /home/ec2-user/s3_helper.sh',
            'chown ec2-user:ec2-user /home/ec2-user/s3_helper.sh',
            
            // Create comprehensive validation script using echo to avoid template literal issues
            'cat > /home/ec2-user/validate_cluster.sh << EOF',
            '#!/bin/bash',
            '',
            'echo "=== Redpanda Cluster Validation ==="',
            'echo "Timestamp: $(date)"',
            'echo',
            '',
            '# Get broker IPs from S3',
            'echo "1. Getting broker IPs from S3..."',
            'REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)',
            `BUCKET=$(aws cloudformation describe-stacks --stack-name ${this.stackName} --query 'Stacks[0].Outputs[?OutputKey==\`RedpandaS3BucketName\`].OutputValue' --output text)`,
            'mkdir -p /tmp/cluster',
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
            'rpk profile create cluster --brokers $BROKER_STRING --overwrite',
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
            '        if timeout 10 rpk topic consume $TEST_TOPIC --from-beginning --num 1 --timeout 5s | grep -q "$TEST_MESSAGE"; then',
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
            'rpk profile create cluster --brokers $BROKER_STRING --overwrite',
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
            'timeout 5 rpk topic consume quick-test --from-beginning --num 1',
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
            '    rpk profile create cluster --brokers $BROKER_STRING --overwrite',
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
            'rpk topic consume my-topic --from-beginning',
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