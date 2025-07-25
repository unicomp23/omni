package main

import (
	"context"
	"encoding/binary"
	"fmt"
	"log"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/kmsg"
)

const (
	testDuration = 10 * time.Second
	warmupDuration = 5 * time.Second  // 5 second warm-up phase
	messageInterval = 50 * time.Millisecond // 50ms spacing = 20 msg/s per producer
	numPartitions = 18
	numProducers = 32
	numConsumers = 3
)

var brokers = []string{"10.1.0.217:9092", "10.1.1.237:9092", "10.1.2.12:9092"}

type LatencyStats struct {
	latencies []time.Duration
	mu        sync.Mutex
}

func (ls *LatencyStats) Add(latency time.Duration) {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	ls.latencies = append(ls.latencies, latency)
}

func (ls *LatencyStats) Calculate() map[string]time.Duration {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	
	if len(ls.latencies) == 0 {
		return map[string]time.Duration{}
	}
	
	sort.Slice(ls.latencies, func(i, j int) bool {
		return ls.latencies[i] < ls.latencies[j]
	})
	
	count := len(ls.latencies)
	results := make(map[string]time.Duration)
	
	results["count"] = time.Duration(count)
	results["min"] = ls.latencies[0]
	results["max"] = ls.latencies[count-1]
	results["p50"] = ls.latencies[count*50/100]
	results["p90"] = ls.latencies[count*90/100]
	results["p95"] = ls.latencies[count*95/100]
	results["p99"] = ls.latencies[count*99/100]
	
	if count >= 100 {
		results["p99.9"] = ls.latencies[count*999/1000]
	}
	if count >= 1000 {
		results["p99.99"] = ls.latencies[count*9999/10000]
	}
	if count >= 10000 {
		results["p99.999"] = ls.latencies[count*99999/100000]
	}
	
	var sum time.Duration
	for _, latency := range ls.latencies {
		sum += latency
	}
	results["avg"] = sum / time.Duration(count)
	
	return results
}

func createMessage(sendTime time.Time) []byte {
	msg := make([]byte, 8)
	binary.BigEndian.PutUint64(msg, uint64(sendTime.UnixNano()))
	return msg
}

func extractTimestampFromMessage(data []byte) time.Time {
	if len(data) < 8 {
		return time.Time{}
	}
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

func producer(ctx context.Context, client *kgo.Client, stats *LatencyStats, producerID int, topicName string, startSignal <-chan struct{}, isWarmup bool) {
	// Wait for consumers to be ready
	<-startSignal
	
	if isWarmup {
		fmt.Printf("🔥 Warm-up Producer %d started\n", producerID)
	} else {
		fmt.Printf("🚀 Producer %d started (31.25 msg/s)\n", producerID)
	}
	
	messageCount := 0
	timer := time.NewTimer(messageInterval)
	defer timer.Stop()
	
	for {
		select {
		case <-ctx.Done():
			if isWarmup {
				fmt.Printf("🔥 Warm-up Producer %d finished. Sent %d messages\n", producerID, messageCount)
			} else {
				fmt.Printf("📤 Producer %d finished. Sent %d messages\n", producerID, messageCount)
			}
			return
		case <-timer.C:
			sendTime := time.Now()
			message := createMessage(sendTime)
			
			record := &kgo.Record{
				Topic: topicName,
				Value: message,
			}
			
			client.Produce(ctx, record, func(record *kgo.Record, err error) {
				if err != nil && err.Error() != "context deadline exceeded" {
					log.Printf("❌ Producer %d error: %v", producerID, err)
				}
			})
			
			messageCount++
			
			// Reset timer for next message (channel-based sleep)
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
	
	fmt.Printf("🎯 Redpanda Load Test - 10s Duration, 31.25 msg/s per producer, ack=1\n")
	fmt.Printf("🔗 Brokers: %v\n", brokers)
	fmt.Printf("📝 Topic: %s\n", topicName)
	fmt.Printf("📊 Config: %d partitions, %d producers, %d consumers\n", numPartitions, numProducers, numConsumers)
	fmt.Printf("⏱️  Message interval: %v (31.25 msg/s per producer)\n\n", messageInterval)
	
	stats := &LatencyStats{}
	
	// Producer client with ack=1, optimized for latency
	producerOpts := []kgo.Opt{
		kgo.SeedBrokers(brokers...),
		kgo.RequiredAcks(kgo.LeaderAck()),      // ack=1
		kgo.DisableIdempotentWrite(),           // Allow ack=1
		kgo.ProducerLinger(0),                  // No linger time
	}
	
	producerClient, err := kgo.NewClient(producerOpts...)
	if err != nil {
		log.Fatalf("❌ Failed to create producer: %v", err)
	}
	defer producerClient.Close()
	
	// Consumer client
	consumerOpts := []kgo.Opt{
		kgo.SeedBrokers(brokers...),
		kgo.ConsumeTopics(topicName),
		kgo.ConsumerGroup(fmt.Sprintf("loadtest-group-%s", topicUUID)),
		kgo.ConsumeResetOffset(kgo.NewOffset().AtEnd()),
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
	
	// Start warm-up producers
	for i := 0; i < numProducers; i++ {
		warmupWg.Add(1)
		go func(producerID int) {
			defer warmupWg.Done()
			producer(warmupCtx, producerClient, stats, producerID, topicName, warmupProducerStart, true) // true for warmup
		}(i)
	}
	
	warmupWg.Wait()
	fmt.Printf("\n🔥 Warm-up completed!\n\n")
	
	// Clear stats from warm-up (fresh start for actual test)
	stats = &LatencyStats{}
	
	// ========================================
	// MAIN LOAD TEST
	// ========================================
	fmt.Printf("⏱️  Starting %v main load test...\n\n", testDuration)
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
	
	// Start producers
	for i := 0; i < numProducers; i++ {
		wg.Add(1)
		go func(producerID int) {
			defer wg.Done()
			producer(ctx, producerClient, stats, producerID, topicName, producerStart, false) // false for main test
		}(i)
	}
	
	wg.Wait()
	
	actualDuration := time.Since(startTime)
	fmt.Printf("\n⏱️  Test completed in %v\n\n", actualDuration)
	
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
		expectedThroughput := float64(numProducers) * 31.25
		fmt.Printf("\n📈 Throughput: %.2f messages/second\n", throughput)
		fmt.Printf("📊 Per-producer: %.2f msg/sec (target: 31.25 msg/sec)\n", throughput/float64(numProducers))
		fmt.Printf("📊 Per-partition: %.2f msg/sec\n", throughput/float64(numPartitions))
		fmt.Printf("🎯 Expected total: %.2f msg/sec\n", expectedThroughput)
	} else {
		fmt.Println("❌ No messages received - check cluster connectivity")
	}
	
	fmt.Println("\n✅ Load test completed!")
}
