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

        // Grant S3 read/write permissions to EC2 role
        s3Bucket.grantReadWrite(ec2Role);

        // Reference existing key pair for EC2 instances
        const keyPair = ec2.KeyPair.fromKeyPairName(this, 'RedpandaKeyPair', 'john.davis');

        // User data script for Redpanda installation and configuration
        const getBrokerUserData = (brokerId: number, brokerIps: string[]) => {
            const userData = ec2.UserData.forLinux({
                shebang: '#!/bin/bash',
            });
            
            userData.addCommands(
                'yum update -y',
                'yum install -y htop iotop ec2-instance-connect',
                
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
                
                // Configure Redpanda for low latency
                'mkdir -p /etc/redpanda',
                `cat > /etc/redpanda/redpanda.yaml << 'EOF'
redpanda:
  data_directory: /var/lib/redpanda/data
  node_id: ${brokerId}
  rpc_server:
    address: 0.0.0.0
    port: 33145
  kafka_api:
    - address: 0.0.0.0
      port: 9092
  admin:
    - address: 0.0.0.0
      port: 9644
  seed_servers:
${brokerIps.map((ip, idx) => `    - host:
        address: ${ip}
        port: 33145`).join('\n')}
  
  # Low latency optimizations
  group_initial_rebalance_delay_ms: 0
  group_new_member_join_timeout_ms: 5000
  log_segment_size: 134217728
  compacted_log_segment_size: 134217728
  max_compacted_log_segment_size: 536870912
  
  # Performance tuning
  disable_batch_cache: false
  batch_cache_ttl_ms: 1000
  
pandaproxy:
  pandaproxy_api:
    - address: 0.0.0.0
      port: 8082
      
schema_registry:
  schema_registry_api:
    - address: 0.0.0.0
      port: 8081
EOF`,
                
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
        const brokerIps = ['10.1.1.100', '10.1.2.100', '10.1.3.100']; // Static IPs for predictable configuration

        for (let i = 0; i < 3; i++) {
            const brokerInstance = new ec2.CfnInstance(this, `RedpandaBroker${i + 1}`, {
                launchTemplate: {
                    launchTemplateId: brokerLaunchTemplate.launchTemplateId,
                    version: brokerLaunchTemplate.latestVersionNumber,
                },
                subnetId: privateSubnets[i].subnetId,
                userData: cdk.Fn.base64(getBrokerUserData(i, brokerIps).render()),
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
            'yum install -y htop iotop python3 python3-pip git awscli ec2-instance-connect',
            
            // Install Redpanda (for RPK client)
            'curl -1sLf "https://dl.redpanda.com/nzc4ZYQK3WRGd9sy/redpanda/cfg/setup/bash.rpm.sh" | bash',
            'yum install -y redpanda',
            
            // Install RPK
            'curl -LO https://github.com/redpanda-data/redpanda/releases/latest/download/rpk-linux-amd64.zip',
            'unzip rpk-linux-amd64.zip',
            'mv rpk /usr/local/bin/',
            'chmod +x /usr/local/bin/rpk',
            
            // Install Python Kafka client for performance testing
            'pip3 install kafka-python confluent-kafka boto3',
            
            // Configure RPK for cluster access
            `rpk profile create cluster --brokers ${brokerIps.join(',').replace(/\d+\.\d+\.\d+\.\d+/g, (ip) => ip + ':9092')}`,
            'rpk profile use cluster',
            
            // Set Redpanda cluster environment variables
            `echo 'export REDPANDA_BROKERS=${brokerIps.join(',').replace(/\d+\.\d+\.\d+\.\d+/g, (ip) => ip + ':9092')}' >> /home/ec2-user/.bashrc`,
            `echo 'export REDPANDA_BROKERS=${brokerIps.join(',').replace(/\d+\.\d+\.\d+\.\d+/g, (ip) => ip + ':9092')}' >> /root/.bashrc`,
            `echo 'export REDPANDA_KAFKA_PORT=9092' >> /home/ec2-user/.bashrc`,
            `echo 'export REDPANDA_KAFKA_PORT=9092' >> /root/.bashrc`,
            `echo 'export REDPANDA_ADMIN_PORT=9644' >> /home/ec2-user/.bashrc`,
            `echo 'export REDPANDA_ADMIN_PORT=9644' >> /root/.bashrc`,
            `echo 'export REDPANDA_SCHEMA_REGISTRY_PORT=8081' >> /home/ec2-user/.bashrc`,
            `echo 'export REDPANDA_SCHEMA_REGISTRY_PORT=8081' >> /root/.bashrc`,
            `echo 'export REDPANDA_PANDAPROXY_PORT=8082' >> /home/ec2-user/.bashrc`,
            `echo 'export REDPANDA_PANDAPROXY_PORT=8082' >> /root/.bashrc`,
            `echo 'export REDPANDA_BROKER_IPS=${brokerIps.join(',')}' >> /home/ec2-user/.bashrc`,
            `echo 'export REDPANDA_BROKER_IPS=${brokerIps.join(',')}' >> /root/.bashrc`,
            
            // Set S3 bucket name as environment variable
            `echo 'export REDPANDA_S3_BUCKET=${s3Bucket.bucketName}' >> /home/ec2-user/.bashrc`,
            `echo 'export REDPANDA_S3_BUCKET=${s3Bucket.bucketName}' >> /root/.bashrc`,
            
            // Create a simple latency test script
            `cat > /home/ec2-user/latency_test.py << 'EOF'
#!/usr/bin/env python3
import time
import json
import os
from kafka import KafkaProducer, KafkaConsumer
from kafka.errors import KafkaError
import threading
import statistics

def latency_test():
    # Get broker list from environment variable
    brokers = os.environ.get('REDPANDA_BROKERS', '${brokerIps.join(',').replace(/\d+\.\d+\.\d+\.\d+/g, (ip) => ip + ':9092')}').split(',')
    
    # Configure for low latency
    producer = KafkaProducer(
        bootstrap_servers=brokers,
        value_serializer=lambda v: json.dumps(v).encode('utf-8'),
        acks='all',
        retries=0,
        batch_size=1,
        linger_ms=0,
        buffer_memory=33554432,
        compression_type=None
    )
    
    consumer = KafkaConsumer(
        'latency-test',
        bootstrap_servers=brokers,
        value_deserializer=lambda m: json.loads(m.decode('utf-8')),
        enable_auto_commit=False,
        auto_offset_reset='latest',
        fetch_min_bytes=1,
        fetch_max_wait_ms=500
    )
    
    latencies = []
    
    def produce_messages():
        for i in range(1000):
            start_time = time.time_ns()
            message = {'id': i, 'timestamp': start_time}
            producer.send('latency-test', value=message)
            producer.flush()
            time.sleep(0.001)  # 1ms between messages
    
    def consume_messages():
        for message in consumer:
            end_time = time.time_ns()
            start_time = message.value['timestamp']
            latency = (end_time - start_time) / 1_000_000  # Convert to milliseconds
            latencies.append(latency)
            if len(latencies) >= 1000:
                break
    
    # Start consumer first
    consumer_thread = threading.Thread(target=consume_messages)
    consumer_thread.start()
    
    time.sleep(2)  # Give consumer time to start
    
    # Start producer
    producer_thread = threading.Thread(target=produce_messages)
    producer_thread.start()
    
    producer_thread.join()
    consumer_thread.join()
    
    if latencies:
        print(f"Average latency: {statistics.mean(latencies):.2f}ms")
        print(f"P50 latency: {statistics.median(latencies):.2f}ms")
        print(f"P95 latency: {statistics.quantiles(latencies, n=20)[18]:.2f}ms")
        print(f"P99 latency: {statistics.quantiles(latencies, n=100)[98]:.2f}ms")
        print(f"Max latency: {max(latencies):.2f}ms")

if __name__ == "__main__":
    latency_test()
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