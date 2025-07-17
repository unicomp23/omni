import {Duration, Stack, StackProps} from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import * as layer1 from './shasta-cdk-stack';

export const REDPANDA_LOAD_TEST_INSTANCE_ID = 'RedpandaLoadTestInstance';

export class ShastaRedpandaStack extends Stack {
    static readonly keyName = "john.davis";
    
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        // Import VPC and security group from layer 1
        const vpc = ec2.Vpc.fromLookup(this, 'ImportedVPC', {
            isDefault: false,
            vpcName: layer1.SHASTA_VPC_NAME
        });

        const securityGroupIdToken = cdk.Fn.importValue(layer1.SHASTA_SECURITY_GROUP_ID);
        const securityGroupId = cdk.Token.asString(securityGroupIdToken);
        const securityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, "ImportedSecurityGroup", securityGroupId);

        // Add SSH access from anywhere for load test instance
        securityGroup.addIngressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(22),
            'Allow SSH access from anywhere for load test instance'
        );

        // Create additional security group for Redpanda specific ports
        const redpandaSecurityGroup = new ec2.SecurityGroup(this, 'RedpandaSecurityGroup', {
            vpc: vpc,
            description: 'Security group for Redpanda cluster',
            allowAllOutbound: true,
        });

        // Add Redpanda specific ingress rules
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(9092),
            'Redpanda Kafka API'
        );
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(9644),
            'Redpanda Admin API'
        );
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(33145),
            'Redpanda RPC port'
        );
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(8082),
            'Redpanda Schema Registry'
        );
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(8080),
            'Redpanda REST Proxy'
        );
        // Allow communication within the security group
        redpandaSecurityGroup.addIngressRule(
            redpandaSecurityGroup,
            ec2.Port.allTraffic(),
            'Allow inter-service communication'
        );

        // Create CloudWatch log group for Redpanda
        const logGroup = new logs.LogGroup(this, 'RedpandaLogGroup', {
            logGroupName: '/aws/ec2/redpanda',
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // Get the available AZs from the VPC
        const privateSubnets = vpc.selectSubnets({subnetType: ec2.SubnetType.PRIVATE_ISOLATED});
        const availabilityZones = privateSubnets.availabilityZones;

        // Import IAM role from layer 1
        const roleArn = cdk.Fn.importValue(layer1.SHASTA_CDK_EC2_INSTANCE_ROLE_ARN);
        const role = iam.Role.fromRoleArn(this, 'ImportedRole', roleArn);

        // Create placement group for low latency
        // Note: Cluster placement groups require all instances in same AZ, but we want brokers distributed across AZs
        // for redundancy, so we'll comment out the placement group
        // const placementGroup = new ec2.PlacementGroup(this, 'RedpandaPlacementGroup', {
        //     strategy: ec2.PlacementGroupStrategy.CLUSTER,
        // });

        // Create Redpanda EC2 instances with Docker containers across different AZs
        const brokerInstances: ec2.Instance[] = [];
        
        for (let i = 0; i < 3; i++) {
            const brokerId = i + 1;
            const brokerName = `redpanda-broker-${brokerId}`;
            
            // Create optimized EC2 instance for each broker - c5n.2xlarge for low latency
            const brokerInstanceType = ec2.InstanceType.of(ec2.InstanceClass.C5N, ec2.InstanceSize.XLARGE2);
            const machineImage = ec2.MachineImage.latestAmazonLinux2023();

            // Create Docker run command with low latency optimizations
            const dockerRunCommand = `
docker run -d \\
  --name redpanda-broker-${brokerId} \\
  --hostname redpanda-broker-${brokerId} \\
  --network host \\
  --restart unless-stopped \\
  --memory 6g \\
  --memory-reservation 4g \\
  --cpus 6 \\
  --log-driver awslogs \\
  --log-opt awslogs-group=${logGroup.logGroupName} \\
  --log-opt awslogs-stream=redpanda-broker-${brokerId} \\
  --log-opt awslogs-region=us-east-1 \\
  -e REDPANDA_BROKER_ID=${brokerId} \\
  -e REDPANDA_KAFKA_ENABLE_AUTHORIZATION=false \\
  -e REDPANDA_KAFKA_ENABLE_SASL=false \\
  -e REDPANDA_PANDAPROXY_PANDAPROXY_API_ENABLE=true \\
  -e REDPANDA_SCHEMA_REGISTRY_SCHEMA_REGISTRY_API_ENABLE=true \\
  redpandadata/redpanda:latest \\
  redpanda start \\
    --kafka-addr internal://0.0.0.0:9092,external://0.0.0.0:19092 \\
    --advertise-kafka-addr internal://redpanda-broker-${brokerId}:9092,external://localhost:19092 \\
    --pandaproxy-addr internal://0.0.0.0:8082,external://0.0.0.0:18082 \\
    --advertise-pandaproxy-addr internal://redpanda-broker-${brokerId}:8082,external://localhost:18082 \\
    --schema-registry-addr internal://0.0.0.0:8081,external://0.0.0.0:18081 \\
    --rpc-addr redpanda-broker-${brokerId}:33145 \\
    --advertise-rpc-addr redpanda-broker-${brokerId}:33145 \\
    --mode dev-container \\
    --memory 4G \\
    --reserve-memory 2G \\
    --overprovisioned \\
    --node-id ${brokerId} \\
    --check=false \\
    --set redpanda.disable_batch_cache=true \\
    --set redpanda.log_segment_size=134217728 \\
    --set redpanda.log_compaction_interval_ms=10000 \\
    --set redpanda.group_min_session_timeout_ms=100 \\
    --set redpanda.group_max_session_timeout_ms=30000 \\
    --set redpanda.fetch_reads_debounce_timeout=1 \\
    --set redpanda.metadata_dissemination_interval_ms=1000 \\
    --set redpanda.raft_heartbeat_interval_ms=100 \\
    --set redpanda.raft_heartbeat_timeout_ms=1000 \\
    --set redpanda.join_retry_timeout_ms=1000 \\
    --set redpanda.replicate_append_timeout_ms=1000 \\
    --set redpanda.write_caching_default=true \\
    --set redpanda.log_segment_ms=600000 \\
    --set redpanda.log_retention_ms=86400000 \\
    --set redpanda.compacted_log_segment_size=67108864 \\
    --set redpanda.max_compacted_log_segment_size=268435456 \\
    --set pandaproxy.pandaproxy_api_max_memory_usage=134217728 \\
    --set schema_registry.schema_registry_api_max_memory_usage=134217728
`;

            // Create user data script with system and Docker optimizations
            const brokerUserData = [
                `#!/bin/bash`,
                `yum update -y`,
                `yum install -y docker awscli`,
                `systemctl enable docker`,
                `systemctl start docker`,
                `usermod -a -G docker ec2-user`,
                `# Network optimizations for low latency`,
                `echo 'net.core.rmem_max = 134217728' >> /etc/sysctl.conf`,
                `echo 'net.core.wmem_max = 134217728' >> /etc/sysctl.conf`,
                `echo 'net.ipv4.tcp_rmem = 4096 87380 134217728' >> /etc/sysctl.conf`,
                `echo 'net.ipv4.tcp_wmem = 4096 65536 134217728' >> /etc/sysctl.conf`,
                `echo 'net.ipv4.tcp_congestion_control = bbr' >> /etc/sysctl.conf`,
                `echo 'net.core.netdev_max_backlog = 5000' >> /etc/sysctl.conf`,
                `echo 'net.ipv4.tcp_no_delay = 1' >> /etc/sysctl.conf`,
                `sysctl -p`,
                `# Configure Docker daemon for performance`,
                `mkdir -p /etc/docker`,
                `cat > /etc/docker/daemon.json << 'EOF'
{
  "storage-driver": "overlay2",
  "log-driver": "awslogs",
  "log-opts": {
    "awslogs-region": "us-east-1"
  },
  "live-restore": true,
  "max-concurrent-downloads": 10,
  "max-concurrent-uploads": 10
}
EOF`,
                `systemctl restart docker`,
                `# Set hostname for broker discovery`,
                `hostnamectl set-hostname redpanda-broker-${brokerId}`,
                `echo "127.0.0.1 redpanda-broker-${brokerId}" >> /etc/hosts`,
                `# Wait for Docker to be ready`,
                `while ! docker info > /dev/null 2>&1; do sleep 1; done`,
                `# Run Redpanda container`,
                dockerRunCommand,
                `# Set up health check`,
                `cat > /usr/local/bin/redpanda-health-check.sh << 'EOF'
#!/bin/bash
docker exec redpanda-broker-${brokerId} rpk cluster health --brokers localhost:9092 2>/dev/null | grep -q "Healthy" && echo "Healthy" || echo "Unhealthy"
EOF`,
                `chmod +x /usr/local/bin/redpanda-health-check.sh`,
            ];

            // Create EC2 instance for broker
            const brokerInstance = new ec2.Instance(this, `RedpandaBroker${brokerId}`, {
                vpc: vpc,
                vpcSubnets: {
                    availabilityZones: [availabilityZones[i % availabilityZones.length]],
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                },
                instanceType: brokerInstanceType,
                machineImage: machineImage,
                securityGroup: redpandaSecurityGroup,
                keyPair: ec2.KeyPair.fromKeyPairName(this, `RedpandaBrokerKeyPair${brokerId}`, ShastaRedpandaStack.keyName),
                role: role,
                // Remove placement group - not needed for distributed brokers across AZs
                blockDevices: [{
                    deviceName: '/dev/xvda',
                    volume: ec2.BlockDeviceVolume.ebs(50, {
                        volumeType: ec2.EbsDeviceVolumeType.GP3,
                        iops: 3000,
                    })
                }]
            });

            // Add user data to instance
            brokerUserData.forEach(command => {
                brokerInstance.addUserData(command);
            });

            // Add tags
            cdk.Tags.of(brokerInstance).add('Name', brokerName);
            cdk.Tags.of(brokerInstance).add('Purpose', 'RedpandaBroker');
            cdk.Tags.of(brokerInstance).add('BrokerId', brokerId.toString());

            brokerInstances.push(brokerInstance);
        }

        // Create load testing instance (c5n.4xlarge for enhanced networking and low latency)
        const loadTestInstanceType = ec2.InstanceType.of(ec2.InstanceClass.C5N, ec2.InstanceSize.XLARGE4);
        const machineImage = ec2.MachineImage.latestAmazonLinux2023();

        const loadTestUserData = [
            `yum update -y`,
            `yum install -y docker git awscli`,
            `systemctl enable docker`,
            `systemctl start docker`,
            `usermod -a -G docker ec2-user`,
            `yum install -y amazon-ssm-agent`,
            `systemctl start amazon-ssm-agent`,
            `systemctl enable amazon-ssm-agent`,
            `yum install -y java-11-amazon-corretto`,
            `# Network optimizations for low latency`,
            `echo 'net.core.rmem_max = 134217728' >> /etc/sysctl.conf`,
            `echo 'net.core.wmem_max = 134217728' >> /etc/sysctl.conf`,
            `echo 'net.ipv4.tcp_rmem = 4096 87380 134217728' >> /etc/sysctl.conf`,
            `echo 'net.ipv4.tcp_wmem = 4096 65536 134217728' >> /etc/sysctl.conf`,
            `echo 'net.ipv4.tcp_congestion_control = bbr' >> /etc/sysctl.conf`,
            `echo 'net.core.netdev_max_backlog = 5000' >> /etc/sysctl.conf`,
            `echo 'net.ipv4.tcp_no_delay = 1' >> /etc/sysctl.conf`,
            `sysctl -p`,
            `# Install Kafka client tools`,
            `cd /opt`,
            `wget https://archive.apache.org/dist/kafka/2.13-3.5.0/kafka_2.13-3.5.0.tgz`,
            `tar -xzf kafka_2.13-3.5.0.tgz`,
            `ln -s kafka_2.13-3.5.0 kafka`,
            `echo 'export PATH=$PATH:/opt/kafka/bin' >> /etc/profile`,
            `# Install kcat (formerly kafkacat)`,
            `yum install -y epel-release`,
            `yum install -y kcat`,
            `# Install performance testing tools`,
            `yum install -y htop iotop sysstat tcpdump`,
            `# Set up environment variables for Redpanda access - optimized for low latency`,
            `su - ec2-user -c "echo 'export REDPANDA_BROKERS=redpanda-broker-1:9092,redpanda-broker-2:9092,redpanda-broker-3:9092' >> ~/.bashrc"`,
            `su - ec2-user -c "echo 'export KAFKA_HEAP_OPTS=\\"-Xmx4G -Xms4G -XX:+UseG1GC -XX:MaxGCPauseMillis=20 -XX:+UseStringDeduplication\\"' >> ~/.bashrc"`,
            `su - ec2-user -c "echo 'export JVM_PERFORMANCE_OPTS=\\"-server -XX:+UseG1GC -XX:MaxGCPauseMillis=20 -XX:+UnlockExperimentalVMOptions -XX:+UseCGroupMemoryLimitForHeap -Djava.awt.headless=true\\"' >> ~/.bashrc"`,
            `# Create test data directory`,
            `su - ec2-user -c "mkdir -p ~/redpanda-testing"`,
            `su - ec2-user -c "chmod 755 ~/redpanda-testing"`,
            `# Create low latency test scripts`,
            `su - ec2-user -c "cat > ~/redpanda-testing/low-latency-test.sh << 'EOF'
#!/bin/bash
# Low latency producer test
export KAFKA_HEAP_OPTS='-Xmx4G -Xms4G -XX:+UseG1GC -XX:MaxGCPauseMillis=20'
/opt/kafka/bin/kafka-producer-perf-test.sh \\
  --topic test-latency \\
  --num-records 1000000 \\
  --record-size 1024 \\
  --throughput 50000 \\
  --producer-props bootstrap.servers=\\$REDPANDA_BROKERS \\
                    acks=1 \\
                    linger.ms=1 \\
                    batch.size=16384 \\
                    buffer.memory=33554432 \\
                    compression.type=lz4 \\
                    retries=0
EOF"`,
            `su - ec2-user -c "chmod +x ~/redpanda-testing/low-latency-test.sh"`,
        ];

        const loadTestInstance = new ec2.Instance(this, 'RedpandaLoadTestInstance', {
            vpc: vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            instanceType: loadTestInstanceType,
            machineImage: machineImage,
            securityGroup: securityGroup,
            keyPair: ec2.KeyPair.fromKeyPairName(this, 'RedpandaKeyPair', ShastaRedpandaStack.keyName),
            role: role,
            // Remove placement group from load test instance - it's in public subnet and doesn't need cluster placement
            blockDevices: [{
                deviceName: '/dev/xvda',
                volume: ec2.BlockDeviceVolume.ebs(100, {
                    volumeType: ec2.EbsDeviceVolumeType.GP3,
                    iops: 3000,
                    // throughput: 125,  // Removed to fix throughput warning
                }) // 100GB GP3 for better performance
            }]
        });

        // Add all user data commands
        loadTestUserData.forEach(command => {
            loadTestInstance.addUserData(command);
        });

        // Add tags
        cdk.Tags.of(loadTestInstance).add('Name', 'RedpandaLoadTestInstance');
        cdk.Tags.of(loadTestInstance).add('Purpose', 'LoadTesting');
        cdk.Tags.of(loadTestInstance).add('Environment', 'Development');

        // Create outputs
        new cdk.CfnOutput(this, 'RedpandaBrokerInstanceIds', {
            value: brokerInstances.map(instance => instance.instanceId).join(','),
            description: 'Instance IDs of the Redpanda broker instances',
            exportName: 'RedpandaBrokerInstanceIds'
        });

        new cdk.CfnOutput(this, 'RedpandaLoadTestInstanceId', {
            value: loadTestInstance.instanceId,
            description: 'Instance ID of the load testing instance',
            exportName: 'RedpandaLoadTestInstanceId'
        });

        new cdk.CfnOutput(this, 'RedpandaLoadTestInstanceIP', {
            value: loadTestInstance.instancePublicIp,
            description: 'Public IP of the load testing instance',
            exportName: 'RedpandaLoadTestInstanceIP'
        });

        new cdk.CfnOutput(this, 'RedpandaBrokerEndpoints', {
            value: 'redpanda-broker-1:9092,redpanda-broker-2:9092,redpanda-broker-3:9092',
            description: 'Redpanda broker endpoints for client connections',
            exportName: 'RedpandaBrokerEndpoints'
        });
    }
} 