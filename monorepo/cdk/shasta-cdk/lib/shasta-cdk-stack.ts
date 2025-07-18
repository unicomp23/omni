import {Duration, Stack, StackProps} from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as msk from 'aws-cdk-lib/aws-msk';
import {Construct} from 'constructs';
import {MemoryDB} from 'cdk-redisdb';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as cdk from 'aws-cdk-lib';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ecr from 'aws-cdk-lib/aws-ecr'; // Added this line

export const SHASTA_BOOTSTRAP_BROKERS = 'MSKClusterBootstrapBrokers';
export const SHASTA_MEMORY_DB_ENDPOINT_ADDRESS = 'MemoryDBClusterEndpointAddress';
export const SHASTA_VPC_NAME = 'ShastaVpc001';
export const SHASTA_SECURITY_GROUP_ID = 'ShastaSecurityGroupId';
export const SHASTA_SNS_TOPIC_ARN = 'ShastaSnsTopicArn';
export const SHASTA_CDK_REPO_CLONE_URL_SSH = 'ShastaCdkRepoCloneUrlSsh';
export const SHASTA_CDK_REPO_CLONE_URL_HTTPS = 'ShastaCdkRepoCloneUrlHttps';
export const SHASTA_CDK_EC2_INSTANCE_ROLE_ARN = 'ShastaCdkEc2InstanceRoleArn';
export const SHASTA_CODECOMMIT_STREAM_NAME = 'ShastaCodecommitStreamName'; // Added this line
export const SHASTA_MULTICAST_STREAM_NAME = 'ShastaMulticastStreamName'; // Added this line
export const SHASTA_CDK_ECR_REPO_URI = 'ShastaCdkEcrRepoUri'; // Added this line

const vpcProps = {
    vpcName: SHASTA_VPC_NAME,
    createInternetGateway: true,
    subnetConfiguration: [
        {
            subnetType: ec2.SubnetType.PUBLIC,
            name: 'Public',
            cidrMask: 24,
        },
        {
            subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            name: 'Private',
            cidrMask: 24,
        },
    ],
    availabilityZones: ['us-east-1a', 'us-east-1b', 'us-east-1d'],
} as ec2.VpcProps;

export class ShastaCdkStackL1 extends Stack {
    // Define the Kafka version as a constant
    private static readonly KAFKA_VERSION = '4.0.x.kraft';

    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        const vpcInstance = new ec2.Vpc(this, 'ShastaCdkVpc', vpcProps);

        vpcInstance.addInterfaceEndpoint('EcrDockerEndpoint', {
            service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
        });

        vpcInstance.addInterfaceEndpoint('EcrEndpoint', {
            service: ec2.InterfaceVpcEndpointAwsService.ECR,
        });

        vpcInstance.addInterfaceEndpoint('SsmEndpoint', {
            service: ec2.InterfaceVpcEndpointAwsService.SSM,
        });

        vpcInstance.addInterfaceEndpoint('SsmMessagesEndpoint', {
            service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
        });

        vpcInstance.addInterfaceEndpoint('Ec2MessagesEndpoint', {
            service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
        });

        vpcInstance.addGatewayEndpoint('S3Endpoint', {
            service: ec2.GatewayVpcEndpointAwsService.S3,
        });

        const repo = new codecommit.Repository(this, 'ShastaCdkRepo', {
            repositoryName: 'ShastaCdkRepo',
        });

        const ecrRepo = new ecr.Repository(this, 'ShastaCdkEcrRepo', {
            repositoryName: 'shasta-cdk-ecr-repo',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            emptyOnDelete: true  // Updated from autoDeleteImages to emptyOnDelete
        });

        const snsTopic = new sns.Topic(this, 'ShastaCdkTopic');

        repo.onCommit('OnCommit', {
            target: new targets.SnsTopic(snsTopic),
            branches: ['master']
        });

