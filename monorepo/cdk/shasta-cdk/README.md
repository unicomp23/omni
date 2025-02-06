# Welcome to your CDK TypeScript project

You should explore the contents of this project. It demonstrates a CDK app with an instance of a stack (`ShastaCdkStack`)
which contains an Amazon SQS queue that is subscribed to an Amazon SNS topic.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template

//////
scp -i /path/to/your/key.pem ec2-user@your.ec2.ip.address:/path/on/ec2/yourfile /local/path

//////
aws ec2 describe-instances --filters "Name=tag:YourTagName,Values=YourTagValue" --query "Reservations[*].Instances[*].InstanceId" --output text --region us-east-1

//////
aws ssm send-command \
    --region us-east-1 \
    --document-name "AWS-RunShellScript" \
    --parameters 'commands=["sudo -u ec2-user -i /bin/bash -c \"mkdir -p ~/tmp && cd ~/repo/ShastaCdkRepo/shasta && npm i && npx ts-node src/lib/pubsub/loadtest.ts > ~/tmp/log.test.txt 2>&1\""]' \
    --targets "Key=tag:Role,Values=worker" \
    --max-concurrency "128"

###
# List all EC2 instances with the tag "Role=worker"
instances=$(aws ec2 describe-instances --filters "Name=tag:Role,Values=worker" --query "Reservations[*].Instances[*].PublicIpAddress" --output text --region us-east-1)

# Loop over the instances
for ip in $instances
do
  # Create a directory for each IP
  mkdir -p ~/tmp/loadtest/$ip

  # Copy the file from each instance into its respective directory
  scp -o StrictHostKeyChecking=no -i ~/Downloads/john.davis.keypair.pem ec2-user@$ip:tmp/instrumentation.json ~/tmp/loadtest/$ip/

  # Copy the log.test.txt file from each instance into its respective directory
  scp -o StrictHostKeyChecking=no -i ~/Downloads/john.davis.keypair.pem ec2-user@$ip:tmp/log.test.txt ~/tmp/loadtest/$ip/
done

###
instances=$(aws ec2 describe-instances --filters "Name=tag:Role,Values=worker" --query "Reservations[*].Instances[*].PublicIpAddress" --output text --region us-east-1)

# Iterate over all instances and run the load test in the background
for ip in $instances
do
  echo "Running load test on instance: $ip"
  ssh -f -o StrictHostKeyChecking=no -i ~/Downloads/john.davis.keypair.pem ec2-user@$ip "nohup sh -c 'mkdir -p ~/tmp && cd ~/repo/ShastaCdkRepo/shasta && npm i && npx ts-node src/lib/pubsub/loadtest.ts > ~/tmp/log.test.txt 2>&1' &" >> ~/tmp/ssh.log 2>&1
  echo "Load test initiated on instance: $ip"
done

//////
johndavis@Johns-MacBook-Pro-2 tmp % cat dload.instrumentation.sh
# List all EC2 instances with the tag "Role=worker"
instances=$(aws ec2 describe-instances --filters "Name=tag:Role,Values=worker" --query "Reservations[*].Instances[*].PublicIpAddress" --output text --region us-east-1)

# Loop over the instances
for ip in $instances
do
  # Create a directory for each IP
  mkdir -p ~/tmp/loadtest/$ip

  # Copy the file from each instance into its respective directory
  scp -o StrictHostKeyChecking=no -i ~/Downloads/john.davis.keypair.pem ec2-user@$ip:tmp/instrumentation.json ~/tmp/loadtest/$ip/

  # Copy the log.test.txt file from each instance into its respective directory
  scp -o StrictHostKeyChecking=no -i ~/Downloads/john.davis.keypair.pem ec2-user@$ip:tmp/log.test.txt ~/tmp/loadtest/$ip/
done


johndavis@Johns-MacBook-Pro-2 tmp % cat send-commands.sh
#!/bin/bash

# Get the list of instance IDs
instances=$(aws ec2 describe-instances --filters "Name=instance-state-name,Values=running" "Name=tag:Role,Values=worker" --query "Reservations[*].Instances[*].InstanceId" --output text --region us-east-1)

# Convert the list of instance IDs into an array
instance_array=($instances)

# Print out the number of instances
echo "Number of instances: ${#instance_array[@]}"

# Define the size of each batch
batch_size=20

# Calculate the number of batches
num_batches=$(((${#instance_array[@]} + batch_size - 1) / batch_size))

# Print out the number of batches
echo "Number of batches: $num_batches"

# Loop over the batches
for ((batch=0; batch<$num_batches; batch++))
do
  # Calculate the start and end indices for this batch
  start=$((batch * batch_size))
  end=$((start + batch_size - 1))

  # Get the instance IDs for this batch
  batch_instances=("${instance_array[@]:$start:$batch_size}")

  # Print out the instance IDs in this batch
  echo "Batch $batch: ${batch_instances[@]}"

  # Send the command to the instances in this batch
  aws ssm send-command \
      --region us-east-1 \
      --document-name "AWS-RunShellScript" \
      --parameters 'commands=["sudo -u ec2-user -i /bin/bash -c \"mkdir -p ~/tmp && cd ~/repo/ShastaCdkRepo/shasta && npm i && npx ts-node src/lib/pubsub/loadtest.ts > ~/tmp/log.test.txt 2>&1\""]' \
      --instance-ids "${batch_instances[@]}" >/dev/null 2>&1

  # Sleep for 1 second before moving on to the next batch
  sleep 1
done

---.ssh/config---
Host git-codecommit.*.amazonaws.com
  User APKAVG5VZXDTTXZCRE7K
  IdentityFile ~/.ssh/id_rsa
