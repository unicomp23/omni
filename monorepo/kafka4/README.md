# Kafka 4.0.0 + Go Development Environment

This Docker Compose setup provides a complete development environment with Apache Kafka 4.0.0 and Go (franz-go).

## Architecture

```
kafka4/
├── docker-compose.yml        # Kafka 4.0.0 + Go containers
├── golang-project/           # Go development files
│   ├── go.mod               # Go module configuration
│   ├── producer.go          # Basic producer
│   ├── consumer.go          # Basic consumer
│   ├── coordinated-producer.go # Time-based producer
│   ├── coordinated-consumer.go # Time-based consumer
│   ├── latency-producer.go  # Latency testing producer
│   └── latency-consumer.go  # Latency testing consumer
└── scripts/                 # Helper scripts
    ├── start.sh             # Start containers
    ├── stop.sh              # Stop containers
    ├── shell.sh             # Access Go container
    ├── producer.sh          # Run Go producer
    ├── consumer.sh          # Run Go consumer
    ├── run-coordinated-test.sh # Run coordinated performance tests
    └── topic-manager.sh     # Topic management with UUID generation
```

## Quick Start

1. **Start the environment:**
   ```bash
   ./scripts/start.sh
   ```

2. **Run coordinated performance test:**
   ```bash
   ./scripts/run-coordinated-test.sh
   ```

3. **Analyze results:**
   ```bash
   ./calculate-percentiles.sh <latency-file>.jsonl
   ```

## Container Services

### kafka4
- **Apache Kafka 4.0.0** with KRaft (no Zookeeper)
- **Ports**: 9093 (external), 9997 (JMX)
- **Bootstrap Server**: localhost:9093 (from host), kafka4:29092 (from containers)

### dev-golang
- **Go development** environment with franz-go
- **Golang project** mounted to `/workspace/golang-project`

## Volume Mounts

- **Local golang-project**: `./golang-project:/workspace/golang-project` - Go development files
- **Kafka data**: `kafka_data:/tmp/kraft-combined-logs` - Persistent Kafka data

## Essential Commands

### Container Management
```bash
# Start all containers
./scripts/start.sh

# Stop all containers
./scripts/stop.sh

# Access Go development container
./scripts/shell.sh

# View logs
./scripts/logs.sh
```

### Go Development
```bash
# Run Go producer
./scripts/producer.sh

# Run Go consumer
./scripts/consumer.sh

# Access Go container directly
docker compose exec dev-golang sh
```

### Performance Testing
```bash
# Run coordinated test with default settings (2 producers, 3 consumers)
./scripts/run-coordinated-test.sh

# Run custom test (producers, consumers, messages, spacing, buffer)
./scripts/run-coordinated-test.sh 3 2 10 500 1000

# Get help
./scripts/run-coordinated-test.sh --help
```

### Analysis Tools
```bash
# Calculate percentiles
./calculate-percentiles.sh <latency-file>.jsonl

# Basic latency analysis
./analyze-latency-logs.sh <latency-file>.jsonl

# Compare configurations
./compare-percentiles.sh file1.jsonl file2.jsonl "Config 1" "Config 2"
```

## Coordinated Testing

The coordinated test system provides **predictable, timer-based producer-consumer coordination**:

- **Producers** emit messages at regular intervals with timing metadata
- **Consumers** calculate exit time based on: (messages × spacing) + buffer
- **Automatic exit** without timeouts or hanging processes
- **Latency tracking** with JSONL output for analysis

Example test configurations:
```bash
# Quick test: 1 producer, 1 consumer, 5 messages, 200ms spacing
./scripts/run-coordinated-test.sh 1 1 5 200

# Load test: 5 producers, 3 consumers, 20 messages, 100ms spacing
./scripts/run-coordinated-test.sh 5 3 20 100

# Stress test: 10 producers, 5 consumers, 100 messages, 50ms spacing
./scripts/run-coordinated-test.sh 10 5 100 50
```

## Topic Management

```bash
# Create fresh topics with UUIDs
./scripts/topic-manager.sh fresh

# List all topics
./scripts/topic-manager.sh list

# Cleanup old test topics
./scripts/topic-manager.sh cleanup
```

## Development Workflow

1. **Environment Setup**:
   ```bash
   ./scripts/start.sh
   ./scripts/topic-manager.sh fresh
   ```

2. **Development**:
   - Edit Go files in `golang-project/`
   - Test with `./scripts/producer.sh` and `./scripts/consumer.sh`

3. **Performance Testing**:
   ```bash
   ./scripts/run-coordinated-test.sh
   ./calculate-percentiles.sh <generated-latency-file>.jsonl
   ```

4. **Debugging**:
   ```bash
   ./scripts/logs.sh         # All logs
   ./scripts/logs.sh kafka4  # Kafka logs
   ./scripts/shell.sh        # Access Go container
   ```

## Connection Information

- **Kafka from host**: localhost:9093
- **Kafka from containers**: kafka4:29092
- **JMX monitoring**: localhost:9997

## Troubleshooting

- **Container issues**: Check `docker compose logs`
- **Kafka connection**: Run `./scripts/test-connection.sh`
- **Go build issues**: Ensure Go modules are properly configured in `golang-project/`
- **Performance issues**: Use coordinated tests with different configurations

## Features

- ✅ **Apache Kafka 4.0.0** with KRaft mode
- ✅ **Go development** with franz-go client
- ✅ **Coordinated testing** with timer-based exit
- ✅ **Latency analysis** with percentile calculations
- ✅ **Topic management** with UUID generation
- ✅ **Performance comparison** between different configurations
- ✅ **Timestamp logging** for debugging
- ✅ **Clean exit handling** with proper signal management 