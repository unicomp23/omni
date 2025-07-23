package main

import (
	"context"
	"crypto/rand"
	"flag"
	"fmt"
	"log"
	mathrand "math/rand"
	"os"
	"os/signal"
	"runtime"
	"runtime/debug"
	"sort"
	"strconv"
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
	topicPrefix    string
	producers      int
	consumers      int
	messageSize    int
	duration       time.Duration
	batchSize      int
	compression    string
	partitions     int
	replication    int
	printInterval  time.Duration
	cleanupOldTopics bool
	warmupMessages int  // Number of messages to skip for warm-up
	ratePerProducer int // Messages per second per producer (0 = unlimited)
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
	// Latency tracking with channels (no mutex needed!)
	latencyChan      chan time.Duration
	latencies        []time.Duration
	latencyCollectorDone chan struct{}
	// Warm-up tracking
	warmupComplete   int64  // Atomic flag: 0 = warming up, 1 = complete
	messagesProcessed int64 // Total messages processed (for warm-up tracking)
}

func main() {
	// Ultra-low latency GC tuning to minimize tail latency spikes
	debug.SetGCPercent(800)              // Less frequent GC vs default 100
	runtime.GOMAXPROCS(runtime.NumCPU()) // Use all CPU cores  
	runtime.GC()                         // Force GC now before test starts
	
	config := parseFlags()
	
	log.Printf("Starting RedPanda Load Test with franz-go")
	log.Printf("🚀 GC optimized: GOMAXPROCS=%d, GCPercent=800%%", runtime.GOMAXPROCS(0))
	log.Printf("Brokers: %s", config.brokers)
	log.Printf("Topic: %s", config.topic)
	log.Printf("Producers: %d, Consumers: %d", config.producers, config.consumers)
	log.Printf("Message Size: %d bytes", config.messageSize)
	log.Printf("Duration: %v", config.duration)
	log.Printf("Compression: %s", config.compression)
	log.Printf("Rate per Producer: %d messages/second", config.ratePerProducer)
	log.Printf("Warm-up Messages: %d (excluded from latency percentiles)", config.warmupMessages)

	// Create admin client to manage topics
	adminClient, err := kgo.NewClient(
		kgo.SeedBrokers(strings.Split(config.brokers, ",")...),
	)
	if err != nil {
		log.Fatalf("Failed to create admin client: %v", err)
	}
	defer adminClient.Close()

	admin := kadm.NewClient(adminClient)
	
	// Clean up old test topics first
	if config.cleanupOldTopics {
		if err := cleanupOldTopics(admin, config); err != nil {
			log.Printf("Warning: Failed to cleanup old topics: %v", err)
		}
	}
	
	// Create topic if it doesn't exist
	if err := createTopic(admin, config); err != nil {
		log.Fatalf("Failed to create topic: %v", err)
	}

	// Initialize metrics with channels
	metrics := &Metrics{
		startTime:            time.Now(),
		lastPrintTime:        time.Now(),
		latencies:            make([]time.Duration, 0, 500000), // Increased capacity for more samples
		latencyChan:          make(chan time.Duration, 10000),  // Buffered channel for latency measurements
		latencyCollectorDone: make(chan struct{}),
	}

	// Start latency collector goroutine (no mutex needed!)
	go collectLatencies(metrics)

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

	// Start metrics printer
	wg.Add(1)
	go printMetrics(ctx, &wg, config, metrics)

	// Wait for duration or signal
	select {
	case <-ctx.Done():
		log.Printf("Received shutdown signal")
	case <-time.After(config.duration):
		log.Printf("Test duration completed")
		cancel()
	}

	log.Printf("Shutting down...")

	// Wait for all goroutines to finish
	wg.Wait()

	// Close latency channel and wait for collector to finish
	close(metrics.latencyChan)
	<-metrics.latencyCollectorDone

	// Print final results
	printFinalResults(config, metrics)
	
	log.Printf("✅ Load test completed successfully!")
	log.Printf("🗑️  Topic %s will be cleaned up on next run", config.topic)
}

