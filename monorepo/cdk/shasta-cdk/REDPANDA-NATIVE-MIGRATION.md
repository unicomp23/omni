# Redpanda Native Installation Migration

This document outlines the migration from Docker-based Redpanda deployment to native system installation using RPM packages.

## Overview

The Redpanda cluster setup has been updated to install Redpanda natively on Amazon Linux 2023 instances instead of using Docker containers. This provides better performance, easier management, and more native integration with systemd.

## Key Changes Made

### 1. CDK Stack Updates (`lib/redpanda-cluster-stack.ts`)

**Before:** Installing Docker and running Redpanda in containers
```typescript
'yum install -y docker',
'systemctl enable docker',
'systemctl start docker',
'usermod -a -G docker ec2-user'
```

**After:** Installing Redpanda natively using RPM packages
```typescript
'curl -1sLf \\',
'  "https://dl.redpanda.com/nzc4ZYQK3WRGd9sy/redpanda/cfg/setup/bash.rpm.sh" \\',
'  | sudo -E bash',
'',
'sudo yum install -y redpanda',
```

### 2. Setup Application Updates (`redpanda-setup/main.go`)

#### Configuration Management
- **Before:** Configuration stored in `/opt/redpanda/conf/redpanda.yaml`
- **After:** Configuration stored in `/etc/redpanda/redpanda.yaml` (standard location)

#### Data Directory
- **Before:** Docker volume mounts to `/opt/redpanda/data`
- **After:** Native data directory at `/var/lib/redpanda/data`

#### Service Management
- **Before:** Docker container lifecycle management
```go
"sudo docker stop redpanda || true",
"sudo docker rm redpanda || true",
"sudo docker run -d --name redpanda ..."
```

- **After:** Systemd service management
```go
"sudo systemctl stop redpanda || true",
"sudo systemctl start redpanda",
"sudo systemctl enable redpanda"
```

#### Health Checks
- **Before:** `sudo docker exec redpanda rpk cluster info`
- **After:** `rpk cluster info` (native command)

### 3. Cluster Management Scripts (`redpanda-setup/cluster-utils.sh`)

All Docker commands replaced with systemd and native rpk commands:

| Operation | Before (Docker) | After (Native) |
|-----------|----------------|----------------|
| Status Check | `sudo docker ps \| grep redpanda` | `sudo systemctl is-active redpanda` |
| Start Service | `sudo docker start redpanda` | `sudo systemctl start redpanda` |
| Stop Service | `sudo docker stop redpanda` | `sudo systemctl stop redpanda` |
| Restart | `sudo docker restart redpanda` | `sudo systemctl restart redpanda` |
| View Logs | `sudo docker logs redpanda` | `sudo journalctl -u redpanda` |
| RPK Commands | `sudo docker exec redpanda rpk ...` | `rpk ...` |

### 4. Load Test Instance Updates

The load test instance now also has native Redpanda/rpk installation for client operations.

## Installation Process

The installation process remains the same from a user perspective:

```bash
# Deploy infrastructure
cdk deploy RedPandaClusterStack

# Setup cluster
cd redpanda-setup
./setup-cluster.sh
```

## Benefits of Native Installation

1. **Better Performance**: No Docker overhead, direct system access
2. **Easier Management**: Standard systemd service management
3. **Native Integration**: Proper log management, service dependencies
4. **Resource Efficiency**: No container runtime overhead
5. **Simplified Debugging**: Direct access to logs and configuration

## Directory Structure

```
/etc/redpanda/                 # Configuration files
├── redpanda.yaml             # Main configuration

/var/lib/redpanda/            # Data directory
└── data/                     # Redpanda data files

/var/log/                     # System logs
└── redpanda/                 # Service logs (via journald)
```

## Service Management Commands

```bash
# Check service status
sudo systemctl status redpanda

# Start/stop/restart service
sudo systemctl start redpanda
sudo systemctl stop redpanda  
sudo systemctl restart redpanda

# Enable/disable autostart
sudo systemctl enable redpanda
sudo systemctl disable redpanda

# View logs
sudo journalctl -u redpanda --lines=50
sudo journalctl -u redpanda -f  # Follow logs
```

## RPK Client Commands

All rpk commands work directly without Docker:

```bash
# Cluster information
rpk cluster info

# Topic management
rpk topic list
rpk topic create my-topic -p 12 -r 3
rpk topic describe my-topic

# Producer/Consumer
rpk topic produce my-topic
rpk topic consume my-topic
```

## Configuration Management

- Configuration file: `/etc/redpanda/redpanda.yaml`
- Owned by: `redpanda:redpanda`
- Standard YAML format with all Redpanda settings

## Troubleshooting

### Service Issues
```bash
# Check if service is running
sudo systemctl is-active redpanda

# Get detailed status
sudo systemctl status redpanda

# View recent logs
sudo journalctl -u redpanda --lines=100 --no-pager
```

### Configuration Issues
```bash
# Validate configuration
sudo -u redpanda redpanda --config /etc/redpanda/redpanda.yaml --check

# View current configuration
cat /etc/redpanda/redpanda.yaml
```

### Network Issues
```bash
# Check if Redpanda is listening on expected ports
sudo netstat -tlnp | grep redpanda
sudo ss -tlnp | grep redpanda

# Test connectivity to cluster
rpk cluster info --brokers <node-ip>:9092
```

## Migration Complete

The cluster now runs Redpanda natively without Docker containers, providing better performance and easier management while maintaining full Kafka API compatibility. 