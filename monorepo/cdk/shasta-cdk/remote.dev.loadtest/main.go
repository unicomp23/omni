package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/kmsg"
)

const (
	testDuration = 20 * time.Minute   // 20 minute test duration
	warmupDuration = 5 * time.Second  // 5 second warm-up phase
	messageInterval = 500 * time.Millisecond // 0.5s spacing = 2 msg/s per producer
	numPartitions = 18
	numProducerGoroutines = 16  // 16 producer goroutines
	producersPerGoroutine = 64  // 64 producers per goroutine
	numProducers = numProducerGoroutines * producersPerGoroutine  // 1,024 total producers
	numConsumers = 8
)

func getBrokers() []string {
	if brokersEnv := os.Getenv("REDPANDA_BROKERS"); brokersEnv != "" {
		return strings.Split(brokersEnv, ",")
	}
	// Fallback to hardcoded brokers
	return []string{"10.1.0.217:9092", "10.1.1.237:9092", "10.1.2.12:9092"}
}

// Buffer pool to reduce GC pressure from message allocations
var messageBufferPool = sync.Pool{
	New: func() interface{} {
		return make([]byte, 8)
	},
}

// LatencyLogEntry represents a single latency measurement in JSONL format
type LatencyLogEntry struct {
	Timestamp    time.Time `json:"timestamp"`    // ISO8601 timestamp when message was received
	SendTime     time.Time `json:"send_time"`    // When message was originally sent
	ReceiveTime  time.Time `json:"receive_time"` // When message was received
	LatencyMs    float64   `json:"latency_ms"`   // Latency in milliseconds
	ConsumerID   int       `json:"consumer_id"`  // Which consumer processed this
	Partition    int32     `json:"partition"`    // Kafka partition
	Offset       int64     `json:"offset"`       // Kafka offset
}

// LatencyLogger handles JSONL logging with 5-minute rotation and compression
type LatencyLogger struct {
	logDir      string
	currentFile *os.File
	currentHour time.Time
	encoder     *json.Encoder
	mutex       sync.Mutex
}

func NewLatencyLogger(logDir string) (*LatencyLogger, error) {
	// Create logging directory
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create log directory: %v", err)
	}
	
	logger := &LatencyLogger{
		logDir: logDir,
	}
	
	// Initialize first log file
	if err := logger.rotateFile(); err != nil {
		return nil, err
	}
	
	return logger, nil
}

func (ll *LatencyLogger) rotateFile() error {
	now := time.Now().UTC()
	// Truncate to 5-minute boundary for testing (instead of hourly)
	minute := (now.Minute() / 5) * 5  // Round down to nearest 5-minute mark
	currentPeriod := time.Date(now.Year(), now.Month(), now.Day(), now.Hour(), minute, 0, 0, time.UTC)
	
	// Check if we need to rotate
	if ll.currentFile != nil && ll.currentHour.Equal(currentPeriod) {
		return nil // No rotation needed
	}
	
	// Close previous file if exists
	var prevFilePath string
	if ll.currentFile != nil {
		prevFilePath = ll.currentFile.Name()
		ll.currentFile.Close()
		
		// Spawn background gzip compression of previous file
		go ll.compressPreviousFile(prevFilePath)
	}
	
	// Create new file with sortable timestamp (5-minute intervals)
	filename := fmt.Sprintf("latency-%s.jsonl", currentPeriod.Format("2006-01-02T15-04-05Z"))
	filepath := filepath.Join(ll.logDir, filename)
	
	file, err := os.OpenFile(filepath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return fmt.Errorf("failed to create log file %s: %v", filepath, err)
	}
	
	ll.currentFile = file
	ll.currentHour = currentPeriod  // Still using this field name but now it's 5-minute periods
	ll.encoder = json.NewEncoder(file)
	
	timestampedPrintf("📝 Started new latency log (5-min rotation): %s\n", filename)
	return nil
}

func (ll *LatencyLogger) compressPreviousFile(filePath string) {
	timestampedPrintf("🗜️  Compressing previous log file: %s\n", filepath.Base(filePath))
	
	// Use gzip command for better performance than Go's gzip
	cmd := exec.Command("gzip", filePath)
	if err := cmd.Run(); err != nil {
		timestampedLogf("❌ Failed to gzip %s: %v", filePath, err)
		return
	}
	
	timestampedPrintf("✅ Compressed: %s.gz\n", filepath.Base(filePath))
}

