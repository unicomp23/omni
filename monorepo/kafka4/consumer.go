package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
)

type LatencyRecord struct {
	MessageID       string    `json:"message_id"`
	ProducedAt      time.Time `json:"produced_at"`
	ConsumedAt      time.Time `json:"consumed_at"`
	LatencyMs       int64     `json:"latency_ms"`
	LatencyNs       int64     `json:"latency_ns"`
	Topic           string    `json:"topic"`
	Partition       int32     `json:"partition"`
	Offset          int64     `json:"offset"`
	OriginalPayload string    `json:"original_payload"`
}

type Consumer struct {
	client      *kgo.Client
	topic       string
	outputFile  *os.File
	recordCount int
	cdkConfig   *CDKConfig
}

func NewConsumer(brokers []string, topic string, consumerGroup string, outputFilePath string, optimizeSingle bool) (*Consumer, error) {
	// Check Kafka version compatibility before creating client
	ctx, cancel := context.WithTimeout(context.Background(), VERSION_CHECK_TIMEOUT)
	defer cancel()

	log.Printf("[%s] 🔍 Consumer: Verifying Kafka version compatibility...", time.Now().Format(time.RFC3339))
	CheckKafkaVersionAndExit(ctx, brokers)

	var client *kgo.Client
	var err error

	// Check for ultra-optimized 2-worker mode
	optimize2Workers := os.Getenv("KAFKA_OPTIMIZE_2_WORKERS") == "true"
	ultraLowLatency := os.Getenv("KAFKA_ULTRA_LOW_LATENCY") == "true"

	if optimizeSingle {
		// ULTRA-AGGRESSIVE LATENCY OPTIMIZATIONS FOR SINGLE CONSUMER
		log.Printf("[%s] ⚡ Creating ULTRA-OPTIMIZED single consumer...", time.Now().Format(time.RFC3339))
		client, err = kgo.NewClient(
			kgo.SeedBrokers(brokers...),
			kgo.ConsumerGroup(consumerGroup),
			kgo.ConsumeTopics(topic),
			kgo.ConsumeResetOffset(kgo.NewOffset().AtStart()),

			// ULTRA-AGGRESSIVE settings for minimum latency
			kgo.FetchMaxWait(10*time.Millisecond), // Minimum allowed fetch wait
			kgo.FetchMinBytes(1),                  // Don't wait for data
			kgo.FetchMaxBytes(16*1024),            // Smaller batches for lower latency
			kgo.FetchMaxPartitionBytes(8*1024),    // Smaller per-partition batches

			// Disable consumer group coordination for single consumer
			kgo.SessionTimeout(30*time.Second),    // Long session timeout
			kgo.HeartbeatInterval(10*time.Second), // Less frequent heartbeats
			kgo.RebalanceTimeout(60*time.Second),  // Long rebalance timeout
			kgo.RequireStableFetchOffsets(),       // Ensure stable offset fetching

			// Aggressive retry settings for single consumer
			kgo.RetryBackoffFn(func(tries int) time.Duration {
				return time.Duration(tries) * time.Millisecond
			}),
		)
	} else if optimize2Workers && ultraLowLatency {
		// ULTRA-AGGRESSIVE MULTI-PRODUCER + 2-WORKER OPTIMIZATION
		log.Printf("[%s] ⚡ Creating MULTI-PRODUCER optimized 2-worker consumer...", time.Now().Format(time.RFC3339))
		client, err = kgo.NewClient(
			kgo.SeedBrokers(brokers...),
			kgo.ConsumerGroup(consumerGroup),
			kgo.ConsumeTopics(topic),
			kgo.ConsumeResetOffset(kgo.NewOffset().AtStart()),

			// HYPER-AGGRESSIVE settings for 1000 producers + 2 workers
			kgo.FetchMaxWait(5*time.Millisecond), // Ultra-fast fetch wait
			kgo.FetchMinBytes(1),                 // Don't wait for data
			kgo.FetchMaxBytes(256*1024),          // Larger batches for high throughput
			kgo.FetchMaxPartitionBytes(64*1024),  // Larger per-partition batches

			// Optimized for high-throughput multi-producer scenario
			kgo.SessionTimeout(15*time.Second),   // Longer session timeout for stability
			kgo.HeartbeatInterval(5*time.Second), // Frequent heartbeats for coordination
			kgo.RebalanceTimeout(45*time.Second), // Longer rebalance timeout for stability
			kgo.RequireStableFetchOffsets(),      // Ensure stable offset fetching

			// Sticky partition assignment for consistent performance
			kgo.Balancers(kgo.StickyBalancer()),

			// Ultra-fast retry for high-throughput scenario
			kgo.RetryBackoffFn(func(tries int) time.Duration {
				return time.Duration(tries) * time.Millisecond
			}),

			// Optimize for high message volume
			kgo.DisableAutoCommit(),                     // Manual offset management for better control
			kgo.AutoCommitInterval(50*time.Millisecond), // Very fast commits for low latency
		)
	} else if optimize2Workers {
		// ULTRA-AGGRESSIVE LATENCY OPTIMIZATIONS FOR 2 WORKERS
		log.Printf("[%s] ⚡ Creating ULTRA-OPTIMIZED 2-worker consumer...", time.Now().Format(time.RFC3339))
		client, err = kgo.NewClient(
			kgo.SeedBrokers(brokers...),
			kgo.ConsumerGroup(consumerGroup),
			kgo.ConsumeTopics(topic),
			kgo.ConsumeResetOffset(kgo.NewOffset().AtStart()),

			// ULTRA-AGGRESSIVE settings for 2-worker setup
			kgo.FetchMaxWait(10*time.Millisecond), // Minimum allowed fetch wait
			kgo.FetchMinBytes(1),                  // Don't wait for data
			kgo.FetchMaxBytes(128*1024),           // Larger batches for better throughput
			kgo.FetchMaxPartitionBytes(32*1024),   // Balanced per-partition batches

			// Optimized consumer group settings for 2 workers
			kgo.SessionTimeout(10*time.Second),   // Slightly longer to reduce rebalancing
			kgo.HeartbeatInterval(3*time.Second), // Balanced heartbeat frequency
			kgo.RebalanceTimeout(30*time.Second), // Longer rebalance timeout for stability
			kgo.RequireStableFetchOffsets(),      // Ensure stable offset fetching

			// Sticky partition assignment to reduce rebalancing overhead
			kgo.Balancers(kgo.StickyBalancer()),

			// Ultra-fast retry for 2 workers
			kgo.RetryBackoffFn(func(tries int) time.Duration {
				return time.Duration(tries) * 3 * time.Millisecond
			}),

			// Optimize for 2 workers specifically
			kgo.DisableAutoCommit(),                      // Manual offset management for better control
			kgo.AutoCommitInterval(100*time.Millisecond), // Faster commits when enabled
		)
	} else {
		// Standard multi-consumer configuration
		log.Printf("[%s] 🔍 Creating standard multi-consumer...", time.Now().Format(time.RFC3339))
		client, err = kgo.NewClient(
			kgo.SeedBrokers(brokers...),
			kgo.ConsumerGroup(consumerGroup),
			kgo.ConsumeTopics(topic),
			kgo.ConsumeResetOffset(kgo.NewOffset().AtStart()),

			// Standard settings for multi-consumer setup
			kgo.FetchMaxWait(10*time.Millisecond), // Balanced fetch wait
			kgo.FetchMinBytes(1),                  // Don't wait for data
			kgo.FetchMaxBytes(64*1024),            // Moderate batch size
			kgo.FetchMaxPartitionBytes(16*1024),   // Moderate per-partition batches

			// Consumer group optimizations
			kgo.SessionTimeout(6*time.Second),    // Shorter session timeout
			kgo.HeartbeatInterval(2*time.Second), // More frequent heartbeats
			kgo.RebalanceTimeout(10*time.Second), // Faster rebalancing
			kgo.RequireStableFetchOffsets(),      // Ensure stable offset fetching

			// Standard retry backoff
			kgo.RetryBackoffFn(func(tries int) time.Duration {
				return time.Duration(tries) * 10 * time.Millisecond
			}),
		)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to create kafka client: %w", err)
	}

	outputFile, err := os.OpenFile(outputFilePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return nil, fmt.Errorf("failed to open output file: %w", err)
	}

	cdkConfig := LoadCDKConfig()
	LogCDKConfig(cdkConfig, "Consumer")

	return &Consumer{
		client:     client,
		topic:      topic,
		outputFile: outputFile,
		cdkConfig:  cdkConfig,
	}, nil
}

