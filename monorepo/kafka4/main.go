package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	DefaultBroker       = "localhost:9093"
	DefaultTopicPrefix  = "latency-test"
	DefaultConsumerGroup = "latency-consumer-group"
	DefaultOutputFile   = "latency-records.jsonl"
	DefaultMessageCount = 100
	DefaultInterval     = 1 * time.Second
	DefaultWaitTime     = 5 * time.Second
)

// getDefaultBrokers returns the default broker addresses, checking CDK environment variables first
func getDefaultBrokers() string {
	cdkConfig := LoadCDKConfig()
	
	// Check for CDK environment variable first
	if bootstrapBrokers := cdkConfig.GetBootstrapBrokers(); bootstrapBrokers != "" {
		log.Printf("Using CDK BOOTSTRAP_BROKERS: %s", bootstrapBrokers)
		return bootstrapBrokers
	}
	
	// Fall back to local default
	log.Printf("Using default broker: %s", DefaultBroker)
	return DefaultBroker
}

// parseBrokerList parses a comma-separated string of broker addresses
func parseBrokerList(brokerString string) []string {
	if brokerString == "" {
		return []string{}
	}
	
	brokers := strings.Split(brokerString, ",")
	var cleanBrokers []string
	for _, broker := range brokers {
		if trimmed := strings.TrimSpace(broker); trimmed != "" {
			cleanBrokers = append(cleanBrokers, trimmed)
		}
	}
	return cleanBrokers
}

// logCDKEnvironmentInfo logs relevant CDK environment variables for debugging
func logCDKEnvironmentInfo() {
	cdkConfig := LoadCDKConfig()
	LogCDKConfig(cdkConfig, "Main")
}