func (ll *LatencyLogger) LogLatency(entry LatencyLogEntry) error {
	ll.mutex.Lock()
	defer ll.mutex.Unlock()
	
	// Check if we need to rotate to new hour
	if err := ll.rotateFile(); err != nil {
		return err
	}
	
	// Write JSONL entry
	return ll.encoder.Encode(entry)
}

func (ll *LatencyLogger) Close() error {
	ll.mutex.Lock()
	defer ll.mutex.Unlock()
	
	if ll.currentFile != nil {
		prevFilePath := ll.currentFile.Name()
		ll.currentFile.Close()
		
		// Compress final file
		go ll.compressPreviousFile(prevFilePath)
	}
	
	return nil
}

type LatencyStats struct {
	addCh     chan time.Duration
	calcCh    chan chan map[string]time.Duration
	closeCh   chan struct{}
}

func NewLatencyStats() *LatencyStats {
	ls := &LatencyStats{
		addCh:   make(chan time.Duration, 1000), // Buffered to avoid blocking producers
		calcCh:  make(chan chan map[string]time.Duration),
		closeCh: make(chan struct{}),
	}
	
	// Start the goroutine that manages the latencies slice
	go ls.run()
	
	return ls
}

func (ls *LatencyStats) run() {
	var latencies []time.Duration
	
	for {
		select {
		case latency := <-ls.addCh:
			latencies = append(latencies, latency)
			
		case responseCh := <-ls.calcCh:
			// Calculate stats and send back result
			result := ls.calculateStats(latencies)
			responseCh <- result
			
		case <-ls.closeCh:
			return
		}
	}
}

func (ls *LatencyStats) Add(latency time.Duration) {
	select {
	case ls.addCh <- latency:
		// Successfully added
	default:
		// Channel full, could log this or use different strategy
		// For now, just drop the measurement to avoid blocking
	}
}

func (ls *LatencyStats) Calculate() map[string]time.Duration {
	responseCh := make(chan map[string]time.Duration)
	ls.calcCh <- responseCh
	return <-responseCh
}

func (ls *LatencyStats) Close() {
	close(ls.closeCh)
}

func (ls *LatencyStats) calculateStats(latencies []time.Duration) map[string]time.Duration {
	if len(latencies) == 0 {
		return map[string]time.Duration{}
	}
	
	// Create a copy to avoid modifying the original slice during sorting
	latenciesCopy := make([]time.Duration, len(latencies))
	copy(latenciesCopy, latencies)
	
	sort.Slice(latenciesCopy, func(i, j int) bool {
		return latenciesCopy[i] < latenciesCopy[j]
	})
	
	count := len(latenciesCopy)
	results := make(map[string]time.Duration)
	
	results["count"] = time.Duration(count)
	results["min"] = latenciesCopy[0]
	results["max"] = latenciesCopy[count-1]
	results["p50"] = latenciesCopy[count*50/100]
	results["p90"] = latenciesCopy[count*90/100]
	results["p95"] = latenciesCopy[count*95/100]
	results["p99"] = latenciesCopy[count*99/100]
	
	if count >= 100 {
		results["p99.9"] = latenciesCopy[count*999/1000]
	}
	if count >= 1000 {
		results["p99.99"] = latenciesCopy[count*9999/10000]
	}
	if count >= 10000 {
		results["p99.999"] = latenciesCopy[count*99999/100000]
	}
	
	var sum time.Duration
	for _, latency := range latenciesCopy {
		sum += latency
	}
	results["avg"] = sum / time.Duration(count)
	
	return results
}

func createMessage(sendTime time.Time) []byte {
	// Get pre-allocated buffer from pool to reduce GC pressure
	msg := messageBufferPool.Get().([]byte)
	// Ensure buffer is the right size (should always be 8 from pool)
	if len(msg) != 8 {
		msg = make([]byte, 8)
	}
	// Write timestamp to buffer
	binary.BigEndian.PutUint64(msg, uint64(sendTime.UnixNano()))
	return msg
}

func releaseMessageBuffer(msg []byte) {
	// Return buffer to pool for reuse (only if it's the right size)
	if len(msg) == 8 {
		messageBufferPool.Put(msg)
	}
}

