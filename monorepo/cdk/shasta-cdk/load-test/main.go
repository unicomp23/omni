package main

import (
	"context"
	"crypto/rand"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"
)

type Config struct {
	brokers        string
	topic          string
	producers      int
	consumers      int
	messageSize    int
	duration       time.Duration
	batchSize      int
	compression    string
	partitions     int
	replication    int
	printInterval  time.Duration
}

type Metrics struct {
	messagesSent     int64
	messagesReceived int64
	bytesSent        int64
	bytesReceived    int64
	errors           int64
	startTime        time.Time
	lastPrintTime    time.Time
	lastSent         int64
	lastReceived     int64
}

func main() {
	config := parseFlags()
	
	log.Printf("Starting RedPanda Load Test with franz-go")
	log.Printf("Brokers: %s", config.brokers)
	log.Printf("Topic: %s", config.topic)
	log.Printf("Producers: %d, Consumers: %d", config.producers, config.consumers)
	log.Printf("Message Size: %d bytes", config.messageSize)
	log.Printf("Duration: %v", config.duration)
	log.Printf("Compression: %s", config.compression)

	// Create admin client to manage topics
	adminClient, err := kgo.NewClient(
		kgo.SeedBrokers(strings.Split(config.brokers, ",")...),
	)
	if err != nil {
		log.Fatalf("Failed to create admin client: %v", err)
	}
	defer adminClient.Close()

	admin := kadm.NewClient(adminClient)
	
	// Create topic if it doesn't exist
	if err := createTopic(admin, config); err != nil {
		log.Fatalf("Failed to create topic: %v", err)
	}

	// Initialize metrics
	metrics := &Metrics{
		startTime:     time.Now(),
		lastPrintTime: time.Now(),
	}

	// Setup signal handling
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// Start producers and consumers
	var wg sync.WaitGroup
	
	// Start consumers first
	for i := 0; i < config.consumers; i++ {
		wg.Add(1)
		go runConsumer(ctx, &wg, config, metrics, i)
	}

	// Give consumers time to start
	time.Sleep(2 * time.Second)

	// Start producers
	for i := 0; i < config.producers; i++ {
		wg.Add(1)
		go runProducer(ctx, &wg, config, metrics, i)
	}

	// Start metrics reporter
	wg.Add(1)
	go metricsReporter(ctx, &wg, config, metrics)

	// Wait for specified duration or signal
	select {
	case <-ctx.Done():
		log.Println("Received signal, shutting down...")
	case <-time.After(config.duration):
		log.Println("Duration completed, shutting down...")
		cancel()
	}

	// Wait for all goroutines to finish
	wg.Wait()

	// Print final results
	printFinalResults(config, metrics)
}

func parseFlags() *Config {
	config := &Config{}
	
	flag.StringVar(&config.brokers, "brokers", getEnvOrDefault("REDPANDA_BROKERS", "localhost:9092"), "Comma-separated list of broker addresses")
	flag.StringVar(&config.topic, "topic", "load-test-topic", "Topic name for load testing")
	flag.IntVar(&config.producers, "producers", 3, "Number of producer goroutines")
	flag.IntVar(&config.consumers, "consumers", 3, "Number of consumer goroutines")
	flag.IntVar(&config.messageSize, "message-size", 1024, "Message size in bytes")
	flag.DurationVar(&config.duration, "duration", 5*time.Minute, "Test duration")
	flag.IntVar(&config.batchSize, "batch-size", 100, "Producer batch size")
	flag.StringVar(&config.compression, "compression", "snappy", "Compression type (none, gzip, snappy, lz4, zstd)")
	flag.IntVar(&config.partitions, "partitions", 12, "Number of topic partitions")
	flag.IntVar(&config.replication, "replication", 3, "Replication factor")
	flag.DurationVar(&config.printInterval, "print-interval", 10*time.Second, "Metrics print interval")
	
	flag.Parse()
	return config
}

func getEnvOrDefault(envVar, defaultValue string) string {
	if value := os.Getenv(envVar); value != "" {
		return value
	}
	return defaultValue
}

func createTopic(admin *kadm.Client, config *Config) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Check if topic exists
	topics, err := admin.ListTopics(ctx)
	if err != nil {
		return fmt.Errorf("failed to list topics: %w", err)
	}

	if _, exists := topics[config.topic]; exists {
		log.Printf("Topic %s already exists", config.topic)
		return nil
	}

	// Create topic
	results, err := admin.CreateTopics(ctx, int32(config.partitions), int16(config.replication), map[string]*string{
		"cleanup.policy": stringPtr("delete"),
		"retention.ms":   stringPtr("604800000"), // 7 days
	}, config.topic)
	if err != nil {
		return fmt.Errorf("failed to create topic: %w", err)
	}

	if result, ok := results[config.topic]; ok {
		if result.Err != nil {
			return fmt.Errorf("failed to create topic %s: %w", config.topic, result.Err)
		}
	}

	log.Printf("Created topic %s with %d partitions and replication factor %d", 
		config.topic, config.partitions, config.replication)
	return nil
}

