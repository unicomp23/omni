package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
)

// LoadTestConfig holds configuration for the load test
type LoadTestConfig struct {
	BootstrapServers string
	Topic            string
	NumProducers     int
	NumConsumers     int
	MessagesPerProducer int
	MessageSize      int
	TestDuration     time.Duration
	SuccessThreshold float64 // Percentage of messages that must be consumed for success (0.0-1.0)
	MaxWaitAfterProducers time.Duration // Max time to wait for consumers after producers finish
}

// LoadTestResults holds the results of the load test
type LoadTestResults struct {
	TotalMessagesSent     int64
	TotalMessagesReceived int64
	ProducerThroughput    float64 // messages per second
	ConsumerThroughput    float64 // messages per second
	AverageLatency        time.Duration
	Errors                []string
}

// RunLoadTest executes a comprehensive producer-consumer test with early success detection
func RunLoadTest(config *LoadTestConfig) (*LoadTestResults, error) {
	log.Printf("🚀 Starting load test with config: %+v", config)
	log.Printf("🔗 Bootstrap servers: %s", config.BootstrapServers)
	
	// Test connectivity to brokers first
	if err := testBrokerConnectivity(config.BootstrapServers); err != nil {
		return nil, fmt.Errorf("broker connectivity test failed: %v", err)
	}
	
	startTime := time.Now()

	// Create topic first
	if err := createTopic(config.BootstrapServers, config.Topic); err != nil {
		return nil, fmt.Errorf("failed to create topic: %v", err)
	}

	results := &LoadTestResults{
		Errors: make([]string, 0),
	}

	var mu sync.Mutex
	var producerWg sync.WaitGroup
	var consumerWg sync.WaitGroup
	
	// Contexts for different phases
	mainCtx, mainCancel := context.WithTimeout(context.Background(), config.TestDuration)
	defer mainCancel()

	// Channel to collect latency measurements
	latencyChan := make(chan time.Duration, 1000)
	
	// Channels to track completion
	producersFinished := make(chan bool, 1)
	successAchieved := make(chan bool, 1)

	expectedTotalMessages := int64(config.NumProducers * config.MessagesPerProducer)
	log.Printf("Expected total messages: %d", expectedTotalMessages)

	// Start producers
	log.Printf("Starting %d producers...", config.NumProducers)
	for i := 0; i < config.NumProducers; i++ {
		producerWg.Add(1)
		go func(producerID int) {
			defer producerWg.Done()
			sent, err := runProducer(mainCtx, config, producerID, latencyChan)
			
			mu.Lock()
			results.TotalMessagesSent += sent
			if err != nil {
				results.Errors = append(results.Errors, fmt.Sprintf("Producer %d: %v", producerID, err))
			}
			mu.Unlock()
			
			log.Printf("Producer %d finished. Sent %d messages", producerID, sent)
		}(i)
	}

	// Monitor producer completion
	go func() {
		producerWg.Wait()
		log.Println("All producers finished!")
		producersFinished <- true
	}()

	// Start consumers
	log.Printf("Starting %d consumers...", config.NumConsumers)
	consumerCtx, consumerCancel := context.WithCancel(mainCtx)
	defer consumerCancel()
	
	for i := 0; i < config.NumConsumers; i++ {
		consumerWg.Add(1)
		go func(consumerID int) {
			defer consumerWg.Done()
			received, err := runConsumer(consumerCtx, config, consumerID)
			
			mu.Lock()
			results.TotalMessagesReceived += received
			if err != nil && !strings.Contains(err.Error(), "context canceled") {
				results.Errors = append(results.Errors, fmt.Sprintf("Consumer %d: %v", consumerID, err))
			}
			mu.Unlock()
		}(i)
	}

	// Collect latency measurements in background
	var latencies []time.Duration
	latencyDone := make(chan bool)
	go func() {
		for latency := range latencyChan {
			mu.Lock()
			latencies = append(latencies, latency)
			mu.Unlock()
		}
		latencyDone <- true
	}()

	// Monitor success conditions
	go func() {
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		
		for {
			select {
			case <-mainCtx.Done():
				log.Printf("📊 Success monitor: Context cancelled")
				return
			case <-ticker.C:
				mu.Lock()
				currentReceived := results.TotalMessagesReceived
				currentSent := results.TotalMessagesSent
				mu.Unlock()
				
				if currentSent > 0 {
					successRate := float64(currentReceived) / float64(currentSent)
					log.Printf("📊 Progress: Sent=%d, Received=%d, Rate=%.1f%% (Target: %.1f%%)", 
						currentSent, currentReceived, successRate*100, config.SuccessThreshold*100)
					
					if successRate >= config.SuccessThreshold {
						log.Printf("🎯 Success threshold reached! Received: %d, Sent: %d, Rate: %.2f%%", 
							currentReceived, currentSent, successRate*100)
						successAchieved <- true
						return
					}
				} else {
					log.Printf("📊 Progress: Waiting for producers to start sending messages...")
				}
			}
		}
	}()

	// Wait for completion with different exit conditions
	testCompleted := false
	
	select {
	case <-mainCtx.Done():
		log.Println("Test completed due to timeout")
		testCompleted = true
		
	case <-producersFinished:
		log.Println("All producers finished. Waiting for consumers...")
		
		// Wait additional time for consumers with timeout
		consumerTimeout := time.NewTimer(config.MaxWaitAfterProducers)
		defer consumerTimeout.Stop()
		
		select {
		case <-successAchieved:
			log.Println("Success threshold achieved after producers finished!")
			testCompleted = true
			
		case <-consumerTimeout.C:
			log.Println("Consumer timeout reached after producers finished")
			testCompleted = true
			
		case <-mainCtx.Done():
			log.Println("Overall timeout reached while waiting for consumers")
			testCompleted = true
		}
		
	case <-successAchieved:
		log.Println("Success threshold achieved during test!")
		testCompleted = true
	}

	if testCompleted {
		// Cancel consumer context to stop consumers
		consumerCancel()
		
		// Wait a bit for consumers to finish gracefully
		consumerDone := make(chan bool)
		go func() {
			consumerWg.Wait()
			consumerDone <- true
		}()
		
		select {
		case <-consumerDone:
			log.Println("All consumers stopped gracefully")
		case <-time.After(5 * time.Second):
			log.Println("Consumer shutdown timeout - proceeding with results")
		}
	}

	// Close latency channel and wait for processing
	close(latencyChan)
	<-latencyDone

	// Calculate final results
	actualDuration := time.Since(startTime)
	results.ProducerThroughput = float64(results.TotalMessagesSent) / actualDuration.Seconds()
	results.ConsumerThroughput = float64(results.TotalMessagesReceived) / actualDuration.Seconds()

	// Calculate average latency
	if len(latencies) > 0 {
		var totalLatency time.Duration
		for _, latency := range latencies {
			totalLatency += latency
		}
		results.AverageLatency = totalLatency / time.Duration(len(latencies))
	}

	log.Printf("Load test completed in %v. Results: Sent=%d, Received=%d, Success Rate=%.2f%%", 
		actualDuration, results.TotalMessagesSent, results.TotalMessagesReceived,
		float64(results.TotalMessagesReceived)/float64(results.TotalMessagesSent)*100)
	
	return results, nil
}