func extractTimestampFromMessage(data []byte) time.Time {
	if len(data) < 8 {
		return time.Time{}
	}
	// Extract timestamp from first 8 bytes (rest is padding)
	nanos := binary.BigEndian.Uint64(data[:8])
	return time.Unix(0, int64(nanos))
}

func createTopic(client *kgo.Client, topicName string) error {
	req := kmsg.NewCreateTopicsRequest()
	reqTopic := kmsg.NewCreateTopicsRequestTopic()
	reqTopic.Topic = topicName
	reqTopic.NumPartitions = numPartitions
	reqTopic.ReplicationFactor = 3  // Match broker count
	req.Topics = append(req.Topics, reqTopic)
	
	_, err := req.RequestWith(context.Background(), client)
	return err
}

func cleanupOldLoadtestTopics(client *kgo.Client) error {
	timestampedPrintf("🧹 Cleaning up old loadtest topics...\n")
	
	// Get list of topics
	metaReq := kmsg.NewMetadataRequest()
	metaResp, err := metaReq.RequestWith(context.Background(), client)
	if err != nil {
		return err
	}
	
	// Find loadtest topics to delete
	var topicsToDelete []string
	for _, topic := range metaResp.Topics {
		if topic.Topic != nil && len(*topic.Topic) > 15 && (*topic.Topic)[:15] == "loadtest-topic-" {
			topicsToDelete = append(topicsToDelete, *topic.Topic)
		}
	}
	
	if len(topicsToDelete) == 0 {
		timestampedPrintf("✅ No old loadtest topics to clean up\n")
		return nil
	}
	
	timestampedPrintf("🗑️  Found %d old loadtest topics to delete\n", len(topicsToDelete))
	
	// Delete topics in batches to avoid overwhelming the cluster
	batchSize := 10
	for i := 0; i < len(topicsToDelete); i += batchSize {
		end := i + batchSize
		if end > len(topicsToDelete) {
			end = len(topicsToDelete)
		}
		
		deleteReq := kmsg.NewDeleteTopicsRequest()
		for _, topicName := range topicsToDelete[i:end] {
			deleteReq.TopicNames = append(deleteReq.TopicNames, topicName)
			timestampedPrintf("  🗑️  Deleting: %s\n", topicName)
		}
		
		_, err := deleteReq.RequestWith(context.Background(), client)
		if err != nil {
			timestampedPrintf("⚠️  Warning: Failed to delete some topics: %v\n", err)
		} else {
			timestampedPrintf("✅ Deleted batch of %d topics\n", end-i)
		}
	}
	
	return nil
}

func producerGoroutine(ctx context.Context, client *kgo.Client, stats *LatencyStats, topicName string, startSignal <-chan struct{}, goroutineID int, isWarmup bool) {
	// Wait for consumers to be ready
	<-startSignal
	
	// Calculate producer ID range for this goroutine
	startProducerID := goroutineID * producersPerGoroutine
	endProducerID := startProducerID + producersPerGoroutine
	
	if isWarmup {
		timestampedPrintf("🔥 Warm-up Producer Goroutine %d started (producers %d-%d)\n", goroutineID, startProducerID, endProducerID-1)
	} else {
		timestampedPrintf("🚀 Producer Goroutine %d started (producers %d-%d, 2 msg/s each)\n", goroutineID, startProducerID, endProducerID-1)
	}
	
	// Track message count per producer (only for this goroutine's producers)
	messageCounts := make([]int, producersPerGoroutine)
	timer := time.NewTimer(messageInterval)
	defer timer.Stop()
	
	for {
		select {
		case <-ctx.Done():
			if isWarmup {
				totalMessages := 0
				for i, count := range messageCounts {
					actualProducerID := startProducerID + i
					timestampedPrintf("🔥 Warm-up Producer %d finished. Sent %d messages\n", actualProducerID, count)
					totalMessages += count
				}
				timestampedPrintf("🔥 Goroutine %d warm-up messages sent: %d\n", goroutineID, totalMessages)
			} else {
				totalMessages := 0
				for i, count := range messageCounts {
					actualProducerID := startProducerID + i
					timestampedPrintf("📤 Producer %d finished. Sent %d messages\n", actualProducerID, count)
					totalMessages += count
				}
				timestampedPrintf("📤 Goroutine %d messages sent: %d\n", goroutineID, totalMessages)
			}
			return
		case <-timer.C:
			// Cycle through this goroutine's producers and send one message for each
			for i := 0; i < producersPerGoroutine; i++ {
				actualProducerID := startProducerID + i
				// ✅ Capture timestamp immediately before each producer send for accurate latency measurement
				sendTime := time.Now()
				message := createMessage(sendTime)
				
				record := &kgo.Record{
					Topic: topicName,
					Value: message,
				}
				
				// Capture actualProducerID for the callback
				currentProducerID := actualProducerID
				client.Produce(ctx, record, func(record *kgo.Record, err error) {
					if err != nil && err.Error() != "context deadline exceeded" {
						timestampedLogf("❌ Producer %d error: %v", currentProducerID, err)
					}
					// Return buffer to pool after message is sent
					releaseMessageBuffer(record.Value)
				})
				
				messageCounts[i]++
			}
			
			// Reset timer for next batch of messages
			timer.Reset(messageInterval)
		}
	}
}

