package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
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
	topic := os.Getenv("GO_LATENCY_TOPIC")
	if topic == "" {
		topic = "latency-topic" // fallback
	}

	// Get expected message count from environment
	expectedCount := 10 // default
	if countStr := os.Getenv("EXPECTED_MESSAGE_COUNT"); countStr != "" {
		if count, err := strconv.Atoi(countStr); err == nil {
			expectedCount = count
		}
	}

	// Get timeout from environment (in seconds)
	timeoutSeconds := 30 // default
	if timeoutStr := os.Getenv("CONSUMER_TIMEOUT_SECONDS"); timeoutStr != "" {
		if timeout, err := strconv.Atoi(timeoutStr); err == nil {
			timeoutSeconds = timeout
		}
	}

	// Create Kafka client
	client, err := kgo.NewClient(
		kgo.SeedBrokers("kafka4:29092"),
		kgo.ClientID("go-auto-exit-consumer"),
		kgo.ConsumerGroup("go-auto-exit-consumer-group"),
		kgo.ConsumeTopics(topic),
		kgo.ConsumeResetOffset(kgo.NewOffset().AtStart()),
	)
	if err != nil {
		log.Fatalf("Failed to create client: %v", err)
	}
	defer client.Close()

	ctx := context.Background()
	consumerID := "go-auto-exit-consumer"

	fmt.Fprintf(os.Stderr, "Starting Go Auto-Exit Consumer...\n")
	fmt.Fprintf(os.Stderr, "Consumer: %s\n", consumerID)
	fmt.Fprintf(os.Stderr, "Topic: %s\n", topic)
	fmt.Fprintf(os.Stderr, "Expected messages: %d\n", expectedCount)
	fmt.Fprintf(os.Stderr, "Timeout: %d seconds\n", timeoutSeconds)
	fmt.Fprintf(os.Stderr, "Writing latency logs to stdout in JSONL format\n")
	fmt.Fprintf(os.Stderr, "---\n")

	messageCount := 0
	lastMessageTime := time.Now()
	startTime := time.Now()
	timeout := time.Duration(timeoutSeconds) * time.Second

	for {
		// Check for overall timeout
		if time.Since(startTime) > timeout {
			fmt.Fprintf(os.Stderr, "Overall timeout reached after %v. Processed %d/%d messages.\n", 
				timeout, messageCount, expectedCount)
			break
		}

		// Check for idle timeout (no messages for 5 seconds after receiving first message)
		if messageCount > 0 && time.Since(lastMessageTime) > 5*time.Second {
			fmt.Fprintf(os.Stderr, "Idle timeout reached. No messages for 5 seconds. Processed %d/%d messages.\n", 
				messageCount, expectedCount)
			break
		}

		fetches := client.PollFetches(ctx)
		if errs := fetches.Errors(); len(errs) > 0 {
			log.Printf("Fetch errors: %v", errs)
			continue
		}

		if fetches.NumRecords() == 0 {
			time.Sleep(100 * time.Millisecond)
			continue
		}

		fetches.EachRecord(func(record *kgo.Record) {
			receivedAt := time.Now().UTC()
			messageCount++
			lastMessageTime = receivedAt

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
			fmt.Fprintf(os.Stderr, "Processed: %s, Latency: %.3f ms [%d/%d]\n", 
				payload.ID, latencyMs, messageCount, expectedCount)
		})

		// Exit when we've received the expected number of messages
		if messageCount >= expectedCount {
			fmt.Fprintf(os.Stderr, "Received expected %d messages. Exiting successfully.\n", expectedCount)
			break
		}
	}

	fmt.Fprintf(os.Stderr, "Go Auto-Exit Consumer completed! Processed %d messages in %v.\n", 
		messageCount, time.Since(startTime))
} 