        const securityGroupInstance = new ec2.SecurityGroup(this, 'ShastaCdkSecurityGroup', {
            vpc: vpcInstance,
            description: 'Main security group for Shasta services',
            allowAllOutbound: true,
        });

        securityGroupInstance.addIngressRule(
            ec2.Peer.ipv4(vpcInstance.vpcCidrBlock),
            ec2.Port.tcp(22),
            'allow SSH access within VPC'
        );
        securityGroupInstance.addIngressRule(
            ec2.Peer.ipv4(vpcInstance.vpcCidrBlock),
            ec2.Port.tcp(9092),
            'allow Kafka access within VPC'
        );
        securityGroupInstance.addIngressRule(
            ec2.Peer.ipv4(vpcInstance.vpcCidrBlock),
            ec2.Port.tcp(9644),
            'allow Prometheus metrics access within VPC'
        );
        securityGroupInstance.addIngressRule(
            securityGroupInstance,
            ec2.Port.allTraffic(),
            'allow access within the same security group'
        );
        securityGroupInstance.addIngressRule(
            ec2.Peer.ipv4(vpcInstance.vpcCidrBlock),
            ec2.Port.tcp(9094),
            'allow MSK TLS access within VPC'
        );

        const memoryDbInstance = new MemoryDB(this, 'ShastaCdkMemoryDb', {
            nodes: 3,
            nodeType: 'db.t4g.small',
            engineVersion: '7.1',
            existingVpc: vpcInstance,
            existingSecurityGroup: securityGroupInstance
        });
        const role = new iam.Role(this, 'ShastaCdkEc2InstanceRole', {
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
        });

        role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AWSCodeCommitFullAccess'));

