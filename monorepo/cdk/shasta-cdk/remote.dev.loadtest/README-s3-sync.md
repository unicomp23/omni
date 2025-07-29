# RedPanda Load Test - S3 Log Sync Utility

This utility syncs compressed (.gz) latency log files from the load test instance to the S3 bucket for long-term storage and analysis.

## Overview

The load test generates latency logs in JSONL format that are automatically rotated every hour and compressed with gzip. This sync utility monitors the `./logs/` directory and uploads these compressed files to S3 for permanent storage.

## Features

- **Automatic Discovery**: Scans logs directory for .gz files
- **Duplicate Detection**: Checks if files already exist in S3 before uploading  
- **Metadata Enrichment**: Adds useful metadata to S3 objects
- **Cost Optimization**: Uses S3 Standard-IA storage class for infrequent access
- **Local Cleanup**: Option to remove local files after successful upload
- **Continuous/One-time Modes**: Run continuously or as one-time sync
- **Daemon Support**: Background daemon with PID file management
- **Progress Tracking**: Detailed logging with timestamps and progress indicators

## Quick Start

### 1. Basic Usage (Continuous Sync)

```bash
# Run with default settings (continuous sync every 60 seconds)
./run-s3-sync.sh
```

### 2. One-time Sync

```bash
# Run once and exit
./run-s3-sync.sh --once
```

### 3. Run as Background Daemon

```bash
# Start daemon
./run-s3-sync.sh --daemon

# Check logs
tail -f s3-sync.log

# Stop daemon  
./run-s3-sync.sh --stop
```

### 4. Enable Local File Cleanup

```bash
# Remove local .gz files after successful upload
./run-s3-sync.sh --cleanup --daemon
```

## Configuration Options

### Command Line Arguments

| Option | Description | Default |
|--------|-------------|---------|
| `-b, --bucket` | S3 bucket name | `redpanda-load-test-358474168551-us-east-1` |
| `-l, --logs` | Local logs directory | `./logs` |
| `-r, --region` | AWS region | `us-east-1` |
| `-c, --cleanup` | Remove local files after upload | `false` |
| `-o, --once` | Run once and exit | `false` (continuous) |
| `-d, --daemon` | Run as background daemon | `false` |
| `-s, --stop` | Stop running daemon | - |
| `-k, --kill` | Force kill sync processes | - |
| `--build-only` | Just build binary, don't run | `false` |
| `-h, --help` | Show help message | - |

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `S3_BUCKET` | Override bucket name | `my-custom-bucket` |
| `LOGS_DIR` | Override logs directory | `/var/log/redpanda` |
| `AWS_REGION` | Override AWS region | `us-west-2` |
| `CLEANUP_LOCAL` | Enable cleanup | `true` |
| `SYNC_ONCE` | Run once mode | `true` |

## Usage Examples

### Development/Testing

```bash
# Test sync once with default settings
./run-s3-sync.sh --once

# Test with custom bucket and cleanup
./run-s3-sync.sh --bucket my-test-bucket --cleanup --once
```

### Production Deployment

```bash
# Start as daemon with cleanup enabled
./run-s3-sync.sh --daemon --cleanup

# Monitor the daemon
tail -f s3-sync.log

# Check daemon status (look for PID file)
ls -la s3-sync.pid

# Stop the daemon
./run-s3-sync.sh --stop
```

### Using Environment Variables

```bash
# Set configuration via environment
export S3_BUCKET="my-production-bucket"
export CLEANUP_LOCAL="true"
export AWS_REGION="us-west-2"

# Run with environment settings
./run-s3-sync.sh --daemon
```

## S3 Organization

Files are uploaded with the following structure:

```
s3://bucket-name/
└── latency-logs/
    ├── latency-2024-01-15T10-00-00Z.jsonl.gz
    ├── latency-2024-01-15T11-00-00Z.jsonl.gz
    └── latency-2024-01-15T12-00-00Z.jsonl.gz
```

### S3 Object Metadata

Each uploaded file includes metadata:

- `original-filename`: Original filename
- `upload-time`: When the file was uploaded (ISO8601)
- `source-host`: Hostname of the upload source
- `file-size`: File size in bytes
- `content-type`: `application/gzip`
- `content-encoding`: `gzip`
- `storage-class`: `STANDARD_IA` (for cost optimization)

