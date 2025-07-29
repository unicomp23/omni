# RedPanda Load Test - Bidirectional S3 Sync with Hash Verification

This advanced utility provides **2-way synchronization** between local `.gz` log files and S3 storage, using cryptographic hashes for integrity verification and intelligent conflict resolution.

## 🚀 Key Features

### Hash-Based Integrity
- **SHA256** (recommended) or **MD5** hash verification
- Files are compared by hash, not just size/timestamp
- Automatic hash verification on downloads
- S3 metadata stores hash information for future comparisons

### Bidirectional Sync
- **Upload**: Local → S3 (traditional sync)
- **Download**: S3 → Local (for distributed analysis)
- **Bidirectional**: Smart 2-way sync with conflict resolution
- **Mode Selection**: Upload-only, download-only, or bidirectional

### Intelligent Conflict Resolution
- Identical hashes: Skip sync (files are same)
- Different hashes: Sync newer file based on modification time
- Missing local: Download from S3
- Missing remote: Upload to S3
- Hash verification ensures data integrity

## 📋 Quick Start

### 1. Basic Bidirectional Sync (Recommended)

```bash
# 2-way sync with SHA256 hashes
./run-bidirectional-s3-sync.sh
```

### 2. Production Load Test Instance

```bash
# Upload-only with cleanup (saves local disk space)
./run-bidirectional-s3-sync.sh --upload-only --cleanup --daemon
```

### 3. Analysis Instance

```bash
# Download-only (pulls all logs from S3 for analysis)
./run-bidirectional-s3-sync.sh --download-only
```

### 4. Multi-Instance Distributed Setup

```bash
# Bidirectional sync allows multiple instances to share logs
./run-bidirectional-s3-sync.sh --daemon --hash-type sha256
```

## 🔧 Configuration Options

### Command Line Arguments

| Option | Description | Example |
|--------|-------------|---------|
| `-b, --bucket` | S3 bucket name | `--bucket my-logs-bucket` |
| `-l, --logs` | Local logs directory | `--logs /var/log/redpanda` |
| `-r, --region` | AWS region | `--region us-west-2` |
| `--hash-type` | Hash algorithm (md5\|sha256) | `--hash-type sha256` |
| `-c, --cleanup` | Remove local files after upload | `--cleanup` |
| `-u, --upload-only` | Only upload, don't download | `--upload-only` |
| `-d, --download-only` | Only download, don't upload | `--download-only` |
| `-o, --once` | Run once and exit | `--once` |
| `--daemon` | Run as background daemon | `--daemon` |
| `--stop` | Stop running daemon | `--stop` |

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `S3_BUCKET` | S3 bucket name | `redpanda-load-test-358474168551-us-east-1` |
| `LOGS_DIR` | Local logs directory | `./logs` |
| `AWS_REGION` | AWS region | `us-east-1` |
| `HASH_TYPE` | Hash algorithm | `sha256` |
| `CLEANUP_LOCAL` | Enable local cleanup | `false` |
| `UPLOAD_ONLY` | Upload-only mode | `false` |
| `DOWNLOAD_ONLY` | Download-only mode | `false` |

## 🔄 Sync Modes Explained

### Bidirectional Mode (Default)
- **Best for**: Multi-instance setups, distributed analysis
- **Behavior**: 
  - Uploads new local files to S3
  - Downloads new S3 files to local
  - Resolves conflicts using hash comparison
  - Newer files win when hashes differ

```bash
# Standard bidirectional sync
./run-bidirectional-s3-sync.sh
```

### Upload-Only Mode
- **Best for**: Production load testing instances
- **Behavior**: Only pushes local files to S3
- **Benefits**: Saves bandwidth, prevents local pollution

```bash
# Production instance configuration
./run-bidirectional-s3-sync.sh --upload-only --cleanup --daemon
```

### Download-Only Mode  
- **Best for**: Analysis instances, data aggregation
- **Behavior**: Only pulls files from S3 to local
- **Benefits**: Centralizes data for analysis

```bash
# Analysis instance configuration
./run-bidirectional-s3-sync.sh --download-only
```

## 🔐 Hash Algorithm Comparison

### SHA256 (Recommended)
- **Security**: Cryptographically secure
- **Collision Resistance**: Extremely low probability
- **Performance**: Slightly slower than MD5
- **Best For**: Production environments, long-term storage

### MD5 (Legacy Support)
- **Security**: Not cryptographically secure (but sufficient for file comparison)
- **Collision Resistance**: Theoretical collisions possible
- **Performance**: Faster than SHA256
- **Best For**: Development, quick integrity checks

```bash
# Use SHA256 (recommended)
./run-bidirectional-s3-sync.sh --hash-type sha256

# Use MD5 (faster, less secure)
./run-bidirectional-s3-sync.sh --hash-type md5
```