// generateUUID creates a simple UUID-like string for topic naming
func generateUUID() string {
	b := make([]byte, 16)
	_, err := rand.Read(b)
	if err != nil {
		// Fallback to timestamp-based ID
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return fmt.Sprintf("%x-%x-%x-%x-%x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// collectLatencies runs in its own goroutine and collects latency measurements
// from the channel, eliminating the need for mutex synchronization
func collectLatencies(metrics *Metrics) {
	defer close(metrics.latencyCollectorDone)
	
	for latency := range metrics.latencyChan {
		// Only one goroutine modifies the slice - no mutex needed!
		if len(metrics.latencies) < cap(metrics.latencies) {
			metrics.latencies = append(metrics.latencies, latency)
		}
		// If slice is full, we drop additional samples (same behavior as before)
	}
}

func parseFlags() *Config {
	config := &Config{}
	
	// Generate unique topic name with UUID
	uuid := generateUUID()
	defaultTopic := fmt.Sprintf("load-test-%s", uuid)
	
	flag.StringVar(&config.brokers, "brokers", getEnvOrDefault("REDPANDA_BROKERS", "localhost:9092"), "Comma-separated list of broker addresses")
	flag.StringVar(&config.topic, "topic", defaultTopic, "Topic name for load testing (auto-generated with UUID)")
	flag.StringVar(&config.topicPrefix, "topic-prefix", "load-test-", "Prefix for identifying test topics to cleanup")
	flag.IntVar(&config.producers, "producers", 3, "Number of producer goroutines")
	flag.IntVar(&config.consumers, "consumers", 3, "Number of consumer goroutines")
	flag.IntVar(&config.messageSize, "message-size", 1024, "Message size in bytes")
	flag.DurationVar(&config.duration, "duration", 5*time.Minute, "Test duration")
	flag.IntVar(&config.batchSize, "batch-size", 1, "Producer batch size (IGNORED - zero batching for latency)")
	flag.StringVar(&config.compression, "compression", "snappy", "Compression type (none, gzip, snappy, lz4, zstd)")
	flag.IntVar(&config.partitions, "partitions", 12, "Number of topic partitions")
	flag.IntVar(&config.replication, "replication", 3, "Replication factor")
	flag.DurationVar(&config.printInterval, "print-interval", 10*time.Second, "Metrics print interval")
	flag.BoolVar(&config.cleanupOldTopics, "cleanup-old-topics", true, "Clean up old test topics before starting")
	flag.IntVar(&config.warmupMessages, "warmup-messages", 1000, "Number of messages to skip for warm-up (excluded from latency percentiles)")
	flag.IntVar(&config.ratePerProducer, "rate-per-producer", 1000, "Messages per second per producer (0 = unlimited, but not recommended)")
	
	flag.Parse()
	
	log.Printf("🆔 Generated unique topic: %s", config.topic)
	
	return config
}

func getEnvOrDefault(envVar, defaultValue string) string {
	if value := os.Getenv(envVar); value != "" {
		return value
	}
	return defaultValue
}

// cleanupOldTopics removes old load test topics to keep cluster clean
func cleanupOldTopics(admin *kadm.Client, config *Config) error {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	log.Printf("🗑️  Cleaning up old test topics with prefix '%s'...", config.topicPrefix)

	// List all topics
	topics, err := admin.ListTopics(ctx)
	if err != nil {
		return fmt.Errorf("failed to list topics: %w", err)
	}

	// Find topics that match our test prefix and are not the current topic
	var topicsToDelete []string
	for topicName := range topics {
		if strings.HasPrefix(topicName, config.topicPrefix) && topicName != config.topic {
			topicsToDelete = append(topicsToDelete, topicName)
		}
	}

	if len(topicsToDelete) == 0 {
		log.Printf("✅ No old test topics found to cleanup")
		return nil
	}

	log.Printf("🗑️  Found %d old test topics to cleanup: %v", len(topicsToDelete), topicsToDelete)

	// Delete old topics
	results, err := admin.DeleteTopics(ctx, topicsToDelete...)
	if err != nil {
		return fmt.Errorf("failed to delete topics: %w", err)
	}

	// Check results
	deletedCount := 0
	for topicName, result := range results {
		if result.Err != nil {
			log.Printf("⚠️  Failed to delete topic %s: %v", topicName, result.Err)
		} else {
			deletedCount++
			log.Printf("✅ Deleted old topic: %s", topicName)
		}
	}

	log.Printf("🗑️  Cleanup complete: deleted %d/%d topics", deletedCount, len(topicsToDelete))
	
	// Wait a moment for deletions to propagate
	if deletedCount > 0 {
		log.Printf("⏳ Waiting for topic deletions to propagate...")
		time.Sleep(5 * time.Second)
	}

	return nil
}

func createTopic(admin *kadm.Client, config *Config) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	log.Printf("📋 Creating topic: %s", config.topic)

	// Check if topic exists
	topics, err := admin.ListTopics(ctx)
	if err != nil {
		return fmt.Errorf("failed to list topics: %w", err)
	}

	if _, exists := topics[config.topic]; exists {
		log.Printf("✅ Topic %s already exists", config.topic)
		return nil
	}

	// Create topic with optimized settings for load testing
	results, err := admin.CreateTopics(ctx, int32(config.partitions), int16(config.replication), map[string]*string{
		"cleanup.policy":     stringPtr("delete"),
		"retention.ms":       stringPtr("3600000"),    // 1 hour (short retention for test topics)
		"segment.ms":         stringPtr("300000"),     // 5 minutes
		"min.insync.replicas": stringPtr("1"),         // Relaxed for testing
		"unclean.leader.election.enable": stringPtr("false"), // Prevent data loss
	}, config.topic)
	if err != nil {
		return fmt.Errorf("failed to create topic: %w", err)
	}

	if result, ok := results[config.topic]; ok {
		if result.Err != nil {
			return fmt.Errorf("failed to create topic %s: %w", config.topic, result.Err)
		}
	}

	log.Printf("✅ Successfully created topic: %s with %d partitions", config.topic, config.partitions)
	return nil
}

func stringPtr(s string) *string {
	return &s
}

func runProducer(ctx context.Context, wg *sync.WaitGroup, config *Config, metrics *Metrics, id int) {
	defer wg.Done()

	// Force no compression for ultra-low latency (ignore config.compression)
	log.Printf("Producer %d: Using zero compression, zero batching, and immediate flush for absolute minimum latency", id)

	client, err := kgo.NewClient(
		kgo.SeedBrokers(strings.Split(config.brokers, ",")...),
		kgo.DefaultProduceTopic(config.topic),
		
		// ZERO BATCHING with immediate flush for absolute minimum latency
		kgo.ProducerBatchMaxBytes(2048),                   // Minimum size that works (1 message + headers)
		kgo.ProducerLinger(0),                             // Send immediately, no batching delay
		kgo.ProducerBatchCompression(kgo.NoCompression()), // No compression for zero latency
		kgo.RequiredAcks(kgo.AllISRAcks()),
		kgo.DisableIdempotentWrite(),                      // For maximum throughput
		
		// Ultra-fast failure for absolute minimum latency (fail fast vs long waits)
		kgo.ProduceRequestTimeout(100*time.Millisecond),   // 100ms max vs 5s (fail fast for latency)
		kgo.RequestTimeoutOverhead(1*time.Second),         // Minimum allowed vs default 10s  
		kgo.ConnIdleTimeout(30*time.Second),               // Keep connections alive
		kgo.RequestRetries(0),                             // Zero retries - fail immediately
		
		// Connection optimizations
		kgo.ClientID(fmt.Sprintf("ultra-low-latency-producer-%d", id)),
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

	// Rate limiting with jitter to prevent thundering herd and smooth traffic
	var ticker *time.Ticker
	if config.ratePerProducer > 0 {
		interval := time.Second / time.Duration(config.ratePerProducer)
		
		// Add jitter (up to 10% of interval) to prevent thundering herd
		jitterRange := interval / 10
		jitter := time.Duration(mathrand.Int63n(int64(jitterRange)))
		smoothedInterval := interval + jitter
		
		// Also add small initial delay per producer to spread start times
		initialDelay := time.Duration(id) * time.Millisecond * 10
		time.Sleep(initialDelay)
		
		ticker = time.NewTicker(smoothedInterval)
		defer ticker.Stop()
		log.Printf("Producer %d rate limited to %d messages/second (jittered interval: %v)", 
			id, config.ratePerProducer, smoothedInterval)
	} else {
		// Unlimited rate - use small delay to prevent overwhelming
		ticker = time.NewTicker(100 * time.Microsecond)
		defer ticker.Stop()
		log.Printf("Producer %d running at unlimited rate (with 100µs safety delay)", id)
	}

	for {
		select {
		case <-ctx.Done():
			log.Printf("Producer %d shutting down", id)
			return
		case <-ticker.C:
			record := &kgo.Record{
				Topic: config.topic,
				Value: payload,
				Headers: []kgo.RecordHeader{
					{Key: "producer-id", Value: []byte(fmt.Sprintf("%d", id))},
					{Key: "timestamp", Value: []byte(fmt.Sprintf("%d", time.Now().UnixNano()))},
				},
			}

			// Produce message with ZERO batching - flush immediately after each send
			client.Produce(ctx, record, func(_ *kgo.Record, err error) {
				if err != nil {
					atomic.AddInt64(&metrics.errors, 1)
					log.Printf("Producer %d error: %v", id, err)
				} else {
					atomic.AddInt64(&metrics.messagesSent, 1)
					atomic.AddInt64(&metrics.bytesSent, int64(config.messageSize))
				}
			})
			
			// FLUSH IMMEDIATELY after each message for absolute minimum latency
			client.Flush(ctx)
		}
	}
}

func runConsumer(ctx context.Context, wg *sync.WaitGroup, config *Config, metrics *Metrics, id int) {
	defer wg.Done()

	client, err := kgo.NewClient(
		kgo.SeedBrokers(strings.Split(config.brokers, ",")...),
		kgo.ConsumeTopics(config.topic),
		kgo.ConsumerGroup("load-test-group"),                    // Single group for load balancing
		kgo.AutoCommitMarks(),
		
		// MINIMAL BATCHING consumer optimizations (prioritize latency over throughput)
		kgo.FetchMaxBytes(4096),            // Small fetch: 4KB vs 64KB (enough for few messages)
		kgo.FetchMinBytes(1),               // Don't wait for batching
		kgo.FetchMaxWait(10*time.Millisecond), // Minimum allowed vs 100ms
		
		// Consumer timeout optimizations
		kgo.RequestTimeoutOverhead(1*time.Second),         // Minimum allowed
		kgo.ConnIdleTimeout(30*time.Second),
		kgo.RequestRetries(1),              // Fail fast
		
		// Session optimizations for faster rebalancing
		kgo.SessionTimeout(6*time.Second),  // vs default 10s
		kgo.HeartbeatInterval(2*time.Second), // vs default 3s
		
		kgo.ClientID(fmt.Sprintf("ultra-low-latency-consumer-%d", id)),
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

			receiveTime := time.Now()
			fetches.EachPartition(func(p kgo.FetchTopicPartition) {
				for _, record := range p.Records {
					atomic.AddInt64(&metrics.messagesReceived, 1)
					atomic.AddInt64(&metrics.bytesReceived, int64(len(record.Value)))

					// Track total messages processed for warm-up
					processed := atomic.AddInt64(&metrics.messagesProcessed, 1)
					
					// Check if warm-up just completed
					if processed == int64(config.warmupMessages) && atomic.CompareAndSwapInt64(&metrics.warmupComplete, 0, 1) {
						log.Printf("🔥 Warm-up complete! %d messages processed. Now collecting latency data for percentiles.", config.warmupMessages)
					}
					
					// Only collect latency data after warm-up is complete
					isWarmupComplete := atomic.LoadInt64(&metrics.warmupComplete) == 1
					if isWarmupComplete {
						// Calculate latency from timestamp header
						for _, header := range record.Headers {
							if string(header.Key) == "timestamp" {
								if sendTimeNano, err := strconv.ParseInt(string(header.Value), 10, 64); err == nil {
									sendTime := time.Unix(0, sendTimeNano)
									latency := receiveTime.Sub(sendTime)
									
									// Send latency to collector goroutine (no mutex needed!)
									select {
									case metrics.latencyChan <- latency:
										// Successfully sent latency measurement
									default:
										// Channel buffer is full, drop this sample (non-blocking)
									}
								}
								break
							}
						}
					}
				}
			})
		}
	}
}

func printMetrics(ctx context.Context, wg *sync.WaitGroup, config *Config, metrics *Metrics) {
	defer wg.Done()

	ticker := time.NewTicker(config.printInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			printCurrentMetrics(config, metrics)
		}
	}
}

func printCurrentMetrics(config *Config, metrics *Metrics) {
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
	sentThroughput := float64(bytesSent) / elapsed.Seconds() / (1024*1024)
	receivedThroughput := float64(bytesReceived) / elapsed.Seconds() / (1024*1024)

	// Check warm-up status
	processed := atomic.LoadInt64(&metrics.messagesProcessed)
	isWarmupComplete := atomic.LoadInt64(&metrics.warmupComplete) == 1
	
	fmt.Printf("\n=== Load Test Metrics (Elapsed: %v) ===\n", elapsed.Truncate(time.Second))
	fmt.Printf("Topic: %s\n", config.topic)
	fmt.Printf("Messages: Sent=%d, Received=%d, Errors=%d\n", sent, received, errors)
	if !isWarmupComplete {
		fmt.Printf("🔥 Warm-up: %d/%d messages (latency data collection paused)\n", processed, config.warmupMessages)
	} else {
		fmt.Printf("✅ Warm-up: Complete (%d messages excluded from percentiles)\n", config.warmupMessages)
	}
	fmt.Printf("Current Rate: Sent=%.0f/s, Received=%.0f/s\n", sentRate, receivedRate)
	fmt.Printf("Average Rate: Sent=%.0f/s, Received=%.0f/s\n", avgSentRate, avgReceivedRate)
	fmt.Printf("Throughput: Sent=%.2f MB/s, Received=%.2f MB/s\n", sentThroughput, receivedThroughput)
	fmt.Printf("Consumer Lag: %d messages\n", sent-received)

	metrics.lastPrintTime = now
	metrics.lastSent = sent
	metrics.lastReceived = received
}

func calculatePercentiles(latencies []time.Duration) map[string]time.Duration {
	if len(latencies) == 0 {
		return make(map[string]time.Duration)
	}

	// Sort latencies
	sorted := make([]time.Duration, len(latencies))
	copy(sorted, latencies)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i] < sorted[j]
	})

	percentiles := map[string]time.Duration{
		"p50":    getPercentile(sorted, 50.0),
		"p90":    getPercentile(sorted, 90.0),
		"p95":    getPercentile(sorted, 95.0),
		"p99":    getPercentile(sorted, 99.0),
		"p99.9":  getPercentile(sorted, 99.9),
		"p99.99": getPercentile(sorted, 99.99),
		"max":    sorted[len(sorted)-1],
		"min":    sorted[0],
	}

	return percentiles
}