## Log File Format

The latency logs use JSONL format (one JSON object per line):

```json
{"timestamp":"2024-01-15T10:30:45.123Z","send_time":"2024-01-15T10:30:45.100Z","receive_time":"2024-01-15T10:30:45.123Z","latency_ms":23.456,"consumer_id":2,"partition":5,"offset":12345}
```

### Fields

- `timestamp`: When the measurement was recorded
- `send_time`: When the message was originally sent  
- `receive_time`: When the message was received
- `latency_ms`: End-to-end latency in milliseconds
- `consumer_id`: Which consumer processed the message
- `partition`: Kafka partition number
- `offset`: Kafka offset

## Monitoring and Troubleshooting

### Check Daemon Status

```bash
# Check if daemon is running
./run-s3-sync.sh --stop  # Will show status even if not running

# Check PID file
if [[ -f s3-sync.pid ]]; then
    echo "Daemon PID: $(cat s3-sync.pid)"
    ps -p $(cat s3-sync.pid)
fi
```

### View Logs

```bash
# Follow daemon logs
tail -f s3-sync.log

# View recent activity
tail -50 s3-sync.log

# Search for errors
grep -i error s3-sync.log
```

### Common Issues

1. **AWS Credentials**: Ensure the load test instance has proper IAM permissions for S3
2. **Network Connectivity**: Check internet access and S3 endpoint reachability
3. **Disk Space**: Monitor disk usage if not using cleanup mode
4. **Go Dependencies**: The script will automatically handle Go module dependencies

### Force Restart

```bash
# Kill any stuck processes and restart
./run-s3-sync.sh --kill
./run-s3-sync.sh --daemon --cleanup
```

## Systemd Service (Recommended for Production)

For production deployments, you can run the S3 sync as a systemd service for better reliability and automatic startup.

### Install the Service

```bash
# Copy service file to systemd directory
sudo cp redpanda-s3-sync.service /etc/systemd/system/

# Reload systemd configuration
sudo systemctl daemon-reload

# Enable the service to start on boot
sudo systemctl enable redpanda-s3-sync

# Start the service
sudo systemctl start redpanda-s3-sync
```

### Manage the Service

```bash
# Check service status
sudo systemctl status redpanda-s3-sync

# View logs
sudo journalctl -u redpanda-s3-sync -f

# Restart the service
sudo systemctl restart redpanda-s3-sync

# Stop the service
sudo systemctl stop redpanda-s3-sync

# Disable auto-start
sudo systemctl disable redpanda-s3-sync
```

### Customize Service Configuration

Edit the service file to modify settings:

```bash
sudo nano /etc/systemd/system/redpanda-s3-sync.service
```

Key settings to customize:

- `Environment=S3_BUCKET=your-bucket-name`: Change bucket name
- `Environment=CLEANUP_LOCAL=true`: Enable/disable local file cleanup  
- `WorkingDirectory`: Update paths if installed elsewhere
- `MemoryMax=256M`: Adjust memory limit as needed

## Integration with Load Test

The sync utility is designed to work alongside the main load test (`main.go`):

1. **Load Test**: Generates latency logs with hourly rotation and gzip compression
2. **S3 Sync**: Monitors for new .gz files and uploads them to S3
3. **Storage**: Files are stored in S3 Standard-IA for cost-effective long-term retention

### Recommended Setup

For a long-running load test, use this configuration:

```bash
# Start load test
go run main.go &

# Start S3 sync daemon with cleanup
./run-s3-sync.sh --daemon --cleanup
```

This ensures:
- Latency data is continuously backed up to S3
- Local disk usage is controlled (old files are removed)
- Both processes run independently without interference

## Performance Considerations

- **Sync Interval**: 60 seconds (configurable in source)
- **Storage Class**: Standard-IA for cost optimization
- **Compression**: Files are already gzipped by the load test
- **Metadata**: Minimal metadata added for tracking
- **Cleanup**: Optional local file removal to manage disk space

## Security

- Uses IAM roles/credentials configured on the EC2 instance
- No hardcoded credentials in the code
- Files uploaded with appropriate content-type and encoding headers
- Supports all standard AWS credential providers (IAM roles, profiles, environment variables) 