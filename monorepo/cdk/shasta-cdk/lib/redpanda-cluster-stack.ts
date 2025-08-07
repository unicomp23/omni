import {Duration, Stack, StackProps} from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';

export const REDPANDA_BOOTSTRAP_BROKERS = 'RedPandaBootstrapBrokers';
export const REDPANDA_CLUSTER_IPS = 'RedPandaClusterIPs';
export const LOAD_TEST_INSTANCE_IP = 'LoadTestInstanceIP';

/**
 * RedPanda Cluster Stack with m7g instances for high performance
 * 
 * Performance characteristics with m7g.xlarge:
 * - CPU: 4 vCPUs with ARM64 Graviton3 processors for optimal price/performance
 * - Memory: 16 GiB RAM optimized for memory-intensive workloads like Kafka brokers
 * - Network: Up to 15 Gbps network performance for high-throughput messaging
 * - Storage: EBS GP3 volumes with consistent performance and durability
 * - Architecture: Latest generation Graviton3 with enhanced performance per watt
 */
export class RedPandaClusterStack extends Stack {
    static readonly keyName = "john.davis";
    private readonly redpandaInstances: ec2.Instance[] = [];
    
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        // Create dedicated VPC for RedPanda cluster
        const vpc = new ec2.Vpc(this, 'RedPandaVpc', {
            vpcName: 'RedPandaVpc',
            ipAddresses: ec2.IpAddresses.cidr('10.1.0.0/16'),
            maxAzs: 3,
            subnetConfiguration: [
                {
                    subnetType: ec2.SubnetType.PUBLIC,
                    name: 'RedPandaPublic',
                    cidrMask: 24,
                },
                {
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    name: 'RedPandaPrivate',
                    cidrMask: 24,
                },
            ],
            natGateways: 1, // Single NAT Gateway for cost optimization
            enableDnsHostnames: true,
            enableDnsSupport: true,
        });

        // Add VPC endpoints for AWS services (optional but recommended for private subnet access)
        vpc.addGatewayEndpoint('S3Endpoint', {
            service: ec2.GatewayVpcEndpointAwsService.S3,
        });

        vpc.addInterfaceEndpoint('SsmEndpoint', {
            service: ec2.InterfaceVpcEndpointAwsService.SSM,
        });

        vpc.addInterfaceEndpoint('SsmMessagesEndpoint', {
            service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
        });

        vpc.addInterfaceEndpoint('Ec2MessagesEndpoint', {
            service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
        });

        // Create RedPanda-specific security group
        const redpandaSecurityGroup = new ec2.SecurityGroup(this, 'RedPandaSecurityGroup', {
            vpc,
            description: 'Security group for RedPanda cluster',
            allowAllOutbound: true,
        });

