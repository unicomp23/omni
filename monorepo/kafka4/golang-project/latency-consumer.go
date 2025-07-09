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

type MessagePayload struct {
	ID        string    `json:"id"`
	Content   string    `json:"content"`
	SentAt    time.Time `json:"sent_at"`
	Producer  string    `json:"producer"`
}

type LatencyRecord struct {
	MessageID    string        `json:"message_id"`
	Producer     string        `json:"producer"`
	Consumer     string        `json:"consumer"`
	SentAt       time.Time     `json:"sent_at"`
	ReceivedAt   time.Time     `json:"received_at"`
	LatencyMs    float64       `json:"latency_ms"`
	LatencyNanos int64         `json:"latency_nanos"`
	Topic        string        `json:"topic"`
	Partition    int32         `json:"partition"`
	Offset       int64         `json:"offset"`
	Timestamp    time.Time     `json:"kafka_timestamp"`
}

func main() {
	// Create Kafka client
	client, err := kgo.NewClient(
		kgo.SeedBrokers("kafka4:29092"),
		kgo.ClientID("go-latency-consumer"),
		kgo.ConsumerGroup("go-latency-consumer-group"),
		kgo.ConsumeTopics("latency-topic"),
		kgo.ConsumeResetOffset(kgo.NewOffset().AtStart()),
	)
	if err != nil {
		log.Fatalf("Failed to create client: %v", err)
	}
	defer client.Close()

	ctx := context.Background()
	consumerID := "go-latency-consumer"

	fmt.Fprintf(os.Stderr, "Starting Go Latency Consumer...\n")
	fmt.Fprintf(os.Stderr, "Consumer: %s\n", consumerID)
	fmt.Fprintf(os.Stderr, "Writing latency logs to stdout in JSONL format\n")
	fmt.Fprintf(os.Stderr, "---\n")

	messageCount := 0
	for {
		fetches := client.PollFetches(ctx)
		if errs := fetches.Errors(); len(errs) > 0 {
			log.Printf("Fetch errors: %v", errs)
			continue
		}

		fetches.EachRecord(func(record *kgo.Record) {
			receivedAt := time.Now().UTC()
			messageCount++

			// Parse the message payload
			var payload MessagePayload
			if err := json.Unmarshal(record.Value, &payload); err != nil {
				log.Printf("Failed to unmarshal message: %v", err)
				return
			}

			// Calculate latency
			latency := receivedAt.Sub(payload.SentAt)
			latencyMs := float64(latency.Nanoseconds()) / 1e6

			// Create latency record
			latencyRecord := LatencyRecord{
				MessageID:    payload.ID,
				Producer:     payload.Producer,
				Consumer:     consumerID,
				SentAt:       payload.SentAt,
				ReceivedAt:   receivedAt,
				LatencyMs:    latencyMs,
				LatencyNanos: latency.Nanoseconds(),
				Topic:        record.Topic,
				Partition:    record.Partition,
				Offset:       record.Offset,
				Timestamp:    record.Timestamp,
			}

			// Output JSONL record to stdout
			jsonBytes, err := json.Marshal(latencyRecord)
			if err != nil {
				log.Printf("Failed to marshal latency record: %v", err)
				return
			}

			fmt.Println(string(jsonBytes))

			// Log to stderr for debugging
			fmt.Fprintf(os.Stderr, "Processed: %s, Latency: %.3f ms\n", payload.ID, latencyMs)
		})

		// Stop after processing some messages for demo
		if messageCount >= 50 {
			break
		}
	}

	fmt.Fprintf(os.Stderr, "Go Latency Consumer completed! Processed %d messages.\n", messageCount)
} 