func main() {
	// Log CDK environment info for debugging
	logCDKEnvironmentInfo()
	
	defaultBrokers := getDefaultBrokers()
	
	var (
		brokers        = flag.String("brokers", defaultBrokers, "Kafka broker addresses (comma-separated)")
		producerBrokers = flag.String("producer-brokers", "", "Kafka broker addresses for producer (if different from consumer)")
		consumerBrokers = flag.String("consumer-brokers", "", "Kafka broker addresses for consumer (if different from producer)")
		topicPrefix    = flag.String("topic-prefix", DefaultTopicPrefix, "Kafka topic prefix (UUID will be appended)")
		consumerGroup  = flag.String("group", DefaultConsumerGroup, "Consumer group name")
		outputFile     = flag.String("output", DefaultOutputFile, "Output file for latency records (JSONL)")
		messageCount   = flag.Int("count", DefaultMessageCount, "Number of messages to produce")
		interval       = flag.Duration("interval", DefaultInterval, "Interval between messages")
		waitTime       = flag.Duration("wait-time", DefaultWaitTime, "Time to wait for consumer after producer finishes")
		cleanupOld     = flag.Bool("cleanup-old", true, "Cleanup old test topics before starting")
		consumerOnly   = flag.Bool("consumer-only", false, "Run only consumer (use existing topic)")
		producerOnly   = flag.Bool("producer-only", false, "Run only producer (use existing topic)")
		topic          = flag.String("topic", "", "Use specific topic (for consumer-only/producer-only modes)")
	)
	flag.Parse()

	// Validate flags
	if *consumerOnly && *producerOnly {
		log.Fatal("Cannot run both -consumer-only and -producer-only")
	}

	// Determine broker addresses for producer and consumer
	var producerBrokerList, consumerBrokerList []string
	
	// Default broker list - now supports comma-separated brokers
	defaultBrokerList := parseBrokerList(*brokers)
	if len(defaultBrokerList) == 0 {
		log.Fatal("No valid broker addresses found")
	}
	
	// Producer brokers
	if *producerBrokers != "" {
		producerBrokerList = parseBrokerList(*producerBrokers)
	} else {
		producerBrokerList = defaultBrokerList
	}
	
	// Consumer brokers  
	if *consumerBrokers != "" {
		consumerBrokerList = parseBrokerList(*consumerBrokers)
	} else {
		consumerBrokerList = defaultBrokerList
	}

	// Use appropriate broker list for topic management (prefer producer brokers)
	managementBrokerList := producerBrokerList

	// Create context with cancellation
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle interrupt signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM, syscall.SIGQUIT)

	startTime := time.Now()
	var testTopic string
	var topicManager *TopicManager

	// Initialize topic manager
	if !*consumerOnly && !*producerOnly {
		var err error
		topicManager, err = NewTopicManager(managementBrokerList, *topicPrefix)
		if err != nil {
			log.Fatalf("Failed to create topic manager: %v", err)
		}
		defer topicManager.Close()

		// Cleanup old topics if requested
		if *cleanupOld {
			if err := topicManager.CleanupOldTopics(ctx, 10*time.Minute); err != nil {
				log.Printf("[%s] Warning: Failed to cleanup old topics: %v", 
					time.Now().Format(time.RFC3339), err)
			}
		}

		// Create new test topic with multiple partitions for better performance
		testTopic, err = topicManager.CreateTestTopic(ctx, 3, 1) // 3 partitions, 1 replica
		if err != nil {
			log.Fatalf("Failed to create test topic: %v", err)
		}
	} else {
		// Use provided topic for single-mode operations
		if *topic == "" {
			log.Fatal("Must provide -topic when using -consumer-only or -producer-only")
		}
		testTopic = *topic
	}

	log.Printf("Configuration:")
	log.Printf("  Producer Brokers: %v", producerBrokerList)
	log.Printf("  Consumer Brokers: %v", consumerBrokerList)
	log.Printf("  Topic: %s", testTopic)
	log.Printf("  Consumer Group: %s", *consumerGroup)
	log.Printf("  Output File: %s", *outputFile)
	log.Printf("  Message Count: %d", *messageCount)
	log.Printf("  Interval: %v", *interval)
	log.Printf("  Wait Time: %v", *waitTime)

	// Handle shutdown signals
	go func() {
		sig := <-sigChan
		shutdownTime := time.Now()
		log.Printf("[%s] Received signal %v, initiating graceful shutdown...", 
			shutdownTime.Format(time.RFC3339), sig)
		cancel()
		
		// Force exit if graceful shutdown takes too long
		go func() {
			time.Sleep(15 * time.Second)
			forceExitTime := time.Now()
			log.Printf("[%s] Force exit after 15s timeout", forceExitTime.Format(time.RFC3339))
			os.Exit(1)
		}()
	}()

	// Run the test workflow
	if err := runTestWorkflow(ctx, cancel, producerBrokerList, consumerBrokerList, testTopic, *consumerGroup, *outputFile, 
		*messageCount, *interval, *waitTime, *consumerOnly, *producerOnly); err != nil {
		log.Printf("[%s] Test workflow error: %v", time.Now().Format(time.RFC3339), err)
	}

	// Cleanup test topic if we created it
	if topicManager != nil && testTopic != "" && !*consumerOnly && !*producerOnly {
		if err := topicManager.DeleteTopic(ctx, testTopic); err != nil {
			log.Printf("[%s] Warning: Failed to cleanup test topic: %v", 
				time.Now().Format(time.RFC3339), err)
		}
	}
	
	endTime := time.Now()
	duration := endTime.Sub(startTime)
	log.Printf("[%s] Application shutdown complete - Runtime: %v", 
		endTime.Format(time.RFC3339), duration)
}