## 📊 Sync Decision Logic

The utility uses this decision tree for each file:

```
For each .gz file found locally or in S3:

1. Calculate/retrieve hashes for both local and remote versions
2. Compare existence and hashes:

   ┌─ Both exist, same hash → SKIP (files identical)
   │
   ├─ Both exist, different hash → SYNC NEWER
   │  ├─ Local newer → UPLOAD (if upload enabled)
   │  └─ Remote newer → DOWNLOAD (if download enabled)
   │
   ├─ Local only → UPLOAD (if upload enabled)
   │
   ├─ Remote only → DOWNLOAD (if download enabled)
   │
   └─ Neither exists → SKIP
```

## 🌐 Use Cases & Deployment Patterns

### 1. Single Load Test Instance
```bash
# Simple upload-only with cleanup
./run-bidirectional-s3-sync.sh --upload-only --cleanup --daemon
```

### 2. Multi-Instance Load Testing
```bash
# Instance A (primary)
./run-bidirectional-s3-sync.sh --daemon

# Instance B (secondary) 
./run-bidirectional-s3-sync.sh --daemon

# Both instances share logs bidirectionally
```

### 3. Distributed Analysis Setup
```bash
# Load test instances (upload only)
./run-bidirectional-s3-sync.sh --upload-only --cleanup --daemon

# Analysis instance (download only) 
./run-bidirectional-s3-sync.sh --download-only --daemon

# Analysis gets all logs without polluting S3
```

### 4. Development & Testing
```bash
# One-time bidirectional sync for testing
./run-bidirectional-s3-sync.sh --once --hash-type md5

# Quick upload test
./run-bidirectional-s3-sync.sh --upload-only --once
```

## 📈 Performance & Efficiency

### Hash Caching
- Local file hashes calculated once per sync cycle
- S3 metadata stores hashes to avoid recalculation
- Files with identical hashes are skipped entirely

### Bandwidth Optimization
- Only transfers files that have actually changed
- Hash comparison prevents unnecessary uploads/downloads
- Compression already applied by load test (gzip)

### Storage Optimization
- Uses S3 Standard-IA for cost-effective long-term storage
- Optional local cleanup saves disk space
- Duplicate detection prevents redundant storage

### Network Efficiency
```
Traditional Sync:  Always transfers files (even if identical)
Hash-Based Sync:   Only transfers when hashes differ

Example with 100 identical files:
- Traditional: 100 transfers (wastes bandwidth)
- Hash-based: 0 transfers (optimal efficiency)
```

## 🛠️ Monitoring & Management

### Daemon Management
```bash
# Start daemon
./run-bidirectional-s3-sync.sh --daemon

# Check status
./run-bidirectional-s3-sync.sh --stop  # Shows status

# View logs
tail -f bidirectional-s3-sync.log

# Stop daemon
./run-bidirectional-s3-sync.sh --stop

# Force kill if stuck
./run-bidirectional-s3-sync.sh --kill
```

### Log Output Examples
```
[2024-01-15 14:30:15] 🔍 Starting bidirectional sync scan...
[2024-01-15 14:30:15]    Upload mode: true, Download mode: true
[2024-01-15 14:30:16] 📋 Found 3 unique files to analyze
[2024-01-15 14:30:16] 🔄 Processing: latency-2024-01-15T13-00-00Z.jsonl.gz
[2024-01-15 14:30:16] 🔍 Analyzing: latency-2024-01-15T13-00-00Z.jsonl.gz
[2024-01-15 14:30:16]    Local: exists=true, hash=a1b2c3d4...
[2024-01-15 14:30:17]    Remote: exists=true, hash=a1b2c3d4...
[2024-01-15 14:30:17] ✅ Files are identical (hash match)
[2024-01-15 14:30:17] 📊 Sync summary: 3 successful, 0 errors
```

### S3 Metadata Structure
Each uploaded file includes rich metadata:
```json
{
  "original-filename": "latency-2024-01-15T13-00-00Z.jsonl.gz",
  "upload-time": "2024-01-15T14:30:17Z",
  "source-host": "ip-10-1-0-217",
  "file-size": "2048576",
  "file-hash": "a1b2c3d4e5f6...",
  "hash-type": "sha256"
}
```

## 🔒 Security Considerations

### Hash Algorithm Security
- **SHA256**: Cryptographically secure, recommended for production
- **MD5**: Not cryptographically secure, but sufficient for file comparison
- Hash collisions in log files are practically impossible