func consumer(ctx context.Context, client *kgo.Client, stats *LatencyStats, logger *LatencyLogger, consumerID int, readySignal chan<- struct{}, isWarmup bool) {
	if isWarmup {
		timestampedPrintf("🔥 Warm-up Consumer %d started\n", consumerID)
	} else {
		timestampedPrintf("🚀 Consumer %d started\n", consumerID)
	}
	
	// Signal that this consumer is ready
	readySignal <- struct{}{}
	
	receivedCount := 0
	
	// Channel for communicating event counts to logging goroutine
	countChan := make(chan int, 100)
	
	// Start logging goroutine that logs every 10k events
	go func() {
		lastLoggedCount := 0
		for {
			select {
			case <-ctx.Done():
				return
			case count := <-countChan:
				if count-lastLoggedCount >= 10000 {
					timestampedPrintf("📊 Consumer %d: Processed %d events (total: %d)\n", consumerID, count-lastLoggedCount, count)
					lastLoggedCount = count
				}
			}
		}
	}()
	
	for {
		select {
		case <-ctx.Done():
			if isWarmup {
				timestampedPrintf("🔥 Warm-up Consumer %d finished. Received %d messages\n", consumerID, receivedCount)
			} else {
				timestampedPrintf("📥 Consumer %d finished. Received %d messages\n", consumerID, receivedCount)
			}
			return
		default:
			fetches := client.PollFetches(ctx)
			if errs := fetches.Errors(); len(errs) > 0 {
				for _, err := range errs {
					if err.Err.Error() != "context deadline exceeded" {
						timestampedLogf("❌ Consumer %d error: %v", consumerID, err)
					}
				}
				continue
			}
			
			fetches.EachPartition(func(p kgo.FetchTopicPartition) {
				for _, record := range p.Records {
					// ✅ Capture receive time immediately for each individual record
					receiveTime := time.Now()
					
					sendTime := extractTimestampFromMessage(record.Value)
					if !sendTime.IsZero() && !isWarmup {
						// Only collect stats during main test, not warm-up
						latency := receiveTime.Sub(sendTime)
						stats.Add(latency)
						
						// Log to JSONL file
						entry := LatencyLogEntry{
							Timestamp:   receiveTime,
							SendTime:    sendTime,
							ReceiveTime: receiveTime,
							LatencyMs:   float64(latency.Nanoseconds()) / 1e6, // Convert to milliseconds
							ConsumerID:  consumerID,
							Partition:   record.Partition,
							Offset:      record.Offset,
						}
						
						if err := logger.LogLatency(entry); err != nil {
							timestampedLogf("❌ Failed to log latency for consumer %d: %v", consumerID, err)
						}
					}
					receivedCount++
					
					// Send count update to logging goroutine every 1000 events to avoid channel flooding
					if receivedCount%1000 == 0 {
						select {
						case countChan <- receivedCount:
						default:
							// Don't block if channel is full
						}
					}
				}
			})
		}
	}
}

