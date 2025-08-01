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
	DefaultBroker        = "localhost:9093"
	DefaultTopicPrefix   = "latency-test"
	DefaultConsumerGroup = "latency-consumer-group"
	DefaultOutputFile    = "latency-records.jsonl"
	DefaultMessageCount  = 100
	DefaultInterval      = 1 * time.Second
	DefaultWaitTime      = 5 * time.Second
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
		brokers         = flag.String("brokers", defaultBrokers, "Kafka broker addresses (comma-separated)")
		producerBrokers = flag.String("producer-brokers", "", "Kafka broker addresses for producer (if different from consumer)")
		consumerBrokers = flag.String("consumer-brokers", "", "Kafka broker addresses for consumer (if different from producer)")
		topicPrefix     = flag.String("topic-prefix", DefaultTopicPrefix, "Kafka topic prefix (UUID will be appended)")
		consumerGroup   = flag.String("group", DefaultConsumerGroup, "Consumer group name")
		outputFile      = flag.String("output", DefaultOutputFile, "Output file for latency records (JSONL)")
		messageCount    = flag.Int("count", DefaultMessageCount, "Number of messages to produce")
		interval        = flag.Duration("interval", DefaultInterval, "Interval between messages")
		waitTime        = flag.Duration("wait-time", DefaultWaitTime, "Time to wait for consumer after producer finishes")
		cleanupOld      = flag.Bool("cleanup-old", true, "Cleanup old test topics before starting")
		consumerOnly    = flag.Bool("consumer-only", false, "Run only consumer (use existing topic)")
		producerOnly    = flag.Bool("producer-only", false, "Run only producer (use existing topic)")
		topic           = flag.String("topic", "", "Use specific topic (for consumer-only/producer-only modes)")
		numConsumers    = flag.Int("consumers", 3, "Number of consumer instances to run")
		numProducers    = flag.Int("producers", 1, "Number of producer instances to run")
		optimizeSingle  = flag.Bool("optimize-single", false, "Enable ultra-optimized single consumer mode (forces consumers=1)")
		optimizeLatency = flag.Bool("optimize-latency", false, "Enable ultra-low latency mode for multiple producers")
	)
	flag.Parse()

	// Validate flags
	if *consumerOnly && *producerOnly {
		log.Fatal("Cannot run both -consumer-only and -producer-only")
	}

	// Handle optimize-single flag
	if *optimizeSingle {
		*numConsumers = 1
		log.Printf("⚡ ULTRA-OPTIMIZED SINGLE CONSUMER MODE ENABLED - forcing consumers=1")
	}

	if *numConsumers < 1 {
		log.Fatal("Number of consumers must be at least 1")
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
		testTopic, err = topicManager.CreateTestTopic(ctx, 36, 1) // 36 partitions, 1 replica
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
	log.Printf("  Number of Consumers: %d", *numConsumers)

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
		*messageCount, *interval, *waitTime, *consumerOnly, *producerOnly, *numConsumers, *numProducers, *optimizeSingle, *optimizeLatency); err != nil {
		log.Printf("[%s] Test workflow error: %v", time.Now().Format(time.RFC3339), err)
	}

	// Cleanup test topic if we created it
	if topicManager != nil && testTopic != "" && !*consumerOnly && !*producerOnly {
		log.Printf("[%s] 🧹 Cleaning up test topic...", time.Now().Format(time.RFC3339))

		// Create a separate context for cleanup with generous timeout
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()

		if err := topicManager.DeleteTopic(cleanupCtx, testTopic); err != nil {
			log.Printf("[%s] ⚠️  Warning: Failed to cleanup test topic %s: %v",
				time.Now().Format(time.RFC3339), testTopic, err)
			log.Printf("[%s] 📝 Note: Test topic may remain in cluster for auto-cleanup",
				time.Now().Format(time.RFC3339))
		} else {
			log.Printf("[%s] ✅ Test topic cleanup successful", time.Now().Format(time.RFC3339))
		}
	}

	endTime := time.Now()
	duration := endTime.Sub(startTime)
	log.Printf("[%s] Application shutdown complete - Runtime: %v",
		endTime.Format(time.RFC3339), duration)
}

