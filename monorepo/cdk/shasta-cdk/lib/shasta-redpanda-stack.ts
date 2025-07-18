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

        // Add SSH access for Redpanda broker instances
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(22),
            'Allow SSH access from anywhere'
        );
        
        // EC2 Instance Connect service IP ranges for us-east-1
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.ipv4('18.206.107.24/29'),
            ec2.Port.tcp(22),
            'Allow SSH access from EC2 Instance Connect service'
        );
        
        // Allow SSH from within VPC (for jump host access)
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(22),
            'Allow SSH access from within VPC'
        );

        // Add Redpanda specific ingress rules
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(9092),
            'Redpanda Kafka API from VPC'
        );
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(9644),
            'Redpanda Admin API from VPC'
        );
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(33145),
            'Redpanda RPC port from VPC'
        );
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(8082),
            'Redpanda Schema Registry from VPC'
        );
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(8080),
            'Redpanda REST Proxy from VPC'
        );
        
        // Allow access from load test instance security group
        redpandaSecurityGroup.addIngressRule(
            securityGroup,
            ec2.Port.tcp(9092),
            'Redpanda Kafka API from load test instance'
        );
        redpandaSecurityGroup.addIngressRule(
            securityGroup,
            ec2.Port.tcp(9644),
            'Redpanda Admin API from load test instance'
        );
        redpandaSecurityGroup.addIngressRule(
            securityGroup,
            ec2.Port.tcp(8082),
            'Redpanda Schema Registry from load test instance'
        );
        redpandaSecurityGroup.addIngressRule(
            securityGroup,
            ec2.Port.tcp(8080),
            'Redpanda REST Proxy from load test instance'
        );
        
        // Add external ports for direct access
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(19092),
            'Redpanda external Kafka API'
        );
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(18082),
            'Redpanda external Pandaproxy API'
        );
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(18081),
            'Redpanda external Schema Registry API'
        );
        
        // Allow communication within the security group
        redpandaSecurityGroup.addIngressRule(
            redpandaSecurityGroup,
            ec2.Port.allTraffic(),
            'Allow inter-service communication'
        );

        // Add rules for VPC endpoint access (required for SSM)
        redpandaSecurityGroup.addEgressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(443),
            'Allow HTTPS access to VPC endpoints for SSM'
        );

        // Allow DNS resolution for VPC endpoints
        redpandaSecurityGroup.addEgressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(53),
            'Allow DNS resolution for VPC endpoints'
        );

        redpandaSecurityGroup.addEgressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.udp(53),
            'Allow DNS resolution for VPC endpoints'
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

        // Add SSM permissions to the role for Session Manager access
        const ssmPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'ssm:UpdateInstanceInformation',
                'ssm:SendCommand',
                'ssm:ListCommandInvocations',
                'ssm:DescribeInstanceInformation',
                'ssm:GetDeployablePatchSnapshotForInstance',
                'ssm:GetDefaultPatchBaseline',
                'ssm:GetManifest',
                'ssm:GetParameters',
                'ssm:ListAssociations',
                'ssm:ListInstanceAssociations',
                'ssm:PutInventory',
                'ssm:PutComplianceItems',
                'ssm:PutConfigurePackageResult',
                'ssm:UpdateAssociationStatus',
                'ssm:UpdateInstanceAssociationStatus',
                'ssm:UpdateInstanceInformation',
                'ssm:StartSession',
                'ssm:TerminateSession',
                'ssm:ResumeSession',
                'ssm:DescribeSessions',
                'ssm:GetConnectionStatus',
                'ssm:DescribeInstanceProperties',
                'ssmmessages:CreateControlChannel',
                'ssmmessages:CreateDataChannel',
                'ssmmessages:OpenControlChannel',
                'ssmmessages:OpenDataChannel',
                'ec2messages:AcknowledgeMessage',
                'ec2messages:DeleteMessage',
                'ec2messages:FailMessage',
                'ec2messages:GetEndpoint',
                'ec2messages:GetMessages',
                'ec2messages:SendReply',
                'ec2:DescribeInstanceStatus',
                'ec2:DescribeInstances',
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
                'logs:DescribeLogGroups',
                'logs:DescribeLogStreams'
            ],
            resources: ['*']
        });

        // Add additional EC2 permissions to help with rate limiting issues
        const ec2Policy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'ec2:DescribeInstanceInformation',
                'ec2:DescribeInstanceAttribute',
                'ec2:DescribeInstanceTypes',
                'ec2:DescribeRegions',
                'ec2:DescribeAvailabilityZones'
            ],
            resources: ['*']
        });

        // Add the policies to the role
        (role as iam.Role).addToPolicy(ssmPolicy);
        (role as iam.Role).addToPolicy(ec2Policy);

        // Create Redpanda EC2 instances with native installation across different AZs
        const brokerInstances: ec2.Instance[] = [];
        
        for (let i = 0; i < 3; i++) {
            const brokerId = i + 1;
            const brokerName = `redpanda-broker-${brokerId}`;
            
            // Create optimized EC2 instance for each broker - c5n.2xlarge for low latency
            const brokerInstanceType = ec2.InstanceType.of(ec2.InstanceClass.C5N, ec2.InstanceSize.XLARGE2);
            const machineImage = ec2.MachineImage.latestAmazonLinux2023();
            
            // Add staggered delay to prevent simultaneous API calls
            const staggerDelay = i * 30; // 30 seconds between each broker startup

            // Create user data script with native Redpanda installation
            const brokerUserData = [
                `#!/bin/bash`,
                `exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1`,
                `echo "=== User Data Script Started ==="`,
                `# Stagger startup to prevent API rate limiting`,
                `echo "Waiting ${staggerDelay} seconds for staggered startup..."`,
                `sleep ${staggerDelay}`,
                `yum update -y`,
                `yum install -y awscli`,
                `echo "=== Installing Redpanda native package ==="`,
                `# Install Redpanda using the official repository for Amazon Linux`,
                `curl -1sLf 'https://dl.redpanda.com/nzc4ZYQK3WRGd9sy/redpanda/cfg/setup/bash.rpm.sh' | bash`,
                `yum install -y redpanda`,
                `echo "=== Installing and configuring SSM agent ==="`,
                `# Install and configure SSM agent for Session Manager access`,
                `yum install -y amazon-ssm-agent`,
                `systemctl start amazon-ssm-agent`,
                `systemctl enable amazon-ssm-agent`,
                `echo "SSM agent installation completed"`,
                `systemctl status amazon-ssm-agent`,
                `echo "=== Configuring SSM agent for VPC endpoints ==="`,
                `# Configure SSM agent to use VPC endpoints if available`,
                `mkdir -p /etc/amazon/ssm`,
                `cat > /etc/amazon/ssm/amazon-ssm-agent.json << 'EOF'
{
  "Profile": {
    "ShareCreds": true,
    "ShareProfile": "",
    "ForceUpdateCreds": false,
    "KeyAutoRotateDays": 0
  },
  "Mds": {
    "CommandWorkers": 5,
    "StopTimeoutMillis": 20000,
    "Endpoint": "",
    "CommandRetryLimit": 15
  },
  "Ssm": {
    "Endpoint": "",
    "HealthFrequencyMinutes": 5,
    "CustomInventoryDefaultLocation": "",
    "AssociationLogsRetentionDurationHours": 24,
    "RunCommandLogsRetentionDurationHours": 336,
    "SessionLogsRetentionDurationHours": 336
  },
  "Mgs": {
    "Endpoint": "",
    "Region": "us-east-1"
  },
  "Agent": {
    "Region": "us-east-1",
    "OrchestrationRootDir": "/var/lib/amazon/ssm/orchestration",
    "SelfUpdate": false
  },
  "Os": {
    "Lang": "en_US.UTF-8"
  },
  "S3": {
    "Endpoint": "",
    "Region": "us-east-1",
    "LoggingEnabled": false
  }
}
EOF`,
                `systemctl restart amazon-ssm-agent`,
                `echo "=== Waiting for SSM agent to register ==="`,
                `# Wait for SSM agent to register with exponential backoff (up to 10 minutes)`,
                `retry_count=0`,
                `max_retries=10`,
                `base_delay=10`,
                `while [ \\$retry_count -lt \\$max_retries ]; do`,
                `  # Calculate exponential backoff using a more compatible method`,
                `  delay=\\$base_delay`,
                `  for i in \\$(seq 1 \\$retry_count); do`,
                `    delay=\\$((delay * 2))`,
                `  done`,
                `  jitter=\\$((RANDOM % 5))`,
                `  total_delay=\\$((delay + jitter))`,
                `  `,
                `  echo "Attempt \\$((retry_count + 1))/\\$max_retries: Checking SSM agent registration..."`,
                `  `,
                `  # Add retry logic with exponential backoff for API calls`,
                `  if timeout 30 aws ssm describe-instance-information --region us-east-1 --query "InstanceInformationList[?InstanceId=='\\$(curl -s http://169.254.169.254/latest/meta-data/instance-id)']" --output text 2>/dev/null | grep -q "Online"; then`,
                `    echo "SSM agent registered successfully on attempt \\$((retry_count + 1))"`,
                `    break`,
                `  fi`,
                `  `,
                `  if [ \\$retry_count -lt \\$((max_retries - 1)) ]; then`,
                `    echo "SSM agent not ready yet. Waiting \\$total_delay seconds before retry..."`,
                `    sleep \\$total_delay`,
                `  else`,
                `    echo "SSM agent registration failed after \\$max_retries attempts. Continuing with instance setup..."`,
                `  fi`,
                `  `,
                `  retry_count=\\$((retry_count + 1))`,
                `done`,
                `echo "=== SSM agent registration status ==="`,
                `aws ssm describe-instance-information --region us-east-1 --query "InstanceInformationList[?InstanceId=='$(curl -s http://169.254.169.254/latest/meta-data/instance-id)']" --output table || echo "Failed to get SSM status"`,
                `echo "=== Installing and configuring EC2 Instance Connect ==="`,
                `# Install and configure EC2 Instance Connect (should be pre-installed on AL2023)`,
                `yum install -y ec2-instance-connect`,
                `systemctl enable ec2-instance-connect`,
                `systemctl start ec2-instance-connect`,
                `# Ensure the instance metadata service is accessible`,
                `echo 'ec2-instance-connect service status:' >> /var/log/user-data.log`,
                `systemctl status ec2-instance-connect >> /var/log/user-data.log`,
                `echo "=== Network optimizations ==="`,
                `# Network optimizations for low latency`,
                `echo 'net.core.rmem_max = 134217728' >> /etc/sysctl.conf`,
                `echo 'net.core.wmem_max = 134217728' >> /etc/sysctl.conf`,
                `echo 'net.ipv4.tcp_rmem = 4096 87380 134217728' >> /etc/sysctl.conf`,
                `echo 'net.ipv4.tcp_wmem = 4096 65536 134217728' >> /etc/sysctl.conf`,
                `echo 'net.ipv4.tcp_congestion_control = bbr' >> /etc/sysctl.conf`,
                `echo 'net.core.netdev_max_backlog = 5000' >> /etc/sysctl.conf`,
                `echo 'net.ipv4.tcp_no_delay = 1' >> /etc/sysctl.conf`,
                `sysctl -p`,
                `# Set hostname for broker discovery`,
                `hostnamectl set-hostname redpanda-broker-${brokerId}`,
                `echo "127.0.0.1 redpanda-broker-${brokerId}" >> /etc/hosts`,
                `# Add all broker hostnames to /etc/hosts for inter-broker communication`,
                `echo "# Redpanda broker hostnames" >> /etc/hosts`,
                `# Create script to discover and update broker hostnames`,
                `cat > /usr/local/bin/update-broker-hosts.sh << 'EOF'
#!/bin/bash
# Wait for AWS CLI to be available and configured
sleep 30
# Get all broker instances and their private IPs
aws ec2 describe-instances --region us-east-1 \\
  --filters "Name=tag:Purpose,Values=RedpandaBroker" "Name=instance-state-name,Values=running" \\
  --query "Reservations[].Instances[].[Tags[?Key=='BrokerId'].Value|[0],PrivateIpAddress]" \\
  --output text | while read broker_id private_ip; do
    if [ -n "$broker_id" ] && [ -n "$private_ip" ]; then
      # Remove existing entry if it exists
      sed -i "/redpanda-broker-$broker_id/d" /etc/hosts
      # Add new entry
      echo "$private_ip redpanda-broker-$broker_id" >> /etc/hosts
    fi
done
EOF`,
                `chmod +x /usr/local/bin/update-broker-hosts.sh`,
                `# Run the script to update hosts file`,
                `/usr/local/bin/update-broker-hosts.sh`,
                `echo "=== Configuring Redpanda ==="`,
                `# Get the private IP of this instance`,
                `PRIVATE_IP=$(curl -s http://169.254.169.254/latest/meta-data/local-ipv4)`,
                `PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)`,
                `# Configure Redpanda using rpk (works with RPM package)`,
                `echo "=== Configuring Redpanda using rpk ==="`,
                `echo "Private IP: \\$PRIVATE_IP"`,
                `echo "Public IP: \\$PUBLIC_IP"`,
                `echo "Broker ID: ${brokerId}"`,
                `# Initialize Redpanda configuration`,
                `rpk redpanda config bootstrap --id ${brokerId} --self \\$PRIVATE_IP:33145`,
                `# Set basic configuration`,
                `rpk redpanda config set redpanda.data_directory /var/lib/redpanda/data`,
                `rpk redpanda config set redpanda.node_id ${brokerId}`,
                `rpk redpanda config set redpanda.rpc_server.address \\$PRIVATE_IP`,
                `rpk redpanda config set redpanda.rpc_server.port 33145`,
                `# Configure Kafka API listeners`,
                `rpk redpanda config set redpanda.kafka_api '[{"address":"0.0.0.0","port":9092,"name":"internal"},{"address":"0.0.0.0","port":19092,"name":"external"}]'`,
                `rpk redpanda config set redpanda.admin '[{"address":"0.0.0.0","port":9644,"name":"admin"}]'`,
                `# Configure advertised addresses`,
                `rpk redpanda config set redpanda.advertised_rpc_api.address \\$PRIVATE_IP`,
                `rpk redpanda config set redpanda.advertised_rpc_api.port 33145`,
                `rpk redpanda config set redpanda.advertised_kafka_api '[{"address":"'\\$PRIVATE_IP'","port":9092,"name":"internal"},{"address":"'\\$PUBLIC_IP'","port":19092,"name":"external"}]'`,
                `# Configure seed servers`,
                `if [ ${brokerId} -eq 1 ]; then`,
                `  rpk redpanda config set redpanda.seed_servers '[]'`,
                `  rpk redpanda config set redpanda.empty_seed_starts_cluster true`,
                `else`,
                `  rpk redpanda config set redpanda.seed_servers '[{"host":"redpanda-broker-1","port":33145}]'`,
                `  rpk redpanda config set redpanda.empty_seed_starts_cluster false`,
                `fi`,
                `# Performance optimizations for low latency`,
                `rpk redpanda config set redpanda.disable_batch_cache true`,
                `rpk redpanda config set redpanda.log_segment_size 134217728`,
                `rpk redpanda config set redpanda.log_compaction_interval_ms 10000`,
                `rpk redpanda config set redpanda.group_min_session_timeout_ms 100`,
                `rpk redpanda config set redpanda.group_max_session_timeout_ms 30000`,
                `rpk redpanda config set redpanda.fetch_reads_debounce_timeout 1`,
                `rpk redpanda config set redpanda.metadata_dissemination_interval_ms 1000`,
                `rpk redpanda config set redpanda.raft_heartbeat_interval_ms 100`,
                `rpk redpanda config set redpanda.raft_heartbeat_timeout_ms 1000`,
                `rpk redpanda config set redpanda.join_retry_timeout_ms 1000`,
                `rpk redpanda config set redpanda.replicate_append_timeout_ms 1000`,
                `rpk redpanda config set redpanda.write_caching_default true`,
                `rpk redpanda config set redpanda.log_segment_ms 600000`,
                `rpk redpanda config set redpanda.log_retention_ms 86400000`,
                `rpk redpanda config set redpanda.compacted_log_segment_size 67108864`,
                `rpk redpanda config set redpanda.max_compacted_log_segment_size 268435456`,
                `# Memory settings`,
                `rpk redpanda config set redpanda.memory_abort_on_alloc_failure false`,
                `rpk redpanda config set redpanda.overprovisioned true`,
                `# Configure Pandaproxy`,
                `rpk redpanda config set pandaproxy.pandaproxy_api '[{"address":"0.0.0.0","port":8082,"name":"internal"},{"address":"0.0.0.0","port":18082,"name":"external"}]'`,
                `rpk redpanda config set pandaproxy.advertised_pandaproxy_api '[{"address":"'\\$PRIVATE_IP'","port":8082,"name":"internal"},{"address":"'\\$PUBLIC_IP'","port":18082,"name":"external"}]'`,
                `rpk redpanda config set pandaproxy.pandaproxy_api_max_memory_usage 134217728`,
                `# Configure Schema Registry`,
                `rpk redpanda config set schema_registry.schema_registry_api '[{"address":"0.0.0.0","port":8081,"name":"internal"},{"address":"0.0.0.0","port":18081,"name":"external"}]'`,
                `rpk redpanda config set schema_registry.schema_registry_api_max_memory_usage 134217728`,
                `# Ensure redpanda user and directories exist (should be created by RPM)`,
                `id redpanda || useradd --system --shell /bin/false redpanda`,
                `mkdir -p /var/lib/redpanda/data`,
                `mkdir -p /var/log/redpanda`,
                `chown -R redpanda:redpanda /var/lib/redpanda`,
                `chown -R redpanda:redpanda /var/log/redpanda`,
                `chown -R redpanda:redpanda /etc/redpanda`,
                `# Configure CloudWatch logging`,
                `yum install -y amazon-cloudwatch-agent`,
                `cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << 'EOF'
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/redpanda/redpanda.log",
            "log_group_name": "${logGroup.logGroupName}",
            "log_stream_name": "redpanda-broker-${brokerId}",
            "timezone": "UTC"
          }
        ]
      }
    }
  }
}
EOF`,
                `systemctl enable amazon-cloudwatch-agent`,
                `systemctl start amazon-cloudwatch-agent`,
                `# Wait for other brokers to be ready before starting (except for broker 1)`,
                `if [ ${brokerId} -ne 1 ]; then`,
                `  echo "Waiting for broker 1 to be ready..."`,
                `  retry_count=0`,
                `  max_retries=30`,
                `  while [ \\$retry_count -lt \\$max_retries ]; do`,
                `    if nc -z redpanda-broker-1 33145; then`,
                `      echo "Broker 1 is ready"`,
                `      break`,
                `    fi`,
                `    echo "Waiting for broker 1... (\\$((retry_count + 1))/\\$max_retries)"`,
                `    sleep 10`,
                `    retry_count=\\$((retry_count + 1))`,
                `  done`,
                `fi`,
                `# Enable and start Redpanda service (using RPM package service)`,
                `systemctl daemon-reload`,
                `systemctl enable redpanda`,
                `echo "=== Starting Redpanda service ==="`,
                `systemctl start redpanda`,
                `# Check if service started successfully`,
                `sleep 10`,
                `if systemctl is-active --quiet redpanda; then`,
                `  echo "Redpanda service started successfully"`,
                `else`,
                `  echo "Redpanda service failed to start, checking logs..."`,
                `  systemctl status redpanda`,
                `  journalctl -u redpanda --lines=20 --no-pager`,
                `fi`,
                `# Wait for Redpanda to be ready`,
                `echo "Waiting for Redpanda to start..."`,
                `sleep 30`,
                `# Verify Redpanda is running`,
                `systemctl status redpanda`,
                `# Set up health check script`,
                `cat > /usr/local/bin/redpanda-health-check.sh << 'EOF'
#!/bin/bash
rpk cluster health --brokers localhost:9092 2>/dev/null | grep -q "Healthy" && echo "Healthy" || echo "Unhealthy"
EOF`,
                `chmod +x /usr/local/bin/redpanda-health-check.sh`,
                `echo "=== Redpanda installation completed ==="`,
                `echo "Redpanda broker ${brokerId} setup completed" >> /var/log/user-data.log`,
            ];

            // Create EC2 instance for broker
            const brokerInstance = new ec2.Instance(this, `RedpandaBroker${brokerId}`, {
                vpc: vpc,
                vpcSubnets: {
                    availabilityZones: [availabilityZones[i % availabilityZones.length]],
                    subnetType: ec2.SubnetType.PUBLIC,
                },
                instanceType: brokerInstanceType,
                machineImage: machineImage,
                securityGroup: redpandaSecurityGroup,
                keyPair: ec2.KeyPair.fromKeyPairName(this, `RedpandaBrokerKeyPair${brokerId}`, ShastaRedpandaStack.keyName),
                role: role,
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
            `yum install -y git awscli`,
            `yum install -y amazon-ssm-agent`,
            `systemctl start amazon-ssm-agent`,
            `systemctl enable amazon-ssm-agent`,
            `yum install -y java-11-amazon-corretto`,
            `# Install Redpanda CLI tools`,
            `curl -1sLf 'https://dl.redpanda.com/nzc4ZYQK3WRGd9sy/redpanda/cfg/setup/bash.rpm.sh' | bash`,
            `yum install -y redpanda`,
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
            `# Set up environment variables for Redpanda access - use private IPs`,
            `cat > /tmp/setup-redpanda-env.sh << 'EOF'
#!/bin/bash
# Wait for all brokers to be running
sleep 60
# Get broker private IPs and create broker endpoints
BROKER_IPS=$(aws ec2 describe-instances --region us-east-1 \\
  --filters "Name=tag:Purpose,Values=RedpandaBroker" "Name=instance-state-name,Values=running" \\
  --query "Reservations[].Instances[].PrivateIpAddress" --output text | tr '\\n' ' ')

if [ -n "$BROKER_IPS" ]; then
  # Create broker endpoints string
  BROKER_ENDPOINTS=""
  for ip in $BROKER_IPS; do
    if [ -n "$BROKER_ENDPOINTS" ]; then
      BROKER_ENDPOINTS="$BROKER_ENDPOINTS,$ip:9092"
    else
      BROKER_ENDPOINTS="$ip:9092"
    fi
  done
  
  # Update ec2-user's bashrc with broker endpoints
  echo "export REDPANDA_BROKERS='$BROKER_ENDPOINTS'" >> /home/ec2-user/.bashrc
  chown ec2-user:ec2-user /home/ec2-user/.bashrc
  
  # Also create a fallback with hostnames for compatibility
  echo "export REDPANDA_BROKERS_HOSTNAMES='redpanda-broker-1:9092,redpanda-broker-2:9092,redpanda-broker-3:9092'" >> /home/ec2-user/.bashrc
else
  # Fallback to hostnames if IPs not available
  echo "export REDPANDA_BROKERS='redpanda-broker-1:9092,redpanda-broker-2:9092,redpanda-broker-3:9092'" >> /home/ec2-user/.bashrc
fi
EOF`,
            `chmod +x /tmp/setup-redpanda-env.sh`,
            `# Run the setup script in background`,
            `nohup /tmp/setup-redpanda-env.sh > /var/log/redpanda-env-setup.log 2>&1 &`,
            `su - ec2-user -c "echo 'export KAFKA_HEAP_OPTS=\\"-Xmx4G -Xms4G -XX:+UseG1GC -XX:MaxGCPauseMillis=20 -XX:+UseStringDeduplication\\"' >> ~/.bashrc"`,
            `su - ec2-user -c "echo 'export JVM_PERFORMANCE_OPTS=\\"-server -XX:+UseG1GC -XX:MaxGCPauseMillis=20 -XX:+UnlockExperimentalVMOptions -XX:+UseCGroupMemoryLimitForHeap -Djava.awt.headless=true\\"' >> ~/.bashrc"`,
            `# Create test data directory`,
            `su - ec2-user -c "mkdir -p ~/redpanda-testing"`,
            `su - ec2-user -c "chmod 755 ~/redpanda-testing"`,
            `# Create low latency test scripts using native rpk`,
            `su - ec2-user -c "cat > ~/redpanda-testing/low-latency-test.sh << 'EOF'
#!/bin/bash
# Low latency producer test using rpk
rpk topic create test-latency --partitions 36 --replicas 3 --brokers \\$REDPANDA_BROKERS
rpk topic produce test-latency --brokers \\$REDPANDA_BROKERS --compression lz4 --batch-size 16384
EOF"`,
            `su - ec2-user -c "chmod +x ~/redpanda-testing/low-latency-test.sh"`,
            `# Create benchmark script using rpk`,
            `su - ec2-user -c "cat > ~/redpanda-testing/benchmark.sh << 'EOF'
#!/bin/bash
# Benchmark test using rpk
echo "Creating benchmark topic..."
rpk topic create benchmark --partitions 36 --replicas 3 --brokers \\$REDPANDA_BROKERS

echo "Running producer benchmark..."
rpk topic produce benchmark --brokers \\$REDPANDA_BROKERS --compression lz4 --batch-size 16384 --rate 50000 --record-size 1024

echo "Running consumer benchmark..."
rpk topic consume benchmark --brokers \\$REDPANDA_BROKERS --offset start --num 1000000
EOF"`,
            `su - ec2-user -c "chmod +x ~/redpanda-testing/benchmark.sh"`,
        ];

        const loadTestInstance = new ec2.Instance(this, 'RedpandaLoadTestInstance', {
            vpc: vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            instanceType: loadTestInstanceType,
            machineImage: machineImage,
            securityGroup: securityGroup,
            keyPair: ec2.KeyPair.fromKeyPairName(this, 'RedpandaKeyPair', ShastaRedpandaStack.keyName),
            role: role,
            blockDevices: [{
                deviceName: '/dev/xvda',
                volume: ec2.BlockDeviceVolume.ebs(100, {
                    volumeType: ec2.EbsDeviceVolumeType.GP3,
                    iops: 3000,
                })
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

        new cdk.CfnOutput(this, 'RedpandaBrokerPrivateIPs', {
            value: brokerInstances.map(instance => instance.instancePrivateIp).join(','),
            description: 'Private IP addresses of the Redpanda broker instances',
            exportName: 'RedpandaBrokerPrivateIPs'
        });

        new cdk.CfnOutput(this, 'RedpandaBrokerPublicIPs', {
            value: brokerInstances.map(instance => instance.instancePublicIp).join(','),
            description: 'Public IP addresses of the Redpanda broker instances',
            exportName: 'RedpandaBrokerPublicIPs'
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
            value: brokerInstances.map(instance => `${instance.instancePrivateIp}:9092`).join(','),
            description: 'Redpanda broker endpoints for client connections (private IPs)',
            exportName: 'RedpandaBrokerEndpoints'
        });
        
        new cdk.CfnOutput(this, 'RedpandaBrokerExternalEndpoints', {
            value: brokerInstances.map(instance => `${instance.instancePublicIp}:19092`).join(','),
            description: 'Redpanda broker external endpoints for client connections (public IPs)',
            exportName: 'RedpandaBrokerExternalEndpoints'
        });
    }
} 