func runProducer(ctx context.Context, wg *sync.WaitGroup, config *Config, metrics *Metrics, id int) {
	defer wg.Done()

	// Configure compression
	var compression kgo.CompressionCodec
	switch strings.ToLower(config.compression) {
	case "gzip":
		compression = kgo.GzipCompression()
	case "snappy":
		compression = kgo.SnappyCompression()
	case "lz4":
		compression = kgo.Lz4Compression()
	case "zstd":
		compression = kgo.ZstdCompression()
	default:
		compression = kgo.NoCompression()
	}

	client, err := kgo.NewClient(
		kgo.SeedBrokers(strings.Split(config.brokers, ",")...),
		kgo.DefaultProduceTopic(config.topic),
		kgo.ProducerBatchMaxBytes(int32(config.batchSize*config.messageSize)),
		kgo.ProducerBatchCompression(compression),
		kgo.RequiredAcks(kgo.AllISRAcks()),
		kgo.DisableIdempotentWrite(), // For maximum throughput
	)
	if err != nil {
		log.Printf("Producer %d failed to create client: %v", id, err)
		return
	}
	defer client.Close()

	// Generate message payload
	payload := make([]byte, config.messageSize)
	if _, err := rand.Read(payload); err != nil {
		log.Printf("Producer %d failed to generate payload: %v", id, err)
		return
	}

	log.Printf("Producer %d started", id)

	for {
		select {
		case <-ctx.Done():
			log.Printf("Producer %d shutting down", id)
			return
		default:
			record := &kgo.Record{
				Topic: config.topic,
				Value: payload,
				Headers: []kgo.RecordHeader{
					{Key: "producer-id", Value: []byte(fmt.Sprintf("%d", id))},
					{Key: "timestamp", Value: []byte(fmt.Sprintf("%d", time.Now().UnixNano()))},
				},
			}

			// Produce message
			client.Produce(ctx, record, func(_ *kgo.Record, err error) {
				if err != nil {
					atomic.AddInt64(&metrics.errors, 1)
					log.Printf("Producer %d error: %v", id, err)
				} else {
					atomic.AddInt64(&metrics.messagesSent, 1)
					atomic.AddInt64(&metrics.bytesSent, int64(config.messageSize))
				}
			})
		}
	}
}

func runConsumer(ctx context.Context, wg *sync.WaitGroup, config *Config, metrics *Metrics, id int) {
	defer wg.Done()

	client, err := kgo.NewClient(
		kgo.SeedBrokers(strings.Split(config.brokers, ",")...),
		kgo.ConsumeTopics(config.topic),
		kgo.ConsumerGroup(fmt.Sprintf("load-test-group-%d", id)),
		kgo.AutoCommitMarks(),
		kgo.FetchMaxBytes(10*1024*1024), // 10MB
		kgo.FetchMinBytes(1024),         // 1KB
		kgo.FetchMaxWait(100*time.Millisecond),
	)
	if err != nil {
		log.Printf("Consumer %d failed to create client: %v", id, err)
		return
	}
	defer client.Close()

	log.Printf("Consumer %d started", id)

	for {
		select {
		case <-ctx.Done():
			log.Printf("Consumer %d shutting down", id)
			return
		default:
			fetches := client.PollFetches(ctx)
			if errs := fetches.Errors(); len(errs) > 0 {
				for _, err := range errs {
					log.Printf("Consumer %d error: %v", id, err)
					atomic.AddInt64(&metrics.errors, 1)
				}
			}

			fetches.EachPartition(func(p kgo.FetchTopicPartition) {
				for _, record := range p.Records {
					atomic.AddInt64(&metrics.messagesReceived, 1)
					atomic.AddInt64(&metrics.bytesReceived, int64(len(record.Value)))

					// Optional: Process headers to calculate latency
					for _, header := range record.Headers {
						if string(header.Key) == "timestamp" {
							if sendTime, err := time.Parse("", string(header.Value)); err == nil {
								_ = time.Since(sendTime) // Could track latency here
							}
						}
					}
				}
			})
		}
	}
}