### AWS Permissions Required
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject", 
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:GetObjectMetadata",
        "s3:PutObjectMetadata"
      ],
      "Resource": [
        "arn:aws:s3:::your-bucket-name",
        "arn:aws:s3:::your-bucket-name/*"
      ]
    }
  ]
}
```

### Data Integrity
- Hash verification on every download
- Automatic cleanup of corrupted downloads
- S3 server-side verification via ETag comparison
- Metadata consistency checks

## 🚨 Troubleshooting

### Common Issues

#### Hash Verification Failures
```bash
# Check file integrity
sha256sum ./logs/problematic-file.gz

# Re-download with verification
./run-bidirectional-s3-sync.sh --download-only --once
```

#### Sync Conflicts
```bash
# Force upload local version
./run-bidirectional-s3-sync.sh --upload-only --once

# Force download remote version  
./run-bidirectional-s3-sync.sh --download-only --once
```

#### Performance Issues
```bash
# Use MD5 for faster hashing (if security isn't critical)
./run-bidirectional-s3-sync.sh --hash-type md5

# Run one-time sync to clear backlog
./run-bidirectional-s3-sync.sh --once
```

### Debug Mode
```bash
# Enable verbose logging
export DEBUG=true
./run-bidirectional-s3-sync.sh --once
```

## 🆚 Comparison: Original vs Bidirectional Sync

| Feature | Original S3 Sync | Bidirectional S3 Sync |
|---------|------------------|----------------------|
| **Direction** | Upload only | Upload, Download, or Both |
| **Integrity** | Size/timestamp | Cryptographic hashes |
| **Efficiency** | May upload duplicates | Skips identical files |
| **Conflict Resolution** | Overwrites | Smart resolution by time |
| **Hash Algorithms** | None | MD5, SHA256 |
| **Verification** | Basic | Download verification |
| **Multi-Instance** | Limited | Full support |
| **Analysis Support** | Manual download | Automatic aggregation |

## 🎯 Best Practices

### Production Deployment
1. **Load Test Instances**: Use `--upload-only --cleanup --daemon`
2. **Analysis Instances**: Use `--download-only --daemon` 
3. **Hash Algorithm**: Use `sha256` for production
4. **Monitoring**: Monitor logs and daemon status
5. **Storage**: Use S3 lifecycle policies for cost optimization

### Development & Testing
1. **Quick Tests**: Use `--once` for immediate sync
2. **Hash Algorithm**: Use `md5` for faster development cycles
3. **Bidirectional**: Test multi-instance scenarios
4. **Cleanup**: Avoid `--cleanup` during development

### Performance Optimization
1. **Hash Caching**: Let the utility cache hashes
2. **Sync Frequency**: Default 60s interval is usually optimal
3. **Network**: Use same AWS region for faster transfers
4. **Concurrent Instances**: Limit to avoid API throttling

This bidirectional sync utility transforms simple log storage into a powerful distributed data synchronization system, perfect for multi-instance load testing and distributed analysis workflows! 🎉

## 🔧 Systemd Service (Production Deployment)

For production deployments, you can run the bidirectional S3 sync as a systemd service for better reliability and automatic startup.

### Install the Service

```bash
# Copy service file to systemd directory
sudo cp redpanda-bidirectional-s3-sync.service /etc/systemd/system/

# Reload systemd configuration
sudo systemctl daemon-reload

# Enable the service to start on boot
sudo systemctl enable redpanda-bidirectional-s3-sync

# Start the service
sudo systemctl start redpanda-bidirectional-s3-sync
```

### Manage the Service

```bash
# Check service status
sudo systemctl status redpanda-bidirectional-s3-sync

# View logs
sudo journalctl -u redpanda-bidirectional-s3-sync -f

# Restart the service
sudo systemctl restart redpanda-bidirectional-s3-sync

# Stop the service
sudo systemctl stop redpanda-bidirectional-s3-sync

# Disable auto-start
sudo systemctl disable redpanda-bidirectional-s3-sync
```

### Customize Service Configuration

Edit the service file to modify settings:

```bash
sudo nano /etc/systemd/system/redpanda-bidirectional-s3-sync.service
```

Key settings to customize:

- `Environment=S3_BUCKET=your-bucket-name`: Change bucket name
- `Environment=HASH_TYPE=sha256`: Set hash algorithm (md5|sha256)
- `Environment=UPLOAD_ONLY=true`: Set sync mode (true for upload-only)
- `Environment=CLEANUP_LOCAL=true`: Enable/disable local file cleanup  
- `WorkingDirectory`: Update paths if installed elsewhere
- `MemoryMax=512M`: Adjust memory limit as needed

### Default Service Configuration

The service is configured for **production load test instances** with:
- **Upload-only mode**: Prevents downloading files from S3
- **SHA256 hashing**: Cryptographically secure integrity checking
- **Local cleanup**: Automatically removes uploaded files to save disk space
- **Auto-restart**: Automatically restarts on failure
- **Resource limits**: Memory and process limits for stability 