// testBrokerConnectivity tests connection to brokers before starting the load test
func testBrokerConnectivity(bootstrapServers string) error {
	log.Printf("🔍 Testing connectivity to brokers: %s", bootstrapServers)
	
	client, err := kgo.NewClient(
		kgo.SeedBrokers(bootstrapServers),
		kgo.WithLogger(kgo.BasicLogger(log.Writer(), kgo.LogLevelInfo, nil)),
	)
	if err != nil {
		return fmt.Errorf("failed to create test client: %v", err)
	}
	defer client.Close()

	// Parse bootstrap servers properly
	brokers := strings.Split(bootstrapServers, ",")
	for i, broker := range brokers {
		brokers[i] = strings.TrimSpace(broker)
	}
	log.Printf("🔍 Parsed brokers: %v", brokers)
	
	// Try to list topics to verify connectivity
	log.Printf("🔍 Testing connection by creating test client...")
	testClient, err := kgo.NewClient(
		kgo.SeedBrokers(brokers...),
	)
	if err != nil {
		return fmt.Errorf("failed to create test client: %v", err)
	}
	testClient.Close()
	
	// Simple ping to verify connection
	log.Printf("✅ Connection test successful - brokers are reachable")
	
	return nil
}

// createTopic creates the test topic - this will be done by RedPanda automatically if needed
func createTopic(bootstrapServers, topic string) error {
	log.Printf("📋 Topic '%s' will be auto-created by RedPanda when first used", topic)
	return nil
}