func metricsReporter(ctx context.Context, wg *sync.WaitGroup, config *Config, metrics *Metrics) {
	defer wg.Done()

	ticker := time.NewTicker(config.printInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			printMetrics(config, metrics)
		}
	}
}

func printMetrics(config *Config, metrics *Metrics) {
	now := time.Now()
	elapsed := now.Sub(metrics.startTime)
	intervalElapsed := now.Sub(metrics.lastPrintTime)

	sent := atomic.LoadInt64(&metrics.messagesSent)
	received := atomic.LoadInt64(&metrics.messagesReceived)
	bytesSent := atomic.LoadInt64(&metrics.bytesSent)
	bytesReceived := atomic.LoadInt64(&metrics.bytesReceived)
	errors := atomic.LoadInt64(&metrics.errors)

	// Calculate rates
	sentRate := float64(sent-metrics.lastSent) / intervalElapsed.Seconds()
	receivedRate := float64(received-metrics.lastReceived) / intervalElapsed.Seconds()
	avgSentRate := float64(sent) / elapsed.Seconds()
	avgReceivedRate := float64(received) / elapsed.Seconds()

	// Calculate throughput in MB/s
	sentThroughput := float64(bytesSent-atomic.LoadInt64(&metrics.bytesSent)) / intervalElapsed.Seconds() / (1024*1024)
	receivedThroughput := float64(bytesReceived) / elapsed.Seconds() / (1024*1024)

	fmt.Printf("\n=== Load Test Metrics (Elapsed: %v) ===\n", elapsed.Truncate(time.Second))
	fmt.Printf("Messages: Sent=%d, Received=%d, Errors=%d\n", sent, received, errors)
	fmt.Printf("Current Rate: Sent=%.0f/s, Received=%.0f/s\n", sentRate, receivedRate)
	fmt.Printf("Average Rate: Sent=%.0f/s, Received=%.0f/s\n", avgSentRate, avgReceivedRate)
	fmt.Printf("Throughput: Sent=%.2f MB/s, Received=%.2f MB/s\n", sentThroughput, receivedThroughput)
	fmt.Printf("Consumer Lag: %d messages\n", sent-received)

	metrics.lastPrintTime = now
	metrics.lastSent = sent
	metrics.lastReceived = received
}

func printFinalResults(config *Config, metrics *Metrics) {
	elapsed := time.Since(metrics.startTime)
	sent := atomic.LoadInt64(&metrics.messagesSent)
	received := atomic.LoadInt64(&metrics.messagesReceived)
	bytesSent := atomic.LoadInt64(&metrics.bytesSent)
	bytesReceived := atomic.LoadInt64(&metrics.bytesReceived)
	errors := atomic.LoadInt64(&metrics.errors)

	fmt.Printf("\n" + strings.Repeat("=", 60) + "\n")
	fmt.Printf("FINAL LOAD TEST RESULTS\n")
	fmt.Printf(strings.Repeat("=", 60) + "\n")
	fmt.Printf("Duration: %v\n", elapsed.Truncate(time.Second))
	fmt.Printf("Configuration:\n")
	fmt.Printf("  - Producers: %d, Consumers: %d\n", config.producers, config.consumers)
	fmt.Printf("  - Message Size: %d bytes\n", config.messageSize)
	fmt.Printf("  - Compression: %s\n", config.compression)
	fmt.Printf("  - Topic Partitions: %d\n", config.partitions)
	fmt.Printf("\nResults:\n")
	fmt.Printf("  - Messages Sent: %d\n", sent)
	fmt.Printf("  - Messages Received: %d\n", received)
	fmt.Printf("  - Message Loss: %d (%.2f%%)\n", sent-received, float64(sent-received)/float64(sent)*100)
	fmt.Printf("  - Errors: %d\n", errors)
	fmt.Printf("  - Data Sent: %.2f MB\n", float64(bytesSent)/(1024*1024))
	fmt.Printf("  - Data Received: %.2f MB\n", float64(bytesReceived)/(1024*1024))
	fmt.Printf("\nThroughput:\n")
	fmt.Printf("  - Send Rate: %.0f messages/sec\n", float64(sent)/elapsed.Seconds())
	fmt.Printf("  - Receive Rate: %.0f messages/sec\n", float64(received)/elapsed.Seconds())
	fmt.Printf("  - Send Throughput: %.2f MB/sec\n", float64(bytesSent)/elapsed.Seconds()/(1024*1024))
	fmt.Printf("  - Receive Throughput: %.2f MB/sec\n", float64(bytesReceived)/elapsed.Seconds()/(1024*1024))
	fmt.Printf(strings.Repeat("=", 60) + "\n")
}

func stringPtr(s string) *string {
	return &s
} 