func runTestWorkflow(ctx context.Context, cancel context.CancelFunc, producerBrokers []string, consumerBrokers []string, topic string, consumerGroup string,
	outputFile string, messageCount int, interval time.Duration, waitTime time.Duration,
	consumerOnly bool, producerOnly bool, numConsumers int, numProducers int, optimizeSingle bool, optimizeLatency bool) error {

	var wg sync.WaitGroup
	var consumerWg sync.WaitGroup
	var consumers []*Consumer
	var consumerDone = make(chan struct{})
	var producerDone = make(chan struct{})

	// Start consumers first (unless producer-only)
	if !producerOnly {
		log.Printf("[%s] 🎧 Starting %d consumer instances...", time.Now().Format(time.RFC3339), numConsumers)
		consumers = make([]*Consumer, numConsumers)

		for i := 0; i < numConsumers; i++ {
			consumerID := i
			wg.Add(1)
			consumerWg.Add(1)
			go func() {
				defer wg.Done()
				defer consumerWg.Done()

				// Create output file for this consumer
				var consumerOutputFile string
				if numConsumers == 1 {
					consumerOutputFile = outputFile
				} else {
					// Insert consumer ID before file extension
					if strings.HasSuffix(outputFile, ".jsonl") {
						consumerOutputFile = strings.TrimSuffix(outputFile, ".jsonl") + fmt.Sprintf("-consumer-%d.jsonl", consumerID+1)
					} else {
						consumerOutputFile = outputFile + fmt.Sprintf("-consumer-%d", consumerID+1)
					}
				}

				var err error
				consumers[consumerID], err = NewConsumer(consumerBrokers, topic, consumerGroup, consumerOutputFile, optimizeSingle)
				if err != nil {
					log.Printf("[%s] ❌ Failed to create consumer %d: %v", time.Now().Format(time.RFC3339), consumerID+1, err)
					return
				}
				defer consumers[consumerID].Close()

				log.Printf("[%s] 🎧 Consumer %d started, writing to: %s", time.Now().Format(time.RFC3339), consumerID+1, consumerOutputFile)

				if err := consumers[consumerID].ConsumeMessages(ctx); err != nil {
					if err != context.Canceled {
						log.Printf("[%s] ❌ Consumer %d error: %v", time.Now().Format(time.RFC3339), consumerID+1, err)
					}
				}
			}()
		}

		// Give consumers time to start and connect
		log.Printf("[%s] ⏳ Waiting for %d consumers to initialize (3s)...", time.Now().Format(time.RFC3339), numConsumers)
		for i := 3; i > 0; i-- {
			log.Printf("[%s] ⏱️  Consumer initialization: %ds remaining", time.Now().Format(time.RFC3339), i)
			time.Sleep(1 * time.Second)
		}
		log.Printf("[%s] ✅ All %d consumers initialized", time.Now().Format(time.RFC3339), numConsumers)

		// Start a goroutine to close consumerDone when all consumers are done
		go func() {
			consumerWg.Wait()
			close(consumerDone)
		}()
	}

	// Start producer(s) (unless consumer-only)
	if !consumerOnly {
		if numProducers == 1 {
			log.Printf("[%s] 📤 Starting single producer phase...", time.Now().Format(time.RFC3339))
			wg.Add(1)
			go func() {
				defer wg.Done()
				defer close(producerDone)

				if err := runProducer(ctx, producerBrokers, topic, messageCount, interval); err != nil {
					log.Printf("[%s] ❌ Producer error: %v", time.Now().Format(time.RFC3339), err)
				}
			}()
		} else {
			log.Printf("[%s] 📤 Starting %d producer instances...", time.Now().Format(time.RFC3339), numProducers)
			var producerWg sync.WaitGroup

			// Calculate messages per producer
			messagesPerProducer := messageCount / numProducers
			remainingMessages := messageCount % numProducers

			for i := 0; i < numProducers; i++ {
				producerID := i
				producerMessageCount := messagesPerProducer
				if i < remainingMessages {
					producerMessageCount++ // Distribute remaining messages
				}

				wg.Add(1)
				producerWg.Add(1)
				go func() {
					defer wg.Done()
					defer producerWg.Done()

					if err := runProducerWithID(ctx, producerBrokers, topic, producerMessageCount, interval, producerID, optimizeLatency); err != nil {
						log.Printf("[%s] ❌ Producer %d error: %v", time.Now().Format(time.RFC3339), producerID+1, err)
					}
				}()
			}

			// Close producerDone when all producers finish
			go func() {
				producerWg.Wait()
				close(producerDone)
			}()
		}
	}

	// Wait for producer to finish if both are running
	if !consumerOnly && !producerOnly {
		select {
		case <-producerDone:
			log.Printf("[%s] ✅ Producer finished, waiting %v for consumers to process remaining messages...",
				time.Now().Format(time.RFC3339), waitTime)

			// Wait specified time for consumers to finish processing with countdown
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
					log.Printf("[%s] ⏰ Wait time expired, stopping consumers", time.Now().Format(time.RFC3339))
					cancel() // Cancel the context to stop all consumers
					break waitLoop
				case <-consumerDone:
					log.Printf("[%s] 🎉 All consumers finished naturally", time.Now().Format(time.RFC3339))
					break waitLoop
				case <-ticker.C:
					elapsed := time.Since(waitStart)
					remaining := waitTime - elapsed
					if remaining > 0 {
						totalProcessed := 0
						for i, consumer := range consumers {
							if consumer != nil {
								count := consumer.GetRecordCount()
								totalProcessed += count
								if i == 0 || count > 0 { // Show individual counts for first consumer or active consumers
									log.Printf("[%s] 📊 Consumer %d: %d messages processed",
										time.Now().Format(time.RFC3339), i+1, count)
								}
							}
						}
						log.Printf("[%s] ⏳ Waiting for consumers... %v remaining | Total processed: %d",
							time.Now().Format(time.RFC3339), remaining.Truncate(time.Second), totalProcessed)
					}
				}
			}

		case <-ctx.Done():
			log.Printf("[%s] ⏹️  Context canceled during producer execution", time.Now().Format(time.RFC3339))
		}
	}

	// Wait for all goroutines to complete
	wg.Wait()

	// Print final statistics for all consumers
	if len(consumers) > 0 {
		totalCount := 0
		for i, consumer := range consumers {
			if consumer != nil {
				count := consumer.GetRecordCount()
				totalCount += count
				log.Printf("[%s] 📊 Consumer %d final count: %d messages",
					time.Now().Format(time.RFC3339), i+1, count)
			}
		}
		log.Printf("[%s] 📊 Total messages processed across all consumers: %d",
			time.Now().Format(time.RFC3339), totalCount)
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
	duration := finishTime.Sub(startTime)
	avgRate := float64(messageCount) / duration.Seconds()
	log.Printf("[%s] Producer finished successfully", finishTime.Format(time.RFC3339))
	log.Printf("[%s] 🎉 Finished producing %d messages - Duration: %v | Avg rate: %.2f msg/s",
		finishTime.Format(time.RFC3339), messageCount, duration, avgRate)

	return nil
}

