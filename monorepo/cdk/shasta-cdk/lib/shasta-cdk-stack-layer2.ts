import {Duration, Stack, StackProps} from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import {Construct} from 'constructs';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as layer1 from './shasta-cdk-stack';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';

export class ShastaCdkStackL2 extends Stack {
    static readonly keyName = "john.davis";
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        const vpc = ec2.Vpc.fromLookup(this, 'ImportedVPC', {
            isDefault: false,
            vpcName: layer1.SHASTA_VPC_NAME
        });

        const securityGroupIdToken = cdk.Fn.importValue(layer1.SHASTA_SECURITY_GROUP_ID);
        const securityGroupId = cdk.Token.asString(securityGroupIdToken);
        const securityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, "securityGroup", securityGroupId);

        const shastaCdkEcrRepoUri = cdk.Fn.importValue(layer1.SHASTA_CDK_ECR_REPO_URI);

        const bootstrapBrokers = cdk.Fn.importValue(layer1.SHASTA_BOOTSTRAP_BROKERS)
        const memoryDbEndpointAddress = cdk.Fn.importValue(layer1.SHASTA_MEMORY_DB_ENDPOINT_ADDRESS);
        const repo = codecommit.Repository.fromRepositoryName(this, 'ImportedRepo', 'ShastaCdkRepo');
        const snsTopicArn = cdk.Fn.importValue(layer1.SHASTA_SNS_TOPIC_ARN);
        const codecommitStreamName = cdk.Fn.importValue(layer1.SHASTA_CODECOMMIT_STREAM_NAME); // Added this line
        const multicastStreamName = cdk.Fn.importValue(layer1.SHASTA_MULTICAST_STREAM_NAME); // Added this line
        
        const roleArn = cdk.Fn.importValue(layer1.SHASTA_CDK_EC2_INSTANCE_ROLE_ARN);
        const role = iam.Role.fromRoleArn(this, 'ImportedRole', roleArn);

        const userData = [
            `su - ec2-user -c "touch ~/.bashrc"`,
            `su - ec2-user -c "echo export BOOTSTRAP_BROKERS=${bootstrapBrokers} >> ~/.bashrc"`,
            `su - ec2-user -c "echo export MEMORY_DB_ENDPOINT_ADDRESS=${memoryDbEndpointAddress} >> ~/.bashrc"`,
            `su - ec2-user -c "echo export CODECOMMIT_REPO_SSH=${repo.repositoryCloneUrlSsh} >> ~/.bashrc"`,
            `su - ec2-user -c "echo export CODECOMMIT_REPO_HTTPS=${repo.repositoryCloneUrlHttp} >> ~/.bashrc"`,
            `su - ec2-user -c "echo export SNS_TOPIC_ARN=${snsTopicArn} >> ~/.bashrc"`,
            `su - ec2-user -c "echo export CODECOMMIT_STREAM_NAME=${codecommitStreamName} >> ~/.bashrc"`, // Added this line
            `su - ec2-user -c "echo export MULTICAST_STREAM_NAME=${multicastStreamName} >> ~/.bashrc"`, // Added this line
            `su - ec2-user -c "echo export SHASTA_CDK_ECR_REPO_URI=${shastaCdkEcrRepoUri} >> ~/.bashrc"`, // Added this line
            `yum update -y`,
            `yum groupinstall 'Development Tools' -y`,
            `yum install docker -y`,
            `systemctl enable docker`,
            `systemctl start docker`,
            `usermod -a -G docker ec2-user`,
            `yum install -y amazon-ssm-agent`,
            `systemctl start amazon-ssm-agent`,
            `systemctl enable amazon-ssm-agent`,
            `yum install -y git emacs`,
            `yum install -y java-11-amazon-corretto`, // Install Amazon Corretto 11 JDK
            `su - ec2-user -c "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash"`,
            `su - ec2-user -c "source ~/.nvm/nvm.sh && nvm install 18"`,
            `su - ec2-user -c "echo 'export NVM_DIR=~/.nvm' >> ~/.bashrc"`,
            `su - ec2-user -c "echo '[ -s ~/.nvm/nvm.sh ] && . ~/.nvm/nvm.sh' >> ~/.bashrc"`,
            `su - ec2-user -c "echo '[ -s ~/.nvm/bash_completion ] && . ~/.nvm/bash_completion' >> ~/.bashrc"`,
            `su - ec2-user -c "nvm use 18"`,
            `su - ec2-user -c "git config --global credential.helper '!aws codecommit credential-helper $@'"`,
            `su - ec2-user -c "git config --global credential.UseHttpPath true"`,
            `su - ec2-user -c "mkdir ~/repo"`,
            `su - ec2-user -c "chown ec2-user:ec2-user ~/repo"`,
            `su - ec2-user -c "cd ~/repo && git clone -b feature/SHASTA-14-deleted-tdo ${repo.repositoryCloneUrlHttp}"`,
            `curl -L "https://github.com/docker/compose/releases/download/v2.26.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose`, // Added this line
            `chmod +x /usr/local/bin/docker-compose`, // Added this line
        ];

        // const instanceType = ec2.InstanceType.of('m7i' as ec2.InstanceClass, ec2.InstanceSize.XLARGE2);
        const instanceType = ec2.InstanceType.of(ec2.InstanceClass.C5, ec2.InstanceSize.XLARGE4);
        const machineImage = ec2.MachineImage.latestAmazonLinux2023();

        // Update security group to allow direct SSH access from anywhere
        securityGroup.addIngressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(22),
            'Allow direct SSH access from anywhere'
        );

        // Create producer instances in public subnets for direct SSH access
        const producerCount = Number(process.env.INSTANCE_COUNT) || 1;
        for (let instanceIndex = 0; instanceIndex < producerCount; instanceIndex++) {
            const instanceProducer = new ec2.Instance(this, `ShastaCdkEc2InstanceProducer${instanceIndex}`, {
                vpc,
                vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
                instanceType,
                machineImage,
                securityGroup,
                keyName: ShastaCdkStackL2.keyName,
                role,
                blockDevices: [{
                    deviceName: '/dev/xvda',
                    volume: ec2.BlockDeviceVolume.ebs(64)
                }]
            });
            cdk.Tags.of(instanceProducer).add('shasta-role', 'producer');
            userData.forEach(data => instanceProducer.addUserData(data));
        }

        // Create consumer instances in public subnets for direct SSH access
        const consumerCount = Number(process.env.INSTANCE_COUNT) || 1;
        const consumerInstanceType = ec2.InstanceType.of(ec2.InstanceClass.C5, ec2.InstanceSize.XLARGE4);
        for (let instanceIndex = 0; instanceIndex < consumerCount; instanceIndex++) {
            const instanceConsumer = new ec2.Instance(this, `ShastaCdkEc2InstanceConsumer${instanceIndex}`, {
                vpc,
                vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
                instanceType: consumerInstanceType,
                machineImage,
                securityGroup,
                keyName: ShastaCdkStackL2.keyName,
                role,
                blockDevices: [{
                    deviceName: '/dev/xvda',
                    volume: ec2.BlockDeviceVolume.ebs(64)
                }]
            });
            cdk.Tags.of(instanceConsumer).add('shasta-role', 'consumer');
            userData.forEach(data => instanceConsumer.addUserData(data));
            instanceConsumer.addUserData(`touch /tmp/consumer.txt`);
        }

        // Define the environment variables and SSM setup for ASG instances
        const asgUserData = ec2.UserData.forLinux();
        asgUserData.addCommands(
            // Environment variables
            `su - ec2-user -c "touch ~/.bashrc"`,
            `su - ec2-user -c "echo export BOOTSTRAP_BROKERS=${bootstrapBrokers} >> ~/.bashrc"`,
            `su - ec2-user -c "echo export MEMORY_DB_ENDPOINT_ADDRESS=${memoryDbEndpointAddress} >> ~/.bashrc"`,
            `su - ec2-user -c "echo export CODECOMMIT_REPO_SSH=${repo.repositoryCloneUrlSsh} >> ~/.bashrc"`,
            `su - ec2-user -c "echo export CODECOMMIT_REPO_HTTPS=${repo.repositoryCloneUrlHttp} >> ~/.bashrc"`,
            `su - ec2-user -c "echo export SNS_TOPIC_ARN=${snsTopicArn} >> ~/.bashrc"`,
            `su - ec2-user -c "echo export CODECOMMIT_STREAM_NAME=${codecommitStreamName} >> ~/.bashrc"`,
            `su - ec2-user -c "echo export MULTICAST_STREAM_NAME=${multicastStreamName} >> ~/.bashrc"`,
            `su - ec2-user -c "echo export SHASTA_CDK_ECR_REPO_URI=${shastaCdkEcrRepoUri} >> ~/.bashrc"`,
            // Basic setup
            `yum update -y`,
            `yum install -y git docker awscli`,  // Added awscli
            `systemctl enable docker`,
            `systemctl start docker`,
            `usermod -a -G docker ec2-user`,
            // Docker login for both root and ec2-user
            `AWS_ACCOUNT_ID=$(echo "$SHASTA_CDK_ECR_REPO_URI" | cut -d. -f1)`,
            // Root login
            `aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com"`,
            // ec2-user login
            `su - ec2-user -c "aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin '$AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com'"`,
            // Docker compose setup
            `curl -L "https://github.com/docker/compose/releases/download/v2.26.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose`,
            `chmod +x /usr/local/bin/docker-compose`
        );

        const producerAsg = new autoscaling.AutoScalingGroup(this, 'ProducerASG', {
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            instanceType,
            machineImage,
            securityGroup,
            keyName: ShastaCdkStackL2.keyName,
            role,
            minCapacity: 0,
            desiredCapacity: 0,
            maxCapacity: 128,
            blockDevices: [{
                deviceName: '/dev/xvda',
                volume: autoscaling.BlockDeviceVolume.ebs(64)
            }],
            userData: asgUserData
        });
        cdk.Tags.of(producerAsg).add('shasta-role', 'producer-asg');

        const consumerAsg = new autoscaling.AutoScalingGroup(this, 'ConsumerASG', {
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            instanceType: consumerInstanceType,
            machineImage,
            securityGroup,
            keyName: ShastaCdkStackL2.keyName,
            role,
            minCapacity: 0,
            desiredCapacity: 0,
            maxCapacity: 8,
            blockDevices: [{
                deviceName: '/dev/xvda',
                volume: autoscaling.BlockDeviceVolume.ebs(64)
            }],
            userData: asgUserData
        });
        cdk.Tags.of(consumerAsg).add('shasta-role', 'consumer-asg');

        // Add SSM Session Manager permissions for console access
        const ssmSessionPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'ssm:StartSession',
                'ssm:TerminateSession',
                'ssm:ResumeSession',
                'ssm:DescribeSessions',
                'ssm:GetConnectionStatus',
                'ssm:DescribeInstanceProperties',
                'ec2:DescribeInstances',
                'ssm:DescribeInstanceInformation',
                'ssmmessages:CreateControlChannel',
                'ssmmessages:CreateDataChannel',
                'ssmmessages:OpenControlChannel',
                'ssmmessages:OpenDataChannel',
                'ssm:ListAssociations',
                'ssm:ListInstanceAssociations'
            ],
            resources: ['*']
        });

        // Add the policy to the user/role that needs console access
        (role as iam.Role).addToPolicy(ssmSessionPolicy);

        // If you have a specific user that needs access, add it to them as well
        const user = new iam.User(this, 'ShastaCdkEc2User');
        user.addToPolicy(ssmSessionPolicy);
    }
    
}
