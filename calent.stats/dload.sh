# Get instance IDs and format them with commas
instance_ids=$(aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=cantina-dev-node-consumer-jd-asg" \
    --query 'Reservations[].Instances[].InstanceId' \
    --output text \
    --region us-east-1 | tr '\t' ',')

timestamp=$(date +%Y%m%d_%H%M%S)

# Copy logs to S3
aws ssm send-command \
    --targets "Key=instanceids,Values=${instance_ids}" \
    --document-name "AWS-RunShellScript" \
    --parameters '{"commands":["sudo tar czf /tmp/logs.tar.gz -C /home/ec2-user logs && aws s3 cp /tmp/logs.tar.gz s3://cantina-jd-logs/tmp-logs/'$timestamp'/$(curl -s http://169.254.169.254/latest/meta-data/instance-id).tar.gz"]}' \
    --region us-east-1

# Wait for copies to complete
sleep 10

# Download locally
aws s3 sync s3://cantina-jd-logs/tmp-logs/$timestamp/ ./instance-logs/ \
    --region us-east-1

# Extract all archives
for archive in instance-logs/*.tar.gz; do
    if [ -f "$archive" ]; then
        instance_id=$(basename "$archive" .tar.gz)
        mkdir -p "logs-$instance_id"
        tar xzf "$archive" -C "logs-$instance_id"
        rm "$archive"
    fi
done

# Cleanup S3
aws s3 rm s3://cantina-jd-logs/tmp-logs/$timestamp/ --recursive \
    --region us-east-1
