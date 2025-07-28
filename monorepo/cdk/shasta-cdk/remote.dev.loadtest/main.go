package main

import (
	"context"
	"encoding/binary"
	"fmt"
	"log"
	"os"
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
	testDuration = 15 * time.Second
	warmupDuration = 5 * time.Second  // 5 second warm-up phase
	messageInterval = 500 * time.Millisecond // 0.5s spacing = 2 msg/s per producer
	numPartitions = 18
	numProducers = 64
	numConsumers = 8
	numProducerGoroutines = 8  // 8 producer goroutines
	producersPerGoroutine = numProducers / numProducerGoroutines  // 8 producers per goroutine
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
	fmt.Println("🧹 Cleaning up old loadtest topics...")
	
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
		fmt.Println("✅ No old loadtest topics to clean up")
		return nil
	}
	
	fmt.Printf("🗑️  Found %d old loadtest topics to delete\n", len(topicsToDelete))
	
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
			fmt.Printf("  🗑️  Deleting: %s\n", topicName)
		}
		
		_, err := deleteReq.RequestWith(context.Background(), client)
		if err != nil {
			fmt.Printf("⚠️  Warning: Failed to delete some topics: %v\n", err)
		} else {
			fmt.Printf("✅ Deleted batch of %d topics\n", end-i)
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
		fmt.Printf("🔥 Warm-up Producer Goroutine %d started (producers %d-%d)\n", goroutineID, startProducerID, endProducerID-1)
	} else {
		fmt.Printf("🚀 Producer Goroutine %d started (producers %d-%d, 2 msg/s each)\n", goroutineID, startProducerID, endProducerID-1)
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
					fmt.Printf("🔥 Warm-up Producer %d finished. Sent %d messages\n", actualProducerID, count)
					totalMessages += count
				}
				fmt.Printf("🔥 Goroutine %d warm-up messages sent: %d\n", goroutineID, totalMessages)
			} else {
				totalMessages := 0
				for i, count := range messageCounts {
					actualProducerID := startProducerID + i
					fmt.Printf("📤 Producer %d finished. Sent %d messages\n", actualProducerID, count)
					totalMessages += count
				}
				fmt.Printf("📤 Goroutine %d messages sent: %d\n", goroutineID, totalMessages)
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
						log.Printf("❌ Producer %d error: %v", currentProducerID, err)
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

func consumer(ctx context.Context, client *kgo.Client, stats *LatencyStats, consumerID int, readySignal chan<- struct{}, isWarmup bool) {
	if isWarmup {
		fmt.Printf("🔥 Warm-up Consumer %d started\n", consumerID)
	} else {
		fmt.Printf("�� Consumer %d started\n", consumerID)
	}
	
	// Signal that this consumer is ready
	readySignal <- struct{}{}
	
	receivedCount := 0
	
	for {
		select {
		case <-ctx.Done():
			if isWarmup {
				fmt.Printf("🔥 Warm-up Consumer %d finished. Received %d messages\n", consumerID, receivedCount)
			} else {
				fmt.Printf("📥 Consumer %d finished. Received %d messages\n", consumerID, receivedCount)
			}
			return
		default:
			fetches := client.PollFetches(ctx)
			if errs := fetches.Errors(); len(errs) > 0 {
				for _, err := range errs {
					if err.Err.Error() != "context deadline exceeded" {
						log.Printf("❌ Consumer %d error: %v", consumerID, err)
					}
				}
				continue
			}
			
			receiveTime := time.Now()
			
			fetches.EachPartition(func(p kgo.FetchTopicPartition) {
				for _, record := range p.Records {
					sendTime := extractTimestampFromMessage(record.Value)
					if !sendTime.IsZero() && !isWarmup {
						// Only collect stats during main test, not warm-up
						latency := receiveTime.Sub(sendTime)
						stats.Add(latency)
					}
					receivedCount++
				}
			})
		}
	}
}

func main() {
	// Generate unique topic name
	topicUUID := uuid.New().String()[:8]
	topicName := fmt.Sprintf("loadtest-topic-%s", topicUUID)
	
	fmt.Printf("🎯 Redpanda Load Test - 8 PRODUCER GOROUTINES, 2 msg/s per producer, ack=1\n")
	fmt.Printf("🔗 Brokers: %v\n", getBrokers())
	fmt.Printf("📝 Topic: %s\n", topicName)
	fmt.Printf("📊 Config: %d partitions, %d producers, %d consumers\n", numPartitions, numProducers, numConsumers)
	fmt.Printf("📦 Message size: 8 bytes (timestamp only)\n")
	fmt.Printf("⏱️  Message interval: %v (2 msg/s per producer)\n", messageInterval)
	fmt.Printf("💻 CPU: %d cores, GOMAXPROCS=%d, %d goroutines total (%d producers + %d consumers)\n\n", runtime.NumCPU(), runtime.GOMAXPROCS(0), numProducerGoroutines + numConsumers, numProducerGoroutines, numConsumers)
	
	stats := NewLatencyStats()
	
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
		fmt.Printf("⚠️  Warning: Topic cleanup failed: %v\n", err)
	}
	
	// Brief pause to let deletions process
	if err == nil {
		fmt.Println("⏳ Waiting for topic deletions to complete...")
		time.Sleep(2 * time.Second)
	}
	
	// Consumer client optimized for ULTRA-LOW latency
	consumerOpts := []kgo.Opt{
		kgo.SeedBrokers(getBrokers()...),
		kgo.ConsumeTopics(topicName),
		kgo.ConsumerGroup(fmt.Sprintf("loadtest-group-%s", topicUUID)),
		kgo.ConsumeResetOffset(kgo.NewOffset().AtEnd()),
		
		// Ultra-low latency fetch optimizations  
		kgo.FetchMinBytes(1),                   // Don't wait for minimum bytes
		kgo.FetchMaxWait(10 * time.Millisecond), // Minimum allowed max wait (10ms)
		kgo.FetchMaxBytes(1024 * 1024),         // Reasonable max fetch (1MB)
		
		// Aggressive session management
		kgo.SessionTimeout(6 * time.Second),    // Faster failure detection
		kgo.HeartbeatInterval(2 * time.Second), // More frequent heartbeats
		kgo.AutoCommitInterval(100 * time.Millisecond), // Minimum allowed commit interval
		
		// Fast timeouts
		kgo.ConnIdleTimeout(30 * time.Second),
		kgo.RequestTimeoutOverhead(1 * time.Second), // Minimum allowed timeout
	}
	
	consumerClient, err := kgo.NewClient(consumerOpts...)
	if err != nil {
		log.Fatalf("❌ Failed to create consumer: %v", err)
	}
	defer consumerClient.Close()
	
	// Create topic
	fmt.Println("🔧 Creating topic...")
	err = createTopic(producerClient, topicName)
	if err != nil {
		fmt.Printf("⚠️  Topic creation warning: %v\n", err)
	}
	
	// Wait for topic to be ready
	fmt.Println("⏳ Waiting for topic to be ready...")
	time.Sleep(3 * time.Second)
	
	fmt.Printf("🔍 Debug: About to start warm-up phase with duration: %v\n", warmupDuration)
	
	// ========================================
	// WARM-UP PHASE
	// ========================================
	fmt.Printf("🔥 Starting %v warm-up phase...\n\n", warmupDuration)
	
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
			consumer(warmupCtx, consumerClient, stats, consumerID, warmupConsumerReady, true) // true for warmup
		}(i)
	}
	
	// Wait for all warm-up consumers to be ready
	go func() {
		for i := 0; i < numConsumers; i++ {
			<-warmupConsumerReady
		}
		fmt.Printf("🔥 All %d consumers ready for warm-up, starting %d producer goroutines...\n\n", numConsumers, numProducerGoroutines)
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
	fmt.Printf("\n🔥 Warm-up completed!\n\n")
	
	// Clean up warm-up stats and create fresh stats for actual test
	stats.Close()
	stats = NewLatencyStats()
	
	// ========================================
	// MAIN LOAD TEST
	// ========================================
	fmt.Printf("⏱️  Starting %v main load test...\n\n", testDuration)
	
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
			consumer(ctx, consumerClient, stats, consumerID, consumerReady, false) // false for main test
		}(i)
	}
	
	// Wait for all consumers to be ready
	go func() {
		for i := 0; i < numConsumers; i++ {
			<-consumerReady
		}
		fmt.Printf("✅ All %d consumers ready, starting %d producer goroutines...\n\n", numConsumers, numProducerGoroutines)
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
	fmt.Printf("\n⏱️  Test completed in %v\n\n", actualDuration)
	
	// Collect GC stats after test
	var gcStatsAfter runtime.MemStats
	runtime.ReadMemStats(&gcStatsAfter)
	
	// Display results
	results := stats.Calculate()
	
	fmt.Println("📊 LATENCY STATISTICS")
	fmt.Println("═════════════════════")
	
	if count, ok := results["count"]; ok && count > 0 {
		fmt.Printf("Messages:  %d\n", int(count))
		fmt.Printf("Min:       %v\n", results["min"])
		fmt.Printf("Avg:       %v\n", results["avg"])
		fmt.Printf("P50:       %v\n", results["p50"])
		fmt.Printf("P90:       %v\n", results["p90"])
		fmt.Printf("P95:       %v\n", results["p95"])
		fmt.Printf("P99:       %v\n", results["p99"])
		if p999, exists := results["p99.9"]; exists {
			fmt.Printf("P99.9:     %v\n", p999)
		}
		if p9999, exists := results["p99.99"]; exists {
			fmt.Printf("P99.99:    %v\n", p9999)
		}
		if p99999, exists := results["p99.999"]; exists {
			fmt.Printf("P99.999:   %v\n", p99999)
		}
		fmt.Printf("Max:       %v\n", results["max"])
		
		throughput := float64(int(count)) / actualDuration.Seconds()
		expectedThroughput := float64(numProducers) * 2.0  // 2 msg/s per producer
		dataThroughputKB := (throughput * 8) / 1024 // 8 bytes per message
		fmt.Printf("\n📈 Throughput: %.2f messages/second\n", throughput)
		fmt.Printf("📊 Data throughput: %.2f KB/second\n", dataThroughputKB)
		fmt.Printf("📊 Per-producer: %.2f msg/sec (target: 2.0 msg/sec)\n", throughput/float64(numProducers))
		fmt.Printf("📊 Per-partition: %.2f msg/sec\n", throughput/float64(numPartitions))
		fmt.Printf("🎯 Expected total: %.2f msg/sec\n", expectedThroughput)
		
		// Display GC statistics
		gcCollections := gcStatsAfter.NumGC - gcStatsBefore.NumGC
		gcPauseTotal := time.Duration(gcStatsAfter.PauseTotalNs - gcStatsBefore.PauseTotalNs)
		var avgPause time.Duration
		if gcCollections > 0 {
			avgPause = gcPauseTotal / time.Duration(gcCollections)
		}
		fmt.Printf("\n🗑️  GC STATISTICS\n")
		fmt.Printf("═══════════════\n")
		fmt.Printf("Collections: %d\n", gcCollections)
		fmt.Printf("Total pause: %v\n", gcPauseTotal)
		fmt.Printf("Avg pause:   %v\n", avgPause)
		fmt.Printf("Heap size:   %.2f MB\n", float64(gcStatsAfter.HeapInuse)/(1024*1024))
	} else {
		fmt.Println("❌ No messages received - check cluster connectivity")
	}
	
	fmt.Println("\n✅ Load test completed!")
	
	// Clean up the stats goroutine
	stats.Close()
}