        // Add ECR permissions
        role.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'ecr:*',
            ],
            resources: [ecrRepo.repositoryArn],
        }));

        // Add permissions for ECR authentication
        role.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'ecr:GetAuthorizationToken', // Allows authentication with ECR
                'ecr:BatchCheckLayerAvailability',
                'ecr:GetDownloadUrlForLayer',
                'ecr:BatchGetImage',
            ],
            resources: ['*'], // Adjust this if you want to restrict to specific ECR repositories
        }));

        const userToRole = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['sts:AssumeRole'],
            resources: [role.roleArn]
        });

        const memoryDbPolicy = new iam.PolicyStatement({
            actions: ['memorydb:*'],
            resources: [memoryDbInstance.cluster.attrArn],
        });

        const ecrPolicy = new iam.PolicyStatement({ // Added this line
            actions: ['ecr:*'], // Added this line
            resources: [ecrRepo.repositoryArn], // Added this line
        }); // Added this line

        new cdk.CfnOutput(this, SHASTA_CDK_REPO_CLONE_URL_SSH, {
            value: repo.repositoryCloneUrlSsh,
            description: 'Shasta CodeCommit repository clone URL (SSH)',
        });
        new cdk.CfnOutput(this, SHASTA_CDK_REPO_CLONE_URL_HTTPS, {
            value: repo.repositoryCloneUrlHttp,
            description: 'Shasta CodeCommit repository clone URL (HTTPS)',
        });

        new cdk.CfnOutput(this, SHASTA_SNS_TOPIC_ARN, {
            value: snsTopic.topicArn,
            description: 'Shasta SNS Topic ARN',
            exportName: SHASTA_SNS_TOPIC_ARN
        });

        new cdk.CfnOutput(this, SHASTA_CDK_ECR_REPO_URI, {
            value: ecrRepo.repositoryUri,
            description: 'Shasta ECR repository URI',
            exportName: SHASTA_CDK_ECR_REPO_URI
        });
        
        const azCount = vpcInstance.selectSubnets({subnetType: ec2.SubnetType.PRIVATE_ISOLATED}).availabilityZones.length;
        console.log(`Availability Zones Count: ${azCount}`);

        // Define the MSK configuration using the constant
        const mskConfig = new msk.CfnConfiguration(this, 'ShastaCdkMskConfig', {
            name: `ShastaCdkMskConfig-40-${cdk.Aws.STACK_NAME}`,
            kafkaVersionsList: [ShastaCdkStackL1.KAFKA_VERSION],
            serverProperties: `
auto.create.topics.enable=true
delete.topic.enable=true
num.partitions=36
num.io.threads=36
num.network.threads=16
num.replica.fetchers=16`
        });
        
        // Define the MSK cluster using the constant
        const mskCluster = new msk.CfnCluster(this, 'ShastaCdkMskCluster', {
            clusterName: 'ShastaCdkMskCluster',
            kafkaVersion: ShastaCdkStackL1.KAFKA_VERSION,
            numberOfBrokerNodes: azCount,
            brokerNodeGroupInfo: {
                instanceType: 'kafka.m7g.xlarge',
                securityGroups: [securityGroupInstance.securityGroupId],
                clientSubnets: vpcInstance.selectSubnets({subnetType: ec2.SubnetType.PRIVATE_ISOLATED}).subnetIds
            },
            configurationInfo: {
                arn: mskConfig.ref,
                revision: 1
            },
            encryptionInfo: {
                encryptionInTransit: {
                    clientBroker: 'PLAINTEXT',
                    inCluster: true
                }
            },
            clientAuthentication: {
                unauthenticated: {
                    enabled: true
                },
                sasl: {
                    iam: {
                        enabled: false
                    },
                    scram: {
                        enabled: false
                    },
                },
                tls: {
                }
            }
        });

        const mskClusterBootstrapBrokers = new cr.AwsCustomResource(this, 'BootstrapBrokers', {
            onCreate: {
                service: 'Kafka',
                action: 'getBootstrapBrokers',
                parameters: {
                    ClusterArn: mskCluster.ref
                },
                physicalResourceId: cr.PhysicalResourceId.of('BootstrapBrokers')
            },
            policy: cr.AwsCustomResourcePolicy.fromSdkCalls({resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE})
        });

        mskClusterBootstrapBrokers.node.addDependency(mskCluster);

        new cdk.CfnOutput(this, SHASTA_BOOTSTRAP_BROKERS, {
            value: mskClusterBootstrapBrokers.getResponseField('BootstrapBrokerString'),
            description: 'MSK Cluster Bootstrap Brokers',
            exportName: SHASTA_BOOTSTRAP_BROKERS
        });

        new cdk.CfnOutput(this, SHASTA_MEMORY_DB_ENDPOINT_ADDRESS, {
            value: memoryDbInstance.cluster.attrClusterEndpointAddress,
            description: 'MemoryDB Cluster Endpoint Address',
            exportName: SHASTA_MEMORY_DB_ENDPOINT_ADDRESS
        });

        new cdk.CfnOutput(this, SHASTA_SECURITY_GROUP_ID, {
            value: securityGroupInstance.securityGroupId,
            description: 'Shasta Security Group ID',
            exportName: SHASTA_SECURITY_GROUP_ID
        });

        new cdk.CfnOutput(this, SHASTA_CDK_EC2_INSTANCE_ROLE_ARN, {
            value: role.roleArn,
            description: 'ARN of the IAM role for the EC2 instances',
            exportName: SHASTA_CDK_EC2_INSTANCE_ROLE_ARN
        });

        new cdk.CfnOutput(this, SHASTA_CODECOMMIT_STREAM_NAME, { 
            value: SHASTA_CODECOMMIT_STREAM_NAME,
            description: 'Shasta CodeCommit Stream Name',
            exportName: SHASTA_CODECOMMIT_STREAM_NAME
        }); 

        new cdk.CfnOutput(this, SHASTA_MULTICAST_STREAM_NAME, { 
            value: SHASTA_MULTICAST_STREAM_NAME,
            description: 'Shasta Multicast Stream Name',
            exportName: SHASTA_MULTICAST_STREAM_NAME
        }); 

    }
}