func getPercentile(sorted []time.Duration, percentile float64) time.Duration {
	if len(sorted) == 0 {
		return 0
	}
	
	index := int(float64(len(sorted)) * percentile / 100.0)
	if index >= len(sorted) {
		index = len(sorted) - 1
	}
	if index < 0 {
		index = 0
	}
	
	return sorted[index]
}

func printFinalResults(config *Config, metrics *Metrics) {
	elapsed := time.Since(metrics.startTime)
	sent := atomic.LoadInt64(&metrics.messagesSent)
	received := atomic.LoadInt64(&metrics.messagesReceived)
	bytesSent := atomic.LoadInt64(&metrics.bytesSent)
	bytesReceived := atomic.LoadInt64(&metrics.bytesReceived)
	errors := atomic.LoadInt64(&metrics.errors)

	// Calculate rates
	avgSentRate := float64(sent) / elapsed.Seconds()
	avgReceivedRate := float64(received) / elapsed.Seconds()
	sentThroughput := float64(bytesSent) / elapsed.Seconds() / (1024*1024)
	receivedThroughput := float64(bytesReceived) / elapsed.Seconds() / (1024*1024)

	fmt.Printf("\n" + strings.Repeat("=", 50) + "\n")
	fmt.Printf("📊 FINAL RESULTS\n")
	fmt.Printf(strings.Repeat("=", 50) + "\n")
	fmt.Printf("Duration: %v\n", elapsed.Truncate(time.Millisecond))
	fmt.Printf("Topic: %s\n", config.topic)
	fmt.Printf("Messages: Sent=%d, Received=%d, Errors=%d\n", sent, received, errors)
	fmt.Printf("Overall Rates: %.0f msg/s sent, %.0f msg/s received\n", avgSentRate, avgReceivedRate)
	fmt.Printf("Data Throughput: %.2f MB/s sent, %.2f MB/s received\n", sentThroughput, receivedThroughput)
	fmt.Printf("Final Consumer Lag: %d messages\n", sent-received)

	// Get final latency measurements (no mutex needed - collection is complete)
	latenciesCopy := make([]time.Duration, len(metrics.latencies))
	copy(latenciesCopy, metrics.latencies)

	if len(latenciesCopy) > 0 {
		fmt.Printf("\n🎯 Latency Percentiles (Total samples: %d, %d warm-up messages excluded):\n", len(latenciesCopy), config.warmupMessages)
		percentiles := calculatePercentiles(latenciesCopy)
		
		// Calculate average
		var total time.Duration
		for _, latency := range latenciesCopy {
			total += latency
		}
		average := total / time.Duration(len(latenciesCopy))
		
		fmt.Printf("  - Min:    %v\n", percentiles["min"])
		fmt.Printf("  - p50:    %v\n", percentiles["p50"])
		fmt.Printf("  - p90:    %v\n", percentiles["p90"])
		fmt.Printf("  - p95:    %v\n", percentiles["p95"])
		fmt.Printf("  - p99:    %v\n", percentiles["p99"])
		fmt.Printf("  - p99.9:  %v\n", percentiles["p99.9"])
		fmt.Printf("  - p99.99: %v ⭐\n", percentiles["p99.99"])
		fmt.Printf("  - Max:    %v\n", percentiles["max"])
		fmt.Printf("  - Average: %v\n", average)
		fmt.Printf("\n💡 Note: First %d messages excluded from percentiles (warm-up period)\n", config.warmupMessages)
	} else {
		processed := atomic.LoadInt64(&metrics.messagesProcessed)
		if processed < int64(config.warmupMessages) {
			fmt.Printf("\n⚠️ No latency data collected - test ended during warm-up period (%d/%d messages)\n", processed, config.warmupMessages)
		} else {
			fmt.Printf("\n⚠️ No latency data collected after warm-up period\n")
		}
	}

	fmt.Printf("\n" + strings.Repeat("=", 50) + "\n")
} 