func main() {
	// Generate unique topic name
	topicUUID := uuid.New().String()[:8]
	topicName := fmt.Sprintf("loadtest-topic-%s", topicUUID)
	
	timestampedPrintf("🎯 Redpanda Load Test - 16 PRODUCER GOROUTINES, 2 msg/s per producer, ack=1\n")
	timestampedPrintf("🔗 Brokers: %v\n", getBrokers())
	timestampedPrintf("📝 Topic: %s\n", topicName)
	timestampedPrintf("📊 Config: %d partitions, %d producers, %d consumers\n", numPartitions, numProducers, numConsumers)
	timestampedPrintf("📦 Message size: 8 bytes (timestamp only)\n")
	timestampedPrintf("⏱️  Message interval: %v (2 msg/s per producer)\n", messageInterval)
	timestampedPrintf("📋 Logging: JSONL latency logs in ./logs/ (5-min rotation + gzip)\n")
	timestampedPrintf("💻 CPU: %d cores, GOMAXPROCS=%d, %d goroutines total (%d producers + %d consumers)\n\n", runtime.NumCPU(), runtime.GOMAXPROCS(0), numProducerGoroutines + numConsumers, numProducerGoroutines, numConsumers)
	
	stats := NewLatencyStats()
	
	// Create latency logger with 5-minute rotation and compression
	latencyLogger, err := NewLatencyLogger("./logs")
	if err != nil {
		log.Fatalf("❌ Failed to create latency logger: %v", err)
	}
	defer latencyLogger.Close()
	
	// Producer client optimized for ULTRA-LOW latency (<50ms P99.99 goal)
	producerOpts := []kgo.Opt{
		kgo.SeedBrokers(getBrokers()...),
		kgo.RequiredAcks(kgo.LeaderAck()),      // ack=1 (lower latency than ack=all)
		kgo.DisableIdempotentWrite(),           // Allow ack=1, reduce overhead
		
		// Ultra-low latency optimizations
		kgo.ProducerLinger(0),                  // Zero linger = immediate send
		kgo.ProducerBatchMaxBytes(4096),        // Very small batches (4KB)
		kgo.ProducerBatchCompression(kgo.NoCompression()), // No compression for speed
		
		// Aggressive timeouts for speed
		kgo.ConnIdleTimeout(30 * time.Second),
		kgo.RequestTimeoutOverhead(1 * time.Second), // Minimum allowed timeout
		kgo.RetryBackoffFn(func(tries int) time.Duration {
			return time.Millisecond * 10        // Fast retries
		}),
	}
	
	producerClient, err := kgo.NewClient(producerOpts...)
	if err != nil {
		log.Fatalf("❌ Failed to create producer: %v", err)
	}
	defer producerClient.Close()
	
	// Cleanup old loadtest topics before starting
	err = cleanupOldLoadtestTopics(producerClient)
	if err != nil {
		timestampedPrintf("⚠️  Warning: Topic cleanup failed: %v\n", err)
	}
	
	// Brief pause to let deletions process
	if err == nil {
		timestampedPrintf("⏳ Waiting for topic deletions to complete...\n")
		time.Sleep(2 * time.Second)
	}
	
	// Consumer client optimized for ULTRA-LOW latency & improved disconnect detection
	consumerOpts := []kgo.Opt{
		kgo.SeedBrokers(getBrokers()...),
		kgo.ConsumeTopics(topicName),
		kgo.ConsumerGroup(fmt.Sprintf("loadtest-group-%s", topicUUID)),
		kgo.ConsumeResetOffset(kgo.NewOffset().AtEnd()),
		
		// Ultra-low latency fetch optimizations  
		kgo.FetchMinBytes(1),                   // Don't wait for minimum bytes
		kgo.FetchMaxWait(10 * time.Millisecond), // Minimum allowed max wait (10ms)
		kgo.FetchMaxBytes(1024 * 1024),         // Reasonable max fetch (1MB)
		
		// OPTIMAL disconnect detection - 10s session timeout (fastest stable setting)
		kgo.SessionTimeout(10 * time.Second),    // 10s - optimal stable threshold (10x faster than 45s default)
		kgo.HeartbeatInterval(3 * time.Second),  // 3s (~1/3 of 10s)
		kgo.AutoCommitInterval(100 * time.Millisecond), // Minimum allowed commit interval
		
		// Faster connection management for improved reconnection
		kgo.ConnIdleTimeout(20 * time.Second),   // Reduced from 30s
		kgo.RequestTimeoutOverhead(1 * time.Second), // Minimum allowed timeout
		
		// Faster retry backoff for quicker recovery
		kgo.RetryBackoffFn(func(tries int) time.Duration {
			return time.Millisecond * 100 // Reasonable backoff
		}),
		kgo.RetryTimeout(10 * time.Second),
		
		// Improved rebalancing for quicker group recovery
		kgo.RebalanceTimeout(15 * time.Second),
		
		// More frequent metadata refresh
		kgo.MetadataMaxAge(30 * time.Second),
	}
	
	consumerClient, err := kgo.NewClient(consumerOpts...)
	if err != nil {
		log.Fatalf("❌ Failed to create consumer: %v", err)
	}
	defer consumerClient.Close()
	
	// Create topic
	timestampedPrintf("🔧 Creating topic...\n")
	err = createTopic(producerClient, topicName)
	if err != nil {
		timestampedPrintf("⚠️  Topic creation warning: %v\n", err)
	}
	
	// Wait for topic to be ready
	timestampedPrintf("⏳ Waiting for topic to be ready...\n")
	time.Sleep(3 * time.Second)
	
	timestampedPrintf("🔍 Debug: About to start warm-up phase with duration: %v\n", warmupDuration)
	
	// ========================================
	// WARM-UP PHASE
	// ========================================
	timestampedPrintf("🔥 Starting %v warm-up phase...\n\n", warmupDuration)
	
	warmupCtx, warmupCancel := context.WithTimeout(context.Background(), warmupDuration)
	defer warmupCancel()
	
	var warmupWg sync.WaitGroup
	
	// Channels for warm-up coordination
	warmupConsumerReady := make(chan struct{}, numConsumers)
	warmupProducerStart := make(chan struct{})
	
	// Start warm-up consumers
	for i := 0; i < numConsumers; i++ {
		warmupWg.Add(1)
		go func(consumerID int) {
			defer warmupWg.Done()
			consumer(warmupCtx, consumerClient, stats, latencyLogger, consumerID, warmupConsumerReady, true) // true for warmup
		}(i)
	}
	
	// Wait for all warm-up consumers to be ready
	go func() {
		for i := 0; i < numConsumers; i++ {
			<-warmupConsumerReady
		}
		timestampedPrintf("🔥 All %d consumers ready for warm-up, starting %d producer goroutines...\n\n", numConsumers, numProducerGoroutines)
		close(warmupProducerStart)
	}()
	
	// Start multiple warm-up producer goroutines
	for goroutineID := 0; goroutineID < numProducerGoroutines; goroutineID++ {
		warmupWg.Add(1)
		go func(gID int) {
			defer warmupWg.Done()
			producerGoroutine(warmupCtx, producerClient, stats, topicName, warmupProducerStart, gID, true) // true for warmup
		}(goroutineID)
	}
	
	warmupWg.Wait()
	timestampedPrintf("\n🔥 Warm-up completed!\n\n")
	
	// Clean up warm-up stats and create fresh stats for actual test
	stats.Close()
	stats = NewLatencyStats()
	
	// ========================================
	// MAIN LOAD TEST
	// ========================================
	timestampedPrintf("⏱️  Starting %v main load test...\n\n", testDuration)
	
	// Collect GC stats before test
	var gcStatsBefore runtime.MemStats
	runtime.ReadMemStats(&gcStatsBefore)
	
	startTime := time.Now()
	
	ctx, cancel := context.WithTimeout(context.Background(), testDuration)
	defer cancel()
	
	var wg sync.WaitGroup
	
	// Channels for coordination
	consumerReady := make(chan struct{}, numConsumers)
	producerStart := make(chan struct{})
	
	// Start consumers first
	for i := 0; i < numConsumers; i++ {
		wg.Add(1)
		go func(consumerID int) {
			defer wg.Done()
			consumer(ctx, consumerClient, stats, latencyLogger, consumerID, consumerReady, false) // false for main test
		}(i)
	}
	
	// Wait for all consumers to be ready
	go func() {
		for i := 0; i < numConsumers; i++ {
			<-consumerReady
		}
		timestampedPrintf("✅ All %d consumers ready, starting %d producer goroutines...\n\n", numConsumers, numProducerGoroutines)
		close(producerStart)
	}()
	
	// Start multiple producer goroutines
	for goroutineID := 0; goroutineID < numProducerGoroutines; goroutineID++ {
		wg.Add(1)
		go func(gID int) {
			defer wg.Done()
			producerGoroutine(ctx, producerClient, stats, topicName, producerStart, gID, false) // false for main test
		}(goroutineID)
	}
	
	wg.Wait()
	
	actualDuration := time.Since(startTime)
	timestampedPrintf("\n⏱️  Test completed in %v\n\n", actualDuration)
	
	// Collect GC stats after test
	var gcStatsAfter runtime.MemStats
	runtime.ReadMemStats(&gcStatsAfter)
	
	// Display results
	results := stats.Calculate()
	
	timestampedPrintf("📊 LATENCY STATISTICS\n")
	timestampedPrintf("═════════════════════\n")
	
	if count, ok := results["count"]; ok && count > 0 {
		timestampedPrintf("Messages:  %d\n", int(count))
		timestampedPrintf("Min:       %v\n", results["min"])
		timestampedPrintf("Avg:       %v\n", results["avg"])
		timestampedPrintf("P50:       %v\n", results["p50"])
		timestampedPrintf("P90:       %v\n", results["p90"])
		timestampedPrintf("P95:       %v\n", results["p95"])
		timestampedPrintf("P99:       %v\n", results["p99"])
		if p999, exists := results["p99.9"]; exists {
			timestampedPrintf("P99.9:     %v\n", p999)
		}
		if p9999, exists := results["p99.99"]; exists {
			timestampedPrintf("P99.99:    %v\n", p9999)
		}
		if p99999, exists := results["p99.999"]; exists {
			timestampedPrintf("P99.999:   %v\n", p99999)
		}
		timestampedPrintf("Max:       %v\n", results["max"])
		
		throughput := float64(int(count)) / actualDuration.Seconds()
		expectedThroughput := float64(numProducers) * 2.0  // 2 msg/s per producer = 2,048 msg/s total
		dataThroughputKB := (throughput * 8) / 1024 // 8 bytes per message
		timestampedPrintf("\n📈 Throughput: %.2f messages/second\n", throughput)
		timestampedPrintf("📊 Data throughput: %.2f KB/second\n", dataThroughputKB)
		timestampedPrintf("📊 Per-producer: %.2f msg/sec (target: 2.0 msg/sec)\n", throughput/float64(numProducers))
		timestampedPrintf("📊 Per-partition: %.2f msg/sec\n", throughput/float64(numPartitions))
		timestampedPrintf("🎯 Expected total: %.2f msg/sec\n", expectedThroughput)
		
		// Display GC statistics
		gcCollections := gcStatsAfter.NumGC - gcStatsBefore.NumGC
		gcPauseTotal := time.Duration(gcStatsAfter.PauseTotalNs - gcStatsBefore.PauseTotalNs)
		var avgPause time.Duration
		if gcCollections > 0 {
			avgPause = gcPauseTotal / time.Duration(gcCollections)
		}
		timestampedPrintf("\n🗑️  GC STATISTICS\n")
		timestampedPrintf("═══════════════\n")
		timestampedPrintf("Collections: %d\n", gcCollections)
		timestampedPrintf("Total pause: %v\n", gcPauseTotal)
		timestampedPrintf("Avg pause:   %v\n", avgPause)
		timestampedPrintf("Heap size:   %.2f MB\n", float64(gcStatsAfter.HeapInuse)/(1024*1024))
	} else {
		timestampedPrintf("❌ No messages received - check cluster connectivity\n")
	}
	
	timestampedPrintf("\n✅ Load test completed!\n")
	
	// Clean up the stats goroutine
	stats.Close()
}

// timestampedPrintf prints a message with a timestamp prefix
func timestampedPrintf(format string, args ...interface{}) {
	timestamp := time.Now().Format("2006-01-02 15:04:05")
	fmt.Printf("[%s] %s", timestamp, fmt.Sprintf(format, args...))
}

// timestampedLogf logs a message with a timestamp (log.Printf already includes timestamps but this ensures consistency)
func timestampedLogf(format string, args ...interface{}) {
	timestamp := time.Now().Format("2006-01-02 15:04:05")
	log.Printf("[%s] %s", timestamp, fmt.Sprintf(format, args...))
}