func (c *Consumer) ConsumeMessages(ctx context.Context) error {
	log.Printf("[%s] 🎧 Starting OPTIMIZED single consumer for topic: %s",
		time.Now().Format(time.RFC3339), c.topic)

	// Pre-allocate batch buffer for better performance
	const batchSize = 50
	recordBatch := make([]LatencyRecord, 0, batchSize)

	for {
		select {
		case <-ctx.Done():
			// Flush any remaining records before exiting
			if len(recordBatch) > 0 {
				c.flushBatch(recordBatch)
			}
			return ctx.Err()
		default:
		}

		// Use normal polling without aggressive timeout
		fetches := c.client.PollFetches(ctx)

		if errs := fetches.Errors(); len(errs) > 0 {
			for _, err := range errs {
				// Only log non-timeout errors to reduce noise
				if err.Err != context.DeadlineExceeded {
					log.Printf("[%s] Fetch error: %v", time.Now().Format(time.RFC3339), err)
				}
			}
			continue
		}

		// Process records in batches for better throughput
		fetches.EachRecord(func(record *kgo.Record) {
			if latencyRecord, err := c.processRecordToStruct(record); err != nil {
				log.Printf("[%s] Error processing record: %v", time.Now().Format(time.RFC3339), err)
			} else {
				recordBatch = append(recordBatch, *latencyRecord)

				// Flush batch when it reaches size or for first 10 messages (immediate feedback)
				if len(recordBatch) >= batchSize || c.recordCount < 10 {
					c.flushBatch(recordBatch)
					recordBatch = recordBatch[:0] // Reset slice but keep capacity
				}
			}
		})
	}
}

