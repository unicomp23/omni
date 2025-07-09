# Kafka 4.0.0 + Go + Java Development Environment

This Docker Compose setup provides a complete development environment with Apache Kafka 4.0.0, Go (franz-go), and Java.

## Project Structure

```
kafka4/
├── docker-compose.yml
├── README.md
├── AUTO-EXIT-STRATEGIES.md  # Documentation for auto-exit patterns
├── topic-config.env        # Topic configuration (generated)
├── golang-project/         # Go development files
│   ├── go.mod
│   ├── test-producer.go
│   ├── test-consumer.go
│   ├── latency-producer.go
│   ├── latency-consumer.go
│   └── auto-exit-consumer.go
├── java-project/           # Java development files
│   ├── pom.xml
│   └── src/main/java/com/example/kafka/
│       ├── KafkaProducer.java
│       ├── KafkaConsumer.java
│       ├── LatencyProducer.java
│       ├── LatencyConsumer.java
│       └── AutoExitLatencyConsumer.java
├── scripts/               # Helper scripts
│   ├── start.sh           # Start containers
│   ├── stop.sh            # Stop containers
│   ├── shell.sh           # Access Go container
│   ├── producer.sh        # Run Go producer
│   ├── consumer.sh        # Run Go consumer
│   ├── java-shell.sh      # Access Java container
│   ├── java-build.sh      # Build Java project
│   ├── java-producer.sh   # Run Java producer
│   ├── java-consumer.sh   # Run Java consumer
│   ├── test-connection.sh # Test Kafka connection
│   ├── run-coordinated-test.sh # Timer-based coordinated testing
│   ├── compare-go-java-perf.sh # Go vs Java performance comparison tool
│   ├── topic-manager.sh   # Manage Kafka topics
│   ├── kafka-topics.sh    # Kafka topic utilities
│   ├── logs.sh            # View container logs
│   └── help.sh            # Show all available commands
└── analysis/              # Analysis scripts (generated)
    ├── analyze-latency-logs.sh
    ├── collect-latency-logs.sh
    ├── calculate-percentiles.sh
    └── compare-percentiles.sh
```

## Services

### kafka4
- **Image**: Confluent Platform Kafka 8.0.0 (Apache Kafka 4.0.0)
- **Ports**: 
  - `9093`: Kafka broker (accessible from host)
  - `9997`: JMX monitoring port
- **Mode**: KRaft (no Zookeeper required)
- **Features**: 
  - Single-node Apache Kafka 4.0.0 cluster
  - Persistent data storage
  - Health checks
  - JMX monitoring enabled

### dev-golang
- **Image**: Go 1.21 Alpine
- **Features**:
  - Workspace mounted to `/workspace`
  - Go project mounted to `/golang-project` (local `./golang-project`)
  - Go modules caching
  - Interactive shell access
  - Network access to Kafka
  - Franz-go v1.18.0 client library for Kafka 4.0.0

### dev-java
- **Image**: OpenJDK 17 (JDK Slim)
- **Features**:
  - Workspace mounted to `/workspace`
  - Java project mounted to `/java-project`
  - Maven cache for dependencies
  - Interactive shell access (bash)
  - Network access to Kafka
  - Apache Kafka 4.0.0 client libraries

## Volume Mounts

The setup uses the following volume configuration:
- **Local golang-project**: `./golang-project:/golang-project` - Go development files
- **Local java-project**: `./java-project:/java-project` - Java development files
- **Workspace**: `.:/workspace` - Full project access
- **Named volumes**: `go_modules`, `maven_cache`, `kafka_data` for persistence

## Usage

### Helper Scripts
For convenience, use the provided helper scripts:

```bash
# Show all available commands
./scripts/help.sh

# Start the environment
./scripts/start.sh

# Access the Go development container
./scripts/shell.sh

# Run the producer
./scripts/producer.sh

# Run the consumer
./scripts/consumer.sh

# Access Java development container
./scripts/java-shell.sh

# Build Java project
./scripts/java-build.sh

# Run Java producer
./scripts/java-producer.sh

# Run Java consumer
./scripts/java-consumer.sh

# Test connections
./scripts/test-connection.sh

# Stop the environment
./scripts/stop.sh
```

### Latency Testing
The project uses a sophisticated **timer-based coordination** approach for testing:

```bash
# Run coordinated producer-consumer latency test
./scripts/run-coordinated-test.sh

# Examples with different configurations:
./scripts/run-coordinated-test.sh 3 2 5 1000        # 3 producers, 2 consumers, 5 messages, 1000ms spacing
./scripts/run-coordinated-test.sh 1 1 10 500 3000   # 1 producer, 1 consumer, 10 messages, 500ms spacing, 3s buffer

# Show help
./scripts/run-coordinated-test.sh --help
```

**Timer-based coordination benefits:**
- ✅ Consumers exit gracefully (no timeout kills)
- ✅ Predictable timing and clean shutdown
- ✅ Scales with any number of partitions/consumers
- ✅ No coordination overhead between processes

### Go vs Java Performance Comparison
Compare latency performance between Go (franz-go) and Java (Kafka client) implementations:

```bash
# Run performance comparison with visual progress
./scripts/compare-go-java-perf.sh

# Examples with different configurations:
./scripts/compare-go-java-perf.sh 1000 5 60          # 1000 messages, 5ms spacing, 60s timeout
./scripts/compare-go-java-perf.sh 100 10 30         # 100 messages, 10ms spacing, 30s timeout

# Show help
./scripts/compare-go-java-perf.sh --help
```

**Performance comparison features:**
- 📊 **Visual progress monitoring** - Real-time progress bars and counters
- 🏆 **Automatic winner analysis** - Percentage improvements across all metrics
- 📋 **Detailed percentile reports** - P50, P75, P90, P95, P99 analysis
- 📈 **Side-by-side comparison** - Min, Max, Average latency comparison
- 🎯 **Command line flexibility** - Configurable message count and spacing

### Topic Management

```bash
# Create fresh topics for testing
./scripts/topic-manager.sh fresh

# List all topics
./scripts/topic-manager.sh list

# Delete test topics
./scripts/topic-manager.sh clean
```

### Manual Docker Commands
```bash
# Start the environment
docker compose up -d

# Access the Go development container
docker compose exec dev-golang sh

# Access the Java development container
docker compose exec dev-java bash

# Stop the environment
docker compose down

# Stop and remove volumes (clean slate)
docker compose down -v
```

## Kafka Connection

From within the containers, connect to Kafka using:
- **Broker address**: `kafka4:29092` (internal network)
- **From host**: `localhost:9093`

## Example Go Kafka Code (Franz-Go)

The `golang-project` directory contains working examples using the franz-go v1.18.0 library:

```go
package main

import (
    "context"
    "fmt"
    "log"
    "time"

    "github.com/twmb/franz-go/pkg/kgo"
)

func main() {
    // Connect to Kafka 4.0.0 using franz-go
    client, err := kgo.NewClient(
        kgo.SeedBrokers("kafka4:29092"),
        kgo.ClientID("test-producer"),
    )
    if err != nil {
        log.Fatal(err)
    }
    defer client.Close()

    // Create a record
    record := &kgo.Record{
        Topic: "test-topic",
        Key:   []byte("test-key"),
        Value: []byte("Hello from franz-go producer!"),
    }

    // Produce the record
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    
    if err := client.ProduceSync(ctx, record).FirstErr(); err != nil {
        log.Fatal(err)
    }

    fmt.Println("Message sent successfully!")
}
```

## Development Workflow

1. **Start the environment**: `./scripts/start.sh` or `docker compose up -d`
2. **Access containers**: 
   - Go: `./scripts/shell.sh` or `docker compose exec dev-golang sh`
   - Java: `docker compose exec dev-java bash`
3. **Develop locally**: Edit files in `golang-project/` or `java-project/` directories
4. **Test from containers**: Run your applications inside the containers
5. **Create topics**: Use Kafka tools to create topics as needed
6. **Monitor**: Check logs with `docker compose logs kafka4`

## Testing Workflow

### Timer-Based Coordinated Testing
```bash
# Default test: 2 producers, 3 consumers, 4 messages each, 800ms spacing
./scripts/run-coordinated-test.sh

# Scale test: 5 producers, 3 consumers, 10 messages each, 500ms spacing
./scripts/run-coordinated-test.sh 5 3 10 500 1000

# Simple test: 1 producer, 1 consumer
./scripts/run-coordinated-test.sh 1 1 10 500 3000
```

### How Timer-Based Coordination Works
1. **Producers embed timing metadata** in each message
2. **Consumers learn emission pattern** from first coordinated message  
3. **Consumers calculate exit time**: `(messages × spacing) + buffer`
4. **All consumers exit gracefully** after calculated time period

### Test Results Analysis
The coordinated test generates timestamped JSON log files containing latency measurements:

```bash
# Generated files include:
# - coordinated-latency-YYYYMMDD-HHMMSS.jsonl
# - consumer-N-YYYYMMDD-HHMMSS.log
# - producer-N-YYYYMMDD-HHMMSS.log

# Use analysis scripts to process results:
./calculate-percentiles.sh
./compare-percentiles.sh
```

### Test Integration
The coordinated test automatically runs **both Java and Go** implementations with the timer-based approach for clean, predictable exits.

## Working with Topics

```bash
# Create a topic
docker exec -it kafka4 kafka-topics --create --topic my-topic --bootstrap-server kafka4:29092 --partitions 1 --replication-factor 1

# List topics
docker exec -it kafka4 kafka-topics --list --bootstrap-server kafka4:29092

# Describe a topic
docker exec -it kafka4 kafka-topics --describe --topic my-topic --bootstrap-server kafka4:29092
```

## Troubleshooting

- **Connection issues**: Ensure Kafka is healthy with `docker compose ps`
- **Topic errors**: Create topics before producing messages
- **Go module issues**: Run `go mod tidy` in the golang-project directory
- **Java build issues**: Ensure Maven dependencies are properly configured
- **Volume issues**: Use `docker compose down -v` to reset volumes

## Monitoring

- JMX monitoring is available on port `9997`
- Use tools like JConsole or Kafka Manager to monitor the cluster
- Check container logs: `docker compose logs kafka4` or `docker compose logs dev-golang` 