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
	messageInterval = 28 * time.Millisecond // 28ms spacing = 36 msg/s per producer
	numPartitions = 18
	numProducers = 64
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

func allProducersInOneGoroutine(ctx context.Context, client *kgo.Client, stats *LatencyStats, topicName string, startSignal <-chan struct{}, isWarmup bool) {
	// Wait for consumers to be ready
	<-startSignal
	
	if isWarmup {
		fmt.Printf("🔥 All warm-up producers started in single goroutine\n")
	} else {
		fmt.Printf("🚀 All producers started in single goroutine (36 msg/s each)\n")
	}
	
	// Track message count per producer
	messageCounts := make([]int, numProducers)
	timer := time.NewTimer(messageInterval)
	defer timer.Stop()
	
	for {
		select {
		case <-ctx.Done():
			if isWarmup {
				totalMessages := 0
				for i, count := range messageCounts {
					fmt.Printf("🔥 Warm-up Producer %d finished. Sent %d messages\n", i, count)
					totalMessages += count
				}
				fmt.Printf("🔥 Total warm-up messages sent: %d\n", totalMessages)
			} else {
				totalMessages := 0
				for i, count := range messageCounts {
					fmt.Printf("📤 Producer %d finished. Sent %d messages\n", i, count)
					totalMessages += count
				}
				fmt.Printf("📤 Total messages sent: %d\n", totalMessages)
			}
			return
		case <-timer.C:
			// Cycle through all producers and send one message for each
			sendTime := time.Now()
			
			for producerID := 0; producerID < numProducers; producerID++ {
				message := createMessage(sendTime)
				
				record := &kgo.Record{
					Topic: topicName,
					Value: message,
				}
				
				// Capture producerID for the callback
				currentProducerID := producerID
				client.Produce(ctx, record, func(record *kgo.Record, err error) {
					if err != nil && err.Error() != "context deadline exceeded" {
						log.Printf("❌ Producer %d error: %v", currentProducerID, err)
					}
					// Return buffer to pool after message is sent
					releaseMessageBuffer(record.Value)
				})
				
				messageCounts[producerID]++
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
	
	fmt.Printf("🎯 Redpanda Load Test - GC Optimized + Balanced, 36 msg/s per producer, ack=1\n")
	fmt.Printf("🔗 Brokers: %v\n", getBrokers())
	fmt.Printf("📝 Topic: %s\n", topicName)
	fmt.Printf("📊 Config: %d partitions, %d producers, %d consumers\n", numPartitions, numProducers, numConsumers)
	fmt.Printf("📦 Message size: 8 bytes (timestamp only)\n")
	fmt.Printf("⏱️  Message interval: %v (36 msg/s per producer)\n", messageInterval)
	fmt.Printf("💻 CPU: %d cores, GOMAXPROCS=%d, %d goroutines total (1 producer + %d consumers)\n\n", runtime.NumCPU(), runtime.GOMAXPROCS(0), 1 + numConsumers, numConsumers)
	
	stats := NewLatencyStats()
	
	// Producer client optimized for balanced throughput and low latency
	producerOpts := []kgo.Opt{
		kgo.SeedBrokers(getBrokers()...),
		kgo.RequiredAcks(kgo.LeaderAck()),      // ack=1 (better durability vs ack=0)
		kgo.DisableIdempotentWrite(),           // Allow ack=1
		kgo.ProducerLinger(2 * time.Millisecond), // Small batching for efficiency
		kgo.ConnIdleTimeout(10 * time.Second),  // Add connection timeout
		kgo.RequestTimeoutOverhead(5 * time.Second), // Add request timeout
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
	
	// Consumer client
	consumerOpts := []kgo.Opt{
		kgo.SeedBrokers(getBrokers()...),
		kgo.ConsumeTopics(topicName),
		kgo.ConsumerGroup(fmt.Sprintf("loadtest-group-%s", topicUUID)),
		kgo.ConsumeResetOffset(kgo.NewOffset().AtEnd()),
		kgo.ConnIdleTimeout(10 * time.Second),  // Add connection timeout
		kgo.RequestTimeoutOverhead(5 * time.Second), // Add request timeout
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
		fmt.Printf("🔥 All %d consumers ready for warm-up, starting warm-up producers...\n\n", numConsumers)
		close(warmupProducerStart)
	}()
	
	// Start single warm-up producer goroutine managing all producers
	warmupWg.Add(1)
	go func() {
		defer warmupWg.Done()
		allProducersInOneGoroutine(warmupCtx, producerClient, stats, topicName, warmupProducerStart, true) // true for warmup
	}()
	
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
		fmt.Printf("✅ All %d consumers ready, starting producers...\n\n", numConsumers)
		close(producerStart)
	}()
	
	// Start single producer goroutine managing all producers
	wg.Add(1)
	go func() {
		defer wg.Done()
		allProducersInOneGoroutine(ctx, producerClient, stats, topicName, producerStart, false) // false for main test
	}()
	
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
		expectedThroughput := float64(numProducers) * 36.0
		dataThroughputKB := (throughput * 8) / 1024 // 8 bytes per message
		fmt.Printf("\n📈 Throughput: %.2f messages/second\n", throughput)
		fmt.Printf("📊 Data throughput: %.2f KB/second\n", dataThroughputKB)
		fmt.Printf("📊 Per-producer: %.2f msg/sec (target: 36.0 msg/sec)\n", throughput/float64(numProducers))
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
