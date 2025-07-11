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
	MessageID       string        `json:"message_id"`
	ProducedAt      time.Time     `json:"produced_at"`
	ConsumedAt      time.Time     `json:"consumed_at"`
	LatencyMs       int64         `json:"latency_ms"`
	LatencyNs       int64         `json:"latency_ns"`
	Topic           string        `json:"topic"`
	Partition       int32         `json:"partition"`
	Offset          int64         `json:"offset"`
	OriginalPayload string        `json:"original_payload"`
}

type Consumer struct {
	client       *kgo.Client
	topic        string
	outputFile   *os.File
	recordCount  int
	cdkConfig    *CDKConfig
}



func NewConsumer(brokers []string, topic string, consumerGroup string, outputFilePath string) (*Consumer, error) {
	client, err := kgo.NewClient(
		kgo.SeedBrokers(brokers...),
		kgo.ConsumerGroup(consumerGroup),
		kgo.ConsumeTopics(topic),
		kgo.ConsumeResetOffset(kgo.NewOffset().AtStart()),
	)
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
	log.Printf("[%s] 🎧 Starting to consume messages from topic: %s", 
		time.Now().Format(time.RFC3339), c.topic)
	
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		fetches := c.client.PollFetches(ctx)
		if errs := fetches.Errors(); len(errs) > 0 {
			for _, err := range errs {
				log.Printf("[%s] Fetch error: %v", time.Now().Format(time.RFC3339), err)
			}
			continue
		}

		fetches.EachRecord(func(record *kgo.Record) {
			if err := c.processRecord(record); err != nil {
				log.Printf("[%s] Error processing record: %v", time.Now().Format(time.RFC3339), err)
			}
		})
	}
}

func (c *Consumer) processRecord(record *kgo.Record) error {
	consumedAt := time.Now()
	
	// Parse the original message
	var originalMsg MessageWithTimestamp
	if err := json.Unmarshal(record.Value, &originalMsg); err != nil {
		return fmt.Errorf("failed to unmarshal message: %w", err)
	}

	// Calculate latency
	latency := consumedAt.Sub(originalMsg.Timestamp)
	latencyMs := latency.Milliseconds()
	latencyNs := latency.Nanoseconds()

	// Create latency record
	latencyRecord := LatencyRecord{
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

	// Marshal to JSON and write to file
	jsonLine, err := json.Marshal(latencyRecord)
	if err != nil {
		return fmt.Errorf("failed to marshal latency record: %w", err)
	}

	// Write JSONL line
	if _, err := c.outputFile.WriteString(string(jsonLine) + "\n"); err != nil {
		return fmt.Errorf("failed to write to output file: %w", err)
	}

	// Ensure data is written to disk
	if err := c.outputFile.Sync(); err != nil {
		return fmt.Errorf("failed to sync output file: %w", err)
	}

	c.recordCount++
	
	// Show periodic progress updates
	if c.recordCount%100 == 0 || c.recordCount <= 10 {
		log.Printf("[%s] 📈 Processed message %s: latency=%dms (%dns) | Total processed: %d", 
			consumedAt.Format(time.RFC3339), originalMsg.ID, latencyMs, latencyNs, c.recordCount)
	}

	return nil
}

func (c *Consumer) Close() {
	closeTime := time.Now()
	c.client.Close()
	if c.outputFile != nil {
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