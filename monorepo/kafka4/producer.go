package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/twmb/franz-go/pkg/kgo"
)

type MessageWithTimestamp struct {
	ID        string    `json:"id"`
	Timestamp time.Time `json:"timestamp"`
	Payload   string    `json:"payload"`
}

type Producer struct {
	client    *kgo.Client
	topic     string
	cdkConfig *CDKConfig
}

func NewProducer(brokers []string, topic string) (*Producer, error) {
	// Check Kafka version compatibility before creating client
	ctx, cancel := context.WithTimeout(context.Background(), VERSION_CHECK_TIMEOUT)
	defer cancel()
	
	log.Printf("[%s] 🔍 Producer: Verifying Kafka version compatibility...", time.Now().Format(time.RFC3339))
	CheckKafkaVersionAndExit(ctx, brokers)

	// Check for ultra-optimized settings
	optimize2Workers := os.Getenv("KAFKA_OPTIMIZE_2_WORKERS") == "true"
	ultraLowLatency := os.Getenv("KAFKA_ULTRA_LOW_LATENCY") == "true"

	var client *kgo.Client
	var err error

	if optimize2Workers && ultraLowLatency {
		// ULTRA-OPTIMIZED PRODUCER for 2-worker setup
		log.Printf("[%s] ⚡ Creating ULTRA-OPTIMIZED producer for 2-worker setup...", time.Now().Format(time.RFC3339))
		client, err = kgo.NewClient(
			kgo.SeedBrokers(brokers...),
			kgo.DefaultProduceTopic(topic),
			
			// ULTRA-AGGRESSIVE producer settings for higher throughput
			kgo.RequiredAcks(kgo.LeaderAck()),                 // Only wait for leader (fastest)
			kgo.DisableIdempotentWrite(),                      // Disable idempotency for speed
			kgo.ProducerLinger(1*time.Millisecond),           // Minimal linger for micro-batching
			kgo.ProducerBatchMaxBytes(1024*1024),             // Larger batches for better throughput
			kgo.ProducerBatchCompression(kgo.NoCompression()), // No compression for speed
			kgo.RequestTimeoutOverhead(1*time.Second),        // Minimum allowed timeout
			
			// Enhanced connection settings
			kgo.ConnIdleTimeout(30*time.Second),               // Keep connections alive longer
			kgo.MetadataMaxAge(5*time.Minute),                // Refresh metadata less frequently
			kgo.MetadataMinAge(10*time.Second),               // But not too infrequently
			
			// Optimized retry settings
			kgo.RetryBackoffFn(func(tries int) time.Duration {
				return time.Duration(tries) * 2 * time.Millisecond
			}),
		)
	} else {
		// Standard producer configuration
		client, err = kgo.NewClient(
			kgo.SeedBrokers(brokers...),
			kgo.DefaultProduceTopic(topic),
			// Optimize for per-event latency (no batching)
			kgo.RequiredAcks(kgo.LeaderAck()),                 // Only wait for leader (faster than AllISRAcks)
			kgo.DisableIdempotentWrite(),                      // Disable idempotency to allow LeaderAck for faster latency
			kgo.ProducerLinger(0),                             // No linger time - send immediately
			kgo.ProducerBatchCompression(kgo.NoCompression()), // No compression for speed
			kgo.RequestTimeoutOverhead(1*time.Second),         // Shorter timeout
		)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to create kafka client: %w", err)
	}

	cdkConfig := LoadCDKConfig()
	LogCDKConfig(cdkConfig, "Producer")

	return &Producer{
		client:    client,
		topic:     topic,
		cdkConfig: cdkConfig,
	}, nil
}

func (p *Producer) SendMessage(ctx context.Context, id string, payload string) error {
	msg := MessageWithTimestamp{
		ID:        id,
		Timestamp: time.Now(),
		Payload:   payload,
	}

	msgBytes, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal message: %w", err)
	}

	record := &kgo.Record{
		Topic: p.topic,
		Key:   []byte(id),
		Value: msgBytes,
	}

	// Use synchronous production for lowest per-event latency
	results := p.client.ProduceSync(ctx, record)
	if err := results.FirstErr(); err != nil {
		return fmt.Errorf("failed to produce message %s: %w", id, err)
	}

	return nil
}

func (p *Producer) Close() {
	p.client.Close()
}