// processRecordToStruct processes a record and returns a LatencyRecord struct (no I/O)
func (c *Consumer) processRecordToStruct(record *kgo.Record) (*LatencyRecord, error) {
	consumedAt := time.Now()

	// Parse the original message
	var originalMsg MessageWithTimestamp
	if err := json.Unmarshal(record.Value, &originalMsg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal message: %w", err)
	}

	// Calculate latency
	latency := consumedAt.Sub(originalMsg.Timestamp)
	latencyMs := latency.Milliseconds()
	latencyNs := latency.Nanoseconds()

	// Create latency record
	latencyRecord := &LatencyRecord{
		MessageID:       originalMsg.ID,
		ProducedAt:      originalMsg.Timestamp,
		ConsumedAt:      consumedAt,
		LatencyMs:       latencyMs,
		LatencyNs:       latencyNs,
		Topic:           record.Topic,
		Partition:       record.Partition,
		Offset:          record.Offset,
		OriginalPayload: originalMsg.Payload,
	}

	c.recordCount++

	return latencyRecord, nil
}

// flushBatch writes a batch of records to file efficiently
func (c *Consumer) flushBatch(batch []LatencyRecord) {
	if len(batch) == 0 {
		return
	}

	// Write all records in batch
	for _, record := range batch {
		jsonLine, err := json.Marshal(record)
		if err != nil {
			log.Printf("[%s] Failed to marshal record: %v", time.Now().Format(time.RFC3339), err)
			continue
		}

		if _, err := c.outputFile.WriteString(string(jsonLine) + "\n"); err != nil {
			log.Printf("[%s] Failed to write to file: %v", time.Now().Format(time.RFC3339), err)
			continue
		}
	}

	// Sync to disk every batch (for single consumer, we can afford this)
	if err := c.outputFile.Sync(); err != nil {
		log.Printf("[%s] Failed to sync file: %v", time.Now().Format(time.RFC3339), err)
	}

	// Show progress for first few messages or every 1000 messages
	if c.recordCount <= 10 || c.recordCount%1000 == 0 {
		lastRecord := batch[len(batch)-1]
		log.Printf("[%s] 📈 Processed batch ending with message %s: latency=%dms (%dns) | Total processed: %d",
			time.Now().Format(time.RFC3339), lastRecord.MessageID, lastRecord.LatencyMs, lastRecord.LatencyNs, c.recordCount)
	}
}

func (c *Consumer) Close() {
	closeTime := time.Now()
	c.client.Close()
	if c.outputFile != nil {
		// Final sync to ensure all data is written
		c.outputFile.Sync()
		c.outputFile.Close()
	}
	log.Printf("[%s] Consumer closed. Total records processed: %d",
		closeTime.Format(time.RFC3339), c.recordCount)
}

func (c *Consumer) GetRecordCount() int {
	return c.recordCount
}

// GetCDKConfig returns the CDK configuration
func (c *Consumer) GetCDKConfig() *CDKConfig {
	return c.cdkConfig
}

// GetMemoryDBEndpoint returns the MemoryDB endpoint if configured
func (c *Consumer) GetMemoryDBEndpoint() string {
	return c.cdkConfig.GetMemoryDBEndpoint()
}