func runTestWorkflow(ctx context.Context, cancel context.CancelFunc, producerBrokers []string, consumerBrokers []string, topic string, consumerGroup string, 
	outputFile string, messageCount int, interval time.Duration, waitTime time.Duration, 
	consumerOnly bool, producerOnly bool) error {

	var wg sync.WaitGroup
	var consumer *Consumer
	var consumerDone = make(chan struct{})
	var producerDone = make(chan struct{})

	// Start consumer first (unless producer-only)
	if !producerOnly {
		log.Printf("[%s] 🎧 Starting consumer phase...", time.Now().Format(time.RFC3339))
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer close(consumerDone)
			
			var err error
			consumer, err = NewConsumer(consumerBrokers, topic, consumerGroup, outputFile)
			if err != nil {
				log.Printf("[%s] ❌ Failed to create consumer: %v", time.Now().Format(time.RFC3339), err)
				return
			}
			defer consumer.Close()

			if err := consumer.ConsumeMessages(ctx); err != nil {
				if err != context.Canceled {
					log.Printf("[%s] ❌ Consumer error: %v", time.Now().Format(time.RFC3339), err)
				}
			}
		}()
		
		// Give consumer time to start and connect
		log.Printf("[%s] ⏳ Waiting for consumer to initialize (3s)...", time.Now().Format(time.RFC3339))
		for i := 3; i > 0; i-- {
			log.Printf("[%s] ⏱️  Consumer initialization: %ds remaining", time.Now().Format(time.RFC3339), i)
			time.Sleep(1 * time.Second)
		}
		log.Printf("[%s] ✅ Consumer initialization complete", time.Now().Format(time.RFC3339))
	}

	// Start producer (unless consumer-only)
	if !consumerOnly {
		log.Printf("[%s] 📤 Starting producer phase...", time.Now().Format(time.RFC3339))
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer close(producerDone)
			
			if err := runProducer(ctx, producerBrokers, topic, messageCount, interval); err != nil {
				log.Printf("[%s] ❌ Producer error: %v", time.Now().Format(time.RFC3339), err)
			}
		}()
	}

	// Wait for producer to finish if both are running
	if !consumerOnly && !producerOnly {
		select {
		case <-producerDone:
			log.Printf("[%s] ✅ Producer finished, waiting %v for consumer to process remaining messages...", 
				time.Now().Format(time.RFC3339), waitTime)
			
			// Wait specified time for consumer to finish processing with countdown
			waitStart := time.Now()
			ticker := time.NewTicker(1 * time.Second)
			defer ticker.Stop()
			
			// Create a single timeout timer for the entire wait period
			timeoutTimer := time.NewTimer(waitTime)
			defer timeoutTimer.Stop()
			
			waitLoop:
			for {
				select {
				case <-timeoutTimer.C:
					log.Printf("[%s] ⏰ Wait time expired, stopping consumer", time.Now().Format(time.RFC3339))
					cancel() // Cancel the context to stop the consumer
					break waitLoop
				case <-consumerDone:
					log.Printf("[%s] 🎉 Consumer finished naturally", time.Now().Format(time.RFC3339))
					break waitLoop
				case <-ticker.C:
					elapsed := time.Since(waitStart)
					remaining := waitTime - elapsed
					if remaining > 0 {
						processed := 0
						if consumer != nil {
							processed = consumer.GetRecordCount()
						}
						log.Printf("[%s] ⏳ Waiting for consumer... %v remaining | Processed: %d", 
							time.Now().Format(time.RFC3339), remaining.Truncate(time.Second), processed)
					}
				}
			}
			
		case <-ctx.Done():
			log.Printf("[%s] ⏹️  Context canceled during producer execution", time.Now().Format(time.RFC3339))
		}
	}

	// Wait for all goroutines to complete
	wg.Wait()
	
	// Print final statistics if we have a consumer
	if consumer != nil {
		finalCount := consumer.GetRecordCount()
		log.Printf("[%s] 📊 Final statistics - Messages processed: %d", 
			time.Now().Format(time.RFC3339), finalCount)
	}

	return nil
}

func runProducer(ctx context.Context, brokers []string, topic string, messageCount int, interval time.Duration) error {
	startTime := time.Now()
	log.Printf("[%s] Starting producer...", startTime.Format(time.RFC3339))
	
	producer, err := NewProducer(brokers, topic)
	if err != nil {
		return fmt.Errorf("failed to create producer: %w", err)
	}
	defer func() {
		producer.Close()
		endTime := time.Now()
		duration := endTime.Sub(startTime)
		log.Printf("[%s] Producer closed - Runtime: %v", endTime.Format(time.RFC3339), duration)
	}()

	if err := producer.ProduceMessages(ctx, messageCount, interval); err != nil {
		return fmt.Errorf("failed to produce messages: %w", err)
	}

	finishTime := time.Now()
	log.Printf("[%s] Producer finished successfully", finishTime.Format(time.RFC3339))
	return nil
}

func runConsumer(ctx context.Context, brokers []string, topic string, consumerGroup string, outputFile string) error {
	startTime := time.Now()
	log.Printf("[%s] Starting consumer...", startTime.Format(time.RFC3339))
	
	consumer, err := NewConsumer(brokers, topic, consumerGroup, outputFile)
	if err != nil {
		return fmt.Errorf("failed to create consumer: %w", err)
	}
	defer func() {
		consumer.Close()
		endTime := time.Now()
		duration := endTime.Sub(startTime)
		log.Printf("[%s] Consumer closed - Runtime: %v, Records processed: %d", 
			endTime.Format(time.RFC3339), duration, consumer.GetRecordCount())
	}()

	if err := consumer.ConsumeMessages(ctx); err != nil {
		if err == context.Canceled {
			cancelTime := time.Now()
			log.Printf("[%s] Consumer stopped due to context cancellation", cancelTime.Format(time.RFC3339))
			return nil
		}
		return fmt.Errorf("failed to consume messages: %w", err)
	}

	finishTime := time.Now()
	log.Printf("[%s] Consumer finished successfully", finishTime.Format(time.RFC3339))
	return nil
} 