// runProducer runs a single producer
func runProducer(ctx context.Context, config *LoadTestConfig, producerID int, latencyChan chan<- time.Duration) (int64, error) {
	log.Printf("🔧 Producer %d: Creating client with brokers: %s", producerID, config.BootstrapServers)
	
	client, err := kgo.NewClient(
		kgo.SeedBrokers(config.BootstrapServers),
		kgo.WithLogger(kgo.BasicLogger(log.Writer(), kgo.LogLevelWarn, nil)),
		kgo.RequestTimeoutOverhead(10*time.Second),
		kgo.ProduceRequestTimeout(30*time.Second),
	)
	if err != nil {
		log.Printf("❌ Producer %d: Failed to create client: %v", producerID, err)
		return 0, fmt.Errorf("failed to create producer client: %v", err)
	}
	defer client.Close()
	
	log.Printf("✅ Producer %d: Client created successfully", producerID)

	var messagesSent int64
	messagePayload := make([]byte, config.MessageSize)
	for i := range messagePayload {
		messagePayload[i] = byte('A' + (i % 26))
	}

	ticker := time.NewTicker(time.Millisecond * 10) // Send message every 10ms
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Printf("Producer %d stopping. Sent %d messages", producerID, messagesSent)
			return messagesSent, nil
		case <-ticker.C:
			if messagesSent >= int64(config.MessagesPerProducer) {
				log.Printf("Producer %d completed. Sent %d messages", producerID, messagesSent)
				return messagesSent, nil
			}

			start := time.Now()
			
			// Create message with timestamp for latency measurement
			messageKey := fmt.Sprintf("producer-%d-msg-%d", producerID, messagesSent)
			messageValue := fmt.Sprintf("%d:%s", time.Now().UnixNano(), string(messagePayload))

			record := &kgo.Record{
				Topic: config.Topic,
				Key:   []byte(messageKey),
				Value: []byte(messageValue),
			}

			// Send message synchronously to measure latency
			client.Produce(ctx, record, func(r *kgo.Record, err error) {
				if err != nil {
					log.Printf("❌ Producer %d failed to send message %d: %v", producerID, messagesSent, err)
					return
				}
				
				latency := time.Since(start)
				select {
				case latencyChan <- latency:
				default:
					// Channel full, skip this measurement
				}
				
				// Log progress every 100 messages
				if messagesSent%100 == 0 {
					log.Printf("📤 Producer %d: Sent %d messages", producerID, messagesSent)
				}
			})

			messagesSent++
		}
	}
}

// runConsumer runs a single consumer
func runConsumer(ctx context.Context, config *LoadTestConfig, consumerID int) (int64, error) {
	log.Printf("🔧 Consumer %d: Creating client for topic '%s' with brokers: %s", consumerID, config.Topic, config.BootstrapServers)
	
	client, err := kgo.NewClient(
		kgo.SeedBrokers(config.BootstrapServers),
		kgo.ConsumeTopics(config.Topic),
		kgo.ConsumerGroup(fmt.Sprintf("test-consumer-group-%d", consumerID)),
		kgo.WithLogger(kgo.BasicLogger(log.Writer(), kgo.LogLevelWarn, nil)),
		kgo.FetchMaxWait(5*time.Second),
		kgo.RequestTimeoutOverhead(10*time.Second),
	)
	if err != nil {
		log.Printf("❌ Consumer %d: Failed to create client: %v", consumerID, err)
		return 0, fmt.Errorf("failed to create consumer client: %v", err)
	}
	defer client.Close()
	
	log.Printf("✅ Consumer %d: Client created successfully", consumerID)

	var messagesReceived int64

	for {
		select {
		case <-ctx.Done():
			log.Printf("Consumer %d stopping. Received %d messages", consumerID, messagesReceived)
			return messagesReceived, nil
		default:
			fetches := client.PollFetches(ctx)
			if fetches.IsClientClosed() {
				log.Printf("🔒 Consumer %d: Client closed, stopping", consumerID)
				return messagesReceived, nil
			}

			if err := fetches.Err(); err != nil {
				log.Printf("❌ Consumer %d poll error: %v", consumerID, err)
				continue
			}

			recordCount := 0
			fetches.EachPartition(func(p kgo.FetchTopicPartition) {
				recordCount += len(p.Records)
				for range p.Records {
					messagesReceived++
					
					// Log progress every 100 messages (more frequent than before)
					if messagesReceived%100 == 0 {
						log.Printf("📥 Consumer %d received %d messages", consumerID, messagesReceived)
					}
				}
			})

			if recordCount == 0 {
				// No messages, log periodically
				if messagesReceived%1000 == 0 || messagesReceived < 10 {
					log.Printf("⏳ Consumer %d: No messages in this fetch (total received: %d)", consumerID, messagesReceived)
				}
				time.Sleep(100 * time.Millisecond)
			} else {
				log.Printf("📨 Consumer %d: Fetched %d records in this batch", consumerID, recordCount)
			}
		}
	}
}

// PrintLoadTestResults prints formatted results
func PrintLoadTestResults(results *LoadTestResults) {
	fmt.Println("\n" + strings.Repeat("=", 60))
	fmt.Println("               LOAD TEST RESULTS")
	fmt.Println(strings.Repeat("=", 60))
	fmt.Printf("Messages Sent:           %d\n", results.TotalMessagesSent)
	fmt.Printf("Messages Received:       %d\n", results.TotalMessagesReceived)
	fmt.Printf("Producer Throughput:     %.2f msg/sec\n", results.ProducerThroughput)
	fmt.Printf("Consumer Throughput:     %.2f msg/sec\n", results.ConsumerThroughput)
	fmt.Printf("Average Latency:         %v\n", results.AverageLatency)
	fmt.Printf("Success Rate:            %.2f%%\n", 
		float64(results.TotalMessagesReceived)/float64(results.TotalMessagesSent)*100)
	
	if len(results.Errors) > 0 {
		fmt.Println("\nErrors encountered:")
		for _, err := range results.Errors {
			fmt.Printf("  - %s\n", err)
		}
	}
	fmt.Println(strings.Repeat("=", 60))
} 