func runProducerWithID(ctx context.Context, brokers []string, topic string, messageCount int, interval time.Duration, producerID int, optimizeLatency bool) error {
	startTime := time.Now()
	log.Printf("[%s] Starting producer %d (messages: %d, interval: %v)...",
		startTime.Format(time.RFC3339), producerID+1, messageCount, interval)

	producer, err := NewProducerWithOptions(brokers, topic, producerID, optimizeLatency)
	if err != nil {
		return fmt.Errorf("failed to create producer %d: %w", producerID+1, err)
	}
	defer func() {
		producer.Close()
		endTime := time.Now()
		duration := endTime.Sub(startTime)
		log.Printf("[%s] Producer %d closed - Runtime: %v", endTime.Format(time.RFC3339), producerID+1, duration)
	}()

	if err := producer.ProduceMessages(ctx, messageCount, interval); err != nil {
		return fmt.Errorf("failed to produce messages from producer %d: %w", producerID+1, err)
	}

	finishTime := time.Now()
	duration := finishTime.Sub(startTime)
	avgRate := float64(messageCount) / duration.Seconds()
	log.Printf("[%s] 🎉 Producer %d finished - %d messages in %v | Avg rate: %.2f msg/s",
		finishTime.Format(time.RFC3339), producerID+1, messageCount, duration, avgRate)

	return nil
}

func runConsumer(ctx context.Context, brokers []string, topic string, consumerGroup string, outputFile string, optimizeSingle bool) error {
	startTime := time.Now()
	log.Printf("[%s] Starting consumer...", startTime.Format(time.RFC3339))

	consumer, err := NewConsumer(brokers, topic, consumerGroup, outputFile, optimizeSingle)
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
