FROM golang:1.21-alpine

# Set working directory
WORKDIR /workspace

# Install dependencies for running tests
RUN apk add --no-cache bash curl jq

# Copy go mod files first for better caching
COPY go.mod ./
# Copy go.sum if it exists
COPY go.su[m] ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build all the Go programs
RUN go build -o /usr/local/bin/latency-producer ./latency-producer.go
RUN go build -o /usr/local/bin/latency-consumer ./latency-consumer.go
RUN go build -o /usr/local/bin/auto-exit-consumer ./auto-exit-consumer.go
RUN go build -o /usr/local/bin/coordinated-producer ./coordinated-producer.go
RUN go build -o /usr/local/bin/coordinated-consumer ./coordinated-consumer.go

# Keep container running
CMD ["tail", "-f", "/dev/null"] 