        // Add RedPanda specific ports
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(9092),
            'Kafka API'
        );
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(8081),
            'Schema Registry API'
        );
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(8082),
            'REST Proxy API'
        );
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(33145),
            'Admin API'
        );
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(9644),
            'Prometheus metrics'
        );
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(22),
            'SSH access within VPC'
        );
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(22),
            'SSH access from anywhere'
        );
        
        // Allow internal cluster communication
        redpandaSecurityGroup.addIngressRule(
            redpandaSecurityGroup,
            ec2.Port.allTraffic(),
            'Internal cluster communication'
        );

        // Add EC2 Instance Connect Endpoint support (optional but recommended)
        redpandaSecurityGroup.addIngressRule(
            ec2.Peer.prefixList('pl-02cd2c6b'),  // EC2 Instance Connect service prefix list for us-east-1
            ec2.Port.tcp(22),
            'EC2 Instance Connect service access'
        );
        
        // Alternative: More secure approach - restrict SSH from anywhere to specific IP ranges if needed
        // Comment out the "SSH access from anywhere" rule above and use this instead:
        // redpandaSecurityGroup.addIngressRule(
        //     ec2.Peer.ipv4('YOUR_IP_RANGE/32'),  // Replace with your IP
        //     ec2.Port.tcp(22),
        //     'SSH access from specific IP'
        // );

        // Create dedicated IAM role for RedPanda cluster
        const role = new iam.Role(this, 'RedPandaInstanceRole', {
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
            description: 'IAM role for RedPanda cluster instances',
        });

        // Add basic EC2 permissions
        role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));

        // Add EC2 Instance Connect permissions
        role.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'ec2-instance-connect:SendSSHPublicKey',
                'ec2:DescribeInstances',
                'ec2:DescribeInstanceAttribute',
                'ec2:DescribeInstanceTypes'
            ],
            resources: ['*']
        }));

        // Add CloudWatch logging permissions
        role.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
                'logs:DescribeLogStreams'
            ],
            resources: ['*']
        }));

        // Add S3 permissions for load test bucket
        role.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
                's3:ListBucket'
            ],
            resources: ['*'] // Will be restricted to specific bucket below
        }));

        // Create S3 bucket for load test scripts
        const loadTestBucket = new s3.Bucket(this, 'LoadTestBucket', {
            bucketName: `redpanda-load-test-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            versioned: false,
        });

        // Grant bucket access to the role
        loadTestBucket.grantReadWrite(role);

        // High-performance m7gd instances with Graviton3 processors and local NVMe SSD storage
        // m7gd.8xlarge: 32 vCPU, 128 GiB RAM, 25 Gbps network, 1.9 TB NVMe SSD storage
        const redpandaInstanceType = ec2.InstanceType.of(ec2.InstanceClass.M7GD, ec2.InstanceSize.XLARGE8);
        const redpandaMachineImage = ec2.MachineImage.latestAmazonLinux2023({
            cpuType: ec2.AmazonLinuxCpuType.ARM_64
        });
        
        // Load test instance now uses ARM64 to match m7gd.8xlarge instance type
        const loadTestMachineImage = ec2.MachineImage.latestAmazonLinux2023({
            cpuType: ec2.AmazonLinuxCpuType.ARM_64
        });

        // Get public subnets for RedPanda cluster (one per AZ) - need public IPs for direct access
        const publicSubnets = vpc.selectSubnets({subnetType: ec2.SubnetType.PUBLIC}).subnets;
        
        // Create RedPanda instances (one per AZ)
        const redpandaIPs: string[] = [];
        const redpandaPublicIPs: string[] = [];
        const redpandaAZs: string[] = [];
        const azCount = Math.min(3, publicSubnets.length);
        
        for (let i = 0; i < azCount; i++) {
            const redpandaInstance = new ec2.Instance(this, `RedPandaNode${i}`, {
                vpc,
                vpcSubnets: { subnets: [publicSubnets[i]] },
                instanceType: redpandaInstanceType,
                machineImage: redpandaMachineImage,
                securityGroup: redpandaSecurityGroup,
                keyPair: ec2.KeyPair.fromKeyPairName(this, `RedPandaKeyPair${i}`, RedPandaClusterStack.keyName),
                role,
                associatePublicIpAddress: true,
                // m7gd instances have local NVMe SSD storage plus EBS for OS
                // Performance: Graviton3 processors with optimized memory bandwidth and high-speed local storage
                blockDevices: [{
                    deviceName: '/dev/xvda', // Root volume only - keep small for OS
                    volume: ec2.BlockDeviceVolume.ebs(20, {
                        volumeType: ec2.EbsDeviceVolumeType.GP3
                    })
                }]
            });

            // Native Redpanda setup - tools will be installed by RPM packages
            const basicConfig = this.generateBasicUserData(i);
            redpandaInstance.addUserData(...basicConfig);

            // Tag the instance with rack awareness information
            cdk.Tags.of(redpandaInstance).add('shasta-role', 'redpanda-node');
            cdk.Tags.of(redpandaInstance).add('redpanda-node-id', i.toString());
            cdk.Tags.of(redpandaInstance).add('redpanda-rack-id', `rack-${i}`);
            
            this.redpandaInstances.push(redpandaInstance);
            redpandaIPs.push(redpandaInstance.instancePrivateIp);
            redpandaPublicIPs.push(redpandaInstance.instancePublicIp);
            redpandaAZs.push(publicSubnets[i].availabilityZone);
        }

        // Create load testing instance in public subnet
        // Using m7gd.8xlarge for high performance load testing with local NVMe storage
        const loadTestInstance = new ec2.Instance(this, 'LoadTestInstance', {
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.M7GD, ec2.InstanceSize.XLARGE8),
            machineImage: loadTestMachineImage,
            securityGroup: redpandaSecurityGroup,
            keyPair: ec2.KeyPair.fromKeyPairName(this, 'LoadTestKeyPair', RedPandaClusterStack.keyName),
            role,
            blockDevices: [{
                deviceName: '/dev/xvda',
                volume: ec2.BlockDeviceVolume.ebs(30, {
                    volumeType: ec2.EbsDeviceVolumeType.GP3
                })
            }]
        });

        // Native Redpanda setup for load testing - Go and monitoring tools
        const loadTestConfig = this.generateBasicLoadTestUserData();
        loadTestInstance.addUserData(...loadTestConfig);
        
        cdk.Tags.of(loadTestInstance).add('shasta-role', 'load-test');

        // Create bootstrap brokers string
        const bootstrapBrokers = redpandaIPs.map(ip => `${ip}:9092`).join(',');

        // Outputs
        new cdk.CfnOutput(this, REDPANDA_BOOTSTRAP_BROKERS, {
            value: bootstrapBrokers,
            description: 'RedPanda cluster bootstrap brokers',
            exportName: REDPANDA_BOOTSTRAP_BROKERS
        });

        new cdk.CfnOutput(this, REDPANDA_CLUSTER_IPS, {
            value: redpandaIPs.join(','),
            description: 'RedPanda cluster node private IP addresses',
            exportName: REDPANDA_CLUSTER_IPS
        });

        new cdk.CfnOutput(this, 'RedPandaClusterPublicIPs', {
            value: redpandaPublicIPs.join(','),
            description: 'RedPanda cluster node public IP addresses',
            exportName: 'RedPandaClusterPublicIPs'
        });

        new cdk.CfnOutput(this, 'RedPandaClusterAZs', {
            value: redpandaAZs.join(','),
            description: 'RedPanda cluster node availability zones for rack awareness',
            exportName: 'RedPandaClusterAZs'
        });

        new cdk.CfnOutput(this, LOAD_TEST_INSTANCE_IP, {
            value: loadTestInstance.instancePublicIp,
            description: 'Load test instance public IP',
            exportName: LOAD_TEST_INSTANCE_IP
        });

        new cdk.CfnOutput(this, 'LoadTestS3Bucket', {
            value: loadTestBucket.bucketName,
            description: 'S3 bucket for load test scripts and results',
            exportName: 'LoadTestS3Bucket'
        });

        new cdk.CfnOutput(this, 'RedPandaVpcId', {
            value: vpc.vpcId,
            description: 'RedPanda VPC ID',
            exportName: 'RedPandaVpcId'
        });
    }

    private generateBasicUserData(nodeId: number): string[] {
        return [
            '#!/bin/bash',
            'set -e',
            '',
            '# Install Redpanda natively',
            'curl -1sLf \\',
            '  "https://dl.redpanda.com/nzc4ZYQK3WRGd9sy/redpanda/cfg/setup/bash.rpm.sh" \\',
            '  | sudo -E bash',
            '',
            'sudo yum install -y redpanda',
            '',
            '# Create Redpanda data directory on local NVMe storage',
            '# m7gd instances have high-performance local NVMe SSD storage',
            'sudo mkfs.ext4 /dev/nvme1n1 || true',
            'sudo mkdir -p /var/lib/redpanda/data',
            'sudo mount /dev/nvme1n1 /var/lib/redpanda/data || true',
            'echo "/dev/nvme1n1 /var/lib/redpanda/data ext4 defaults,nofail 0 2" | sudo tee -a /etc/fstab',
            '',
            '# Create Redpanda directories and set permissions',
            'sudo mkdir -p /opt/redpanda/conf /var/lib/redpanda/data',
            'sudo chown -R redpanda:redpanda /var/lib/redpanda/data',
            'sudo chown -R redpanda:redpanda /opt/redpanda/conf',
            '',
            '# Enable but don\'t start the service yet (will be configured by setup tool)',
            'sudo systemctl enable redpanda',
            '',
            '# Install additional tools',
            'sudo yum install -y htop iotop sysstat'
        ];
    }

    private generateBasicLoadTestUserData(): string[] {
        return [
            '#!/bin/bash',
            'set -e',
            '',
            '# Format and mount local NVMe storage for load test data',
            '# m7gd instances have high-performance local NVMe SSD storage (~1.9TB)',
            'sudo mkfs.ext4 /dev/nvme1n1 || true',
            'sudo mkdir -p /mnt/nvme',
            'sudo mount /dev/nvme1n1 /mnt/nvme || true',
            'echo "/dev/nvme1n1 /mnt/nvme ext4 defaults,nofail 0 2" | sudo tee -a /etc/fstab',
            '',
            '# Set permissions for load test user',
            'sudo chmod 755 /mnt/nvme',
            'sudo chown ec2-user:ec2-user /mnt/nvme',
            '',
            '# Install Go for load testing',
            'sudo yum install -y golang git',
            '',
            '# Install additional monitoring tools',
            'sudo yum install -y htop iotop sysstat',
            '',
            '# Install Redpanda client tools (rpk)',
            'curl -1sLf \\',
            '  "https://dl.redpanda.com/nzc4ZYQK3WRGd9sy/redpanda/cfg/setup/bash.rpm.sh" \\',
            '  | sudo -E bash',
            '',
            'sudo yum install -y redpanda'
        ];
    }
} 