// GetCDKConfig returns the CDK configuration
func (p *Producer) GetCDKConfig() *CDKConfig {
	return p.cdkConfig
}

// GetMemoryDBEndpoint returns the MemoryDB endpoint if configured
func (p *Producer) GetMemoryDBEndpoint() string {
	return p.cdkConfig.GetMemoryDBEndpoint()
}

// GetSNSTopicARN returns the SNS topic ARN if configured
func (p *Producer) GetSNSTopicARN() string {
	return p.cdkConfig.GetSNSTopicARN()
}

func (p *Producer) ProduceMessages(ctx context.Context, count int, interval time.Duration) error {
	startTime := time.Now()
	log.Printf("[%s] 🚀 Starting to produce %d messages with %v interval",
		startTime.Format(time.RFC3339), count, interval)

	// Warm up connection and reduce cold start latency for accurate measurements
	if count > 10 {
		log.Printf("[%s] 🔥 Warming up connection...", time.Now().Format(time.RFC3339))
		warmupStart := time.Now()
		for i := 0; i < 3; i++ {
			warmupMsg := MessageWithTimestamp{
				ID:        fmt.Sprintf("warmup-%s", uuid.New().String()),
				Timestamp: time.Now(),
				Payload:   "warmup message",
			}
			msgBytes, _ := json.Marshal(warmupMsg)
			record := &kgo.Record{
				Topic: p.topic,
				Key:   []byte(warmupMsg.ID),
				Value: msgBytes,
			}
			// Send warmup message (ignore any errors)
			p.client.ProduceSync(ctx, record)
		}
		warmupDuration := time.Since(warmupStart)
		log.Printf("[%s] ✅ Connection warmed up in %v", time.Now().Format(time.RFC3339), warmupDuration)
	}

	sentCount := 0
	progressInterval := count / 20 // Show progress every 5%
	if progressInterval < 1 {
		progressInterval = 1
	}

	// Calculate logging interval based on message count
	var logInterval int
	if count <= 10 {
		logInterval = 1 // Log every message for small batches
	} else if count <= 100 {
		logInterval = 10 // Log every 10th message
	} else if count <= 1000 {
		logInterval = 100 // Log every 100th message
	} else {
		logInterval = 500 // Log every 500th message for large batches
	}

	for i := 0; i < count; i++ {
		select {
		case <-ctx.Done():
			cancelTime := time.Now()
			log.Printf("[%s] ⏹️  Producer canceled after sending %d/%d messages (%.1f%%)",
				cancelTime.Format(time.RFC3339), sentCount, count, float64(sentCount)/float64(count)*100)
			return ctx.Err()
		default:
		}

		id := uuid.New().String()
		payload := fmt.Sprintf("Test message %d", i)

		if err := p.SendMessage(ctx, id, payload); err != nil {
			log.Printf("[%s] ❌ Error sending message %s: %v",
				time.Now().Format(time.RFC3339), id, err)
			continue
		}
		sentCount++

		// Log individual messages using modulo for high-volume runs
		if sentCount%logInterval == 0 || sentCount <= 5 || sentCount == count {
			log.Printf("[%s] 📤 Produced message %s (batch %d/%d)",
				time.Now().Format(time.RFC3339), id, sentCount, count)
		}

		// Show progress indicators
		if sentCount%progressInterval == 0 || sentCount == count {
			percentage := float64(sentCount) / float64(count) * 100
			elapsed := time.Since(startTime)
			rate := float64(sentCount) / elapsed.Seconds()
			remaining := time.Duration(float64(count-sentCount)/rate) * time.Second

			log.Printf("[%s] 📊 Progress: %d/%d messages (%.1f%%) | Rate: %.1f msg/s | ETA: %v",
				time.Now().Format(time.RFC3339), sentCount, count, percentage, rate, remaining.Truncate(time.Second))
		}

		if i < count-1 && interval > 0 {
			time.Sleep(interval)
		}
	}

	finishTime := time.Now()
	duration := finishTime.Sub(startTime)
	avgRate := float64(sentCount) / duration.Seconds()
	log.Printf("[%s] 🎉 Finished producing %d messages - Duration: %v | Avg rate: %.1f msg/s",
		finishTime.Format(time.RFC3339), sentCount, duration.Truncate(time.Millisecond), avgRate)
	return nil
}
