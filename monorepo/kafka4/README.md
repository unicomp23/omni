# Kafka + Go Development Environment

This Docker Compose setup provides a complete development environment with Kafka and Go.

## Services

### kafka4
- **Image**: Confluent Platform Kafka 7.4.0
- **Ports**: 
  - `9093`: Kafka broker (accessible from host)
  - `9997`: JMX monitoring port
- **Mode**: KRaft (no Zookeeper required)
- **Features**: 
  - Single-node Kafka cluster
  - Persistent data storage
  - Health checks
  - JMX monitoring enabled

### dev-golang
- **Image**: Go 1.21 Alpine
- **Features**:
  - Workspace mounted to `/workspace`
  - Go project mounted to `/golang-project` (kafka.latency/golang.latency)
  - Go modules caching
  - Interactive shell access
  - Network access to Kafka

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

# Test connections
./scripts/test-connection.sh

# Stop the environment
./scripts/stop.sh
```

### Manual Docker Commands
```bash
# Start the environment
docker compose up -d

# Access the Go development container
docker compose exec dev-golang sh

# Stop the environment
docker compose down

# Stop and remove volumes (clean slate)
docker compose down -v
```

## Kafka Connection

From within the Go container, connect to Kafka using:
- **Broker address**: `kafka4:29092` (internal network)
- **From host**: `localhost:9093`

## Example Go Kafka Code

```go
package main

import (
    "context"
    "fmt"
    "github.com/segmentio/kafka-go"
)

func main() {
    // Connect to Kafka
    conn, err := kafka.DialContext(context.Background(), "tcp", "kafka4:29092")
    if err != nil {
        panic(err)
    }
    defer conn.Close()
    
    fmt.Println("Connected to Kafka!")
}
```

## Development Workflow

1. Start the containers: `docker-compose up -d`
2. Access the Go container: `docker-compose exec dev-golang sh`
3. Create/edit Go files in the mounted workspace
4. Run your Go applications that interact with Kafka
5. Use Kafka tools or your Go applications to create topics, produce, and consume messages

## Monitoring

- JMX monitoring is available on port `9997`
- Use tools like JConsole or Kafka Manager to monitor the cluster
- Check container logs: `docker-compose logs kafka4` or `docker-compose logs dev-golang` 