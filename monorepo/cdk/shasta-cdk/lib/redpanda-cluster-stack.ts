import {Duration, Stack, StackProps} from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import * as layer1 from './shasta-cdk-stack';

export const REDPANDA_BOOTSTRAP_BROKERS = 'RedPandaBootstrapBrokers';
export const REDPANDA_CLUSTER_IPS = 'RedPandaClusterIPs';
export const LOAD_TEST_INSTANCE_IP = 'LoadTestInstanceIP';

export class RedPandaClusterStack extends Stack {
    static readonly keyName = "john.davis";
    private readonly redpandaInstances: ec2.Instance[] = [];
    
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        // Import VPC from Layer 1
        const vpc = ec2.Vpc.fromLookup(this, 'ImportedVPC', {
            isDefault: false,
            vpcName: layer1.SHASTA_VPC_NAME
        });

        // Import security group from Layer 1
        const securityGroupIdToken = cdk.Fn.importValue(layer1.SHASTA_SECURITY_GROUP_ID);
        const securityGroupId = cdk.Token.asString(securityGroupIdToken);
        const baseSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, "baseSecurityGroup", securityGroupId);

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

        // Import IAM role from Layer 1
        const roleArn = cdk.Fn.importValue(layer1.SHASTA_CDK_EC2_INSTANCE_ROLE_ARN);
        const role = iam.Role.fromRoleArn(this, 'ImportedRole', roleArn);

        // High-performance instance type for low latency
        const redpandaInstanceType = ec2.InstanceType.of(ec2.InstanceClass.I4I, ec2.InstanceSize.XLARGE2);
        const machineImage = ec2.MachineImage.latestAmazonLinux2023();

        // Get public subnets for RedPanda cluster (one per AZ) - need public IPs for direct access
        const publicSubnets = vpc.selectSubnets({subnetType: ec2.SubnetType.PUBLIC}).subnets;
        
        // Create RedPanda instances (one per AZ)
        const redpandaIPs: string[] = [];
        const redpandaPublicIPs: string[] = [];
        const azCount = Math.min(3, publicSubnets.length);
        
        for (let i = 0; i < azCount; i++) {
            const redpandaInstance = new ec2.Instance(this, `RedPandaNode${i}`, {
                vpc,
                vpcSubnets: { subnets: [publicSubnets[i]] },
                instanceType: redpandaInstanceType,
                machineImage,
                securityGroup: redpandaSecurityGroup,
                keyPair: ec2.KeyPair.fromKeyPairName(this, `RedPandaKeyPair${i}`, RedPandaClusterStack.keyName),
                role,
                associatePublicIpAddress: true,
                blockDevices: [{
                    deviceName: '/dev/xvda',
                    volume: ec2.BlockDeviceVolume.ebs(100, {
                        volumeType: ec2.EbsDeviceVolumeType.GP3,
                        iops: 16000,
                        throughput: 1000
                    })
                }]
            });

            // Basic system setup only - RedPanda installation will be done manually
            const basicConfig = this.generateBasicUserData(i);
            redpandaInstance.addUserData(...basicConfig);

            // Tag the instance
            cdk.Tags.of(redpandaInstance).add('shasta-role', 'redpanda-node');
            cdk.Tags.of(redpandaInstance).add('redpanda-node-id', i.toString());
            
            this.redpandaInstances.push(redpandaInstance);
            redpandaIPs.push(redpandaInstance.instancePrivateIp);
            redpandaPublicIPs.push(redpandaInstance.instancePublicIp);
        }

        // Create load testing instance in public subnet
        const loadTestInstance = new ec2.Instance(this, 'LoadTestInstance', {
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.C5N, ec2.InstanceSize.XLARGE4),
            machineImage,
            securityGroup: redpandaSecurityGroup,
            keyPair: ec2.KeyPair.fromKeyPairName(this, 'LoadTestKeyPair', RedPandaClusterStack.keyName),
            role,
            blockDevices: [{
                deviceName: '/dev/xvda',
                volume: ec2.BlockDeviceVolume.ebs(50, {
                    volumeType: ec2.EbsDeviceVolumeType.GP3
                })
            }]
        });

        // Basic system setup only - tools installation will be done manually
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

        new cdk.CfnOutput(this, LOAD_TEST_INSTANCE_IP, {
            value: loadTestInstance.instancePublicIp,
            description: 'Load test instance public IP',
            exportName: LOAD_TEST_INSTANCE_IP
        });
    }

    private generateBasicUserData(nodeId: number): string[] {
        return [
            '#!/bin/bash',
            'yum update -y',
            'yum install -y curl wget tar gzip git htop iotop nvme-cli util-linux-user',
            
            // Install SSM agent
            'yum install -y amazon-ssm-agent',
            'systemctl start amazon-ssm-agent',
            'systemctl enable amazon-ssm-agent',
            
            // Install Docker
            'yum install -y docker',
            'systemctl enable docker',
            'systemctl start docker',
            'usermod -a -G docker ec2-user',
            
            // Set hostname for cluster discovery
            `hostnamectl set-hostname redpanda-${nodeId}`,
            
            // Create environment variables for later use
            'su - ec2-user -c "touch ~/.bashrc"',
            `su - ec2-user -c "echo export NODE_ID=${nodeId} >> ~/.bashrc"`,
            'su - ec2-user -c "echo export CLUSTER_SIZE=3 >> ~/.bashrc"',
            
            // Create directory for scripts
            'mkdir -p /home/ec2-user/scripts',
            'chown ec2-user:ec2-user /home/ec2-user/scripts'
        ];
    }

    private generateBasicLoadTestUserData(): string[] {
        return [
            '#!/bin/bash',
            'yum update -y',
            'yum install -y curl wget tar gzip git htop iotop nvme-cli java-11-amazon-corretto python3 python3-pip',
            
            // Install SSM agent
            'yum install -y amazon-ssm-agent',
            'systemctl start amazon-ssm-agent',
            'systemctl enable amazon-ssm-agent',
            
            // Install Docker
            'yum install -y docker',
            'systemctl enable docker',
            'systemctl start docker',
            'usermod -a -G docker ec2-user',
            
            // Install Kafka CLI tools for later use
            'cd /opt',
            'wget https://archive.apache.org/dist/kafka/2.13-3.5.0/kafka_2.13-3.5.0.tgz',
            'tar -xzf kafka_2.13-3.5.0.tgz',
            'mv kafka_2.13-3.5.0 kafka',
            'chown -R ec2-user:ec2-user /opt/kafka',
            
            // Set up basic environment
            'su - ec2-user -c "touch ~/.bashrc"',
            'su - ec2-user -c "echo export KAFKA_HOME=/opt/kafka >> ~/.bashrc"',
            'su - ec2-user -c "echo export PATH=$PATH:/opt/kafka/bin >> ~/.bashrc"',
            
            // Create directories for scripts and tests
            'mkdir -p /home/ec2-user/scripts /home/ec2-user/load-test-scripts',
            'chown -R ec2-user:ec2-user /home/ec2-user/scripts /home/ec2-user/load-test-scripts'
        ];
    }
} 