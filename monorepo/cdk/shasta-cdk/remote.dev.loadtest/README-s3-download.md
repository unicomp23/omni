# RedPanda Load Test - S3 Download Utility

This utility downloads compressed (.gz) latency log files from the S3 bucket to your local system for analysis.

## Overview

The S3 download utility complements the upload sync utility by allowing you to retrieve stored log files from S3. It can list available files, filter by patterns, and download files while preserving directory structure and timestamps.

## Features

- **File Listing**: Browse available files in S3 without downloading
- **Pattern Filtering**: Filter files by substring patterns (e.g., date ranges)
- **Selective Downloads**: Download specific files or limit the number of files
- **Directory Preservation**: Maintains S3 directory structure locally
- **Timestamp Preservation**: Preserves original file modification times
- **Resume-Friendly**: Skips existing files unless overwrite is enabled
- **Progress Tracking**: Shows download progress with speed metrics
- **Flexible Output**: Configurable output directory

## Quick Start

### 1. List Available Files

```bash
# List all files in the bucket
./run-s3-download.sh --list

# List files with detailed information
./run-s3-download.sh --list --detailed

# List recent files (limit to 20)
./run-s3-download.sh --list --max 20
```

### 2. Download Files

```bash
# Download all files to default directory (./downloads)
./run-s3-download.sh

# Download files matching a pattern
./run-s3-download.sh --pattern "2024-01-15"

# Download to custom directory
./run-s3-download.sh --output ./my-logs
```

### 3. Advanced Usage

```bash
# Download specific number of recent files
./run-s3-download.sh --max 10 --overwrite

# List files matching pattern with details
./run-s3-download.sh --list --pattern "latency-2024" --detailed --max 50
```

## Configuration Options

### Command Line Arguments

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--bucket` | `-b` | S3 bucket name | `redpanda-load-test-358474168551-us-east-1` |
| `--output` | `-o` | Local output directory | `./downloads` |
| `--region` | `-r` | AWS region | `us-east-1` |
| `--prefix` | `-p` | S3 key prefix | `latency-logs/` |
| `--pattern` | `-t` | Filter files by pattern | (none) |
| `--max` | `-m` | Maximum files to process | 0 (all) |
| `--overwrite` | `-f` | Overwrite existing files | false |
| `--list` | `-l` | List files only | false |
| `--detailed` | `-d` | Show detailed file info | false |
| `--build-only` |  | Just build binary | false |
| `--help` | `-h` | Show help message |  |

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `S3_BUCKET` | Override bucket name | `my-custom-bucket` |
| `OUTPUT_DIR` | Override output directory | `./custom-downloads` |
| `AWS_REGION` | Override AWS region | `us-west-2` |
| `AWS_PROFILE` | AWS profile name | `358474168551_admin` |
| `S3_PREFIX` | Override S3 prefix | `my-logs/` |
| `PATTERN` | Default filter pattern | `2024-01-15` |
| `MAX_FILES` | Default max files | `50` |
| `OVERWRITE_FILES` | Enable overwrite | `true` |

## Usage Examples

### Exploring Available Data

```bash
# Quick overview of available files
./run-s3-download.sh --list --max 10

# Detailed view of recent files
./run-s3-download.sh --list --detailed --max 20

# Search for files from a specific date
./run-s3-download.sh --list --pattern "2024-01-15"

# Find files from a specific hour
./run-s3-download.sh --list --pattern "T14-" --detailed
```

### Downloading Data for Analysis

```bash
# Download recent data for analysis
./run-s3-download.sh --max 5 --output ./analysis-data

# Download full day's data
./run-s3-download.sh --pattern "2024-01-15" --output ./jan-15-data

# Download and overwrite existing files
./run-s3-download.sh --pattern "latest" --overwrite --max 3
```

### Working with Custom S3 Setup

```bash
# Download from different bucket
./run-s3-download.sh --bucket my-test-bucket --prefix "logs/"

# Use environment variables
export S3_BUCKET="my-production-bucket"
export OUTPUT_DIR="./prod-logs"
export PATTERN="2024-01"
./run-s3-download.sh --list
```

## File Organization

### S3 Structure
Files in S3 follow this pattern:
```
s3://bucket-name/
└── latency-logs/
    ├── latency-2024-01-15T10-00-00Z.jsonl.gz
    ├── latency-2024-01-15T11-00-00Z.jsonl.gz
    └── latency-2024-01-15T12-00-00Z.jsonl.gz
```

### Local Structure
Downloaded files preserve the structure:
```
./downloads/
├── latency-2024-01-15T10-00-00Z.jsonl.gz
├── latency-2024-01-15T11-00-00Z.jsonl.gz
└── latency-2024-01-15T12-00-00Z.jsonl.gz
```

## Working with Downloaded Files

### Extracting and Viewing Data

```bash
# Extract a downloaded file
cd downloads
gunzip latency-2024-01-15T10-00-00Z.jsonl.gz

# View the JSON data
head -10 latency-2024-01-15T10-00-00Z.jsonl

# Count records
wc -l latency-2024-01-15T10-00-00Z.jsonl

# Search for specific patterns
grep "latency_ms.*[5-9][0-9][0-9]" latency-2024-01-15T10-00-00Z.jsonl
```

### Analysis Examples

```bash
# Find high-latency messages (>100ms)
jq 'select(.latency_ms > 100)' latency-2024-01-15T10-00-00Z.jsonl

# Calculate average latency
jq -r '.latency_ms' latency-2024-01-15T10-00-00Z.jsonl | awk '{sum+=$1} END {print "Average:", sum/NR}'

# Group by consumer
jq -r '.consumer_id' latency-2024-01-15T10-00-00Z.jsonl | sort | uniq -c
```

## Troubleshooting

### Common Issues

1. **AWS Credentials**: Ensure proper IAM permissions for S3 read access
2. **Network Connectivity**: Check internet access and S3 endpoint reachability  
3. **Disk Space**: Ensure sufficient local disk space for downloads
4. **File Permissions**: Check write permissions for output directory

### Debugging Commands

```bash
# Test AWS credentials
aws s3 ls s3://redpanda-load-test-358474168551-us-east-1/latency-logs/

# Check available space
df -h ./downloads

# Verify downloads
ls -la downloads/
```

### Performance Tips

- Use `--max` to limit downloads for testing
- Use `--pattern` to filter specific time ranges
- Consider network bandwidth when downloading large datasets
- Use `--list` first to estimate download size

## Integration with Upload Sync

The download utility works perfectly with the upload sync utility:

1. **Upload**: `./run-s3-sync.sh --daemon --cleanup` (continuous backup)
2. **Analysis**: `./run-s3-download.sh --pattern "2024-01-15" --max 10` (selective download)
3. **Processing**: Extract and analyze downloaded files locally

## AWS Credentials Configuration

The download utility is designed to run locally and requires AWS credentials to access S3.

### Default Profile Setup

By default, the script looks for the `358474168551_admin` profile in your `~/.aws/credentials` file:

```ini
[358474168551_admin]
aws_access_key_id=YOUR_ACCESS_KEY
aws_secret_access_key=YOUR_SECRET_KEY
aws_session_token=YOUR_SESSION_TOKEN  # if using temporary credentials
```

### Using Different Profiles

To use a different AWS profile:

```bash
# Set via environment variable
export AWS_PROFILE=my-profile
./run-s3-download.sh --list

# Or use default profile
export AWS_PROFILE=default
./run-s3-download.sh --list
```

### Difference from Upload Script

- **Upload Script**: Runs on the load test instance with IAM role (no local credentials needed)
- **Download Script**: Runs locally, requires AWS credentials in `~/.aws/credentials`

## Security

- Uses AWS credential providers with profile support
- No hardcoded credentials in the code
- Respects IAM permissions and S3 bucket policies
- Files maintain their original access patterns locally 