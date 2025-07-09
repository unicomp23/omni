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
	ID         string    `json:"id"`
	Content    string    `json:"content"`
	SentAt     time.Time `json:"sent_at"`
	Producer   string    `json:"producer"`
	ProducerID int       `json:"producer_id"`
	MessageNum int       `json:"message_num"`
	TotalMsgs  int       `json:"total_messages"`
	SpacingMs  int       `json:"spacing_ms"`
}

type LatencyRecord struct {
	MessageID    string        `json:"message_id"`
	Producer     string        `json:"producer"`
	ProducerID   int          `json:"producer_id"`
	Consumer     string        `json:"consumer"`
	SentAt       time.Time     `json:"sent_at"`
	ReceivedAt   time.Time     `json:"received_at"`
	LatencyMs    float64       `json:"latency_ms"`
	LatencyNanos int64         `json:"latency_nanos"`
	Topic        string        `json:"topic"`
	Partition    int32         `json:"partition"`
	Offset       int64         `json:"offset"`
	MessageNum   int           `json:"message_num"`
}

func main() {
	// Get wait time from command line argument or environment
	waitTimeMs := 5000 // Default 5 seconds
	if len(os.Args) > 1 {
		if ms, err := strconv.Atoi(os.Args[1]); err == nil {
			waitTimeMs = ms
		}
	} else if waitStr := os.Getenv("WAIT_TIME_MS"); waitStr != "" {
		if ms, err := strconv.Atoi(waitStr); err == nil {
			waitTimeMs = ms
		}
	}

	topic := os.Getenv("GO_LATENCY_TOPIC")
	if topic == "" {
		topic = "latency-topic"
	}

	// Get consumer configuration from environment
	consumerID := 1
	if idStr := os.Getenv("CONSUMER_ID"); idStr != "" {
		if id, err := strconv.Atoi(idStr); err == nil {
			consumerID = id
		}
	}

	// Create Kafka client
	client, err := kgo.NewClient(
		kgo.SeedBrokers("kafka4:29092"),
		kgo.ClientID(fmt.Sprintf("coordinated-consumer-%d", consumerID)),
		kgo.ConsumerGroup(fmt.Sprintf("coordinated-consumer-group-%d", consumerID)),
		kgo.ConsumeTopics(topic),
		kgo.ConsumeResetOffset(kgo.NewOffset().AtStart()),
	)
	if err != nil {
		log.Fatalf("Failed to create client: %v", err)
	}
	defer client.Close()

	ctx := context.Background()
	consumerName := fmt.Sprintf("coordinated-consumer-%d", consumerID)
	waitDuration := time.Duration(waitTimeMs) * time.Millisecond
	startTime := time.Now()

	fmt.Fprintf(os.Stderr, "Starting Coordinated Consumer %d...\n", consumerID)
	fmt.Fprintf(os.Stderr, "Consumer: %s\n", consumerName)
	fmt.Fprintf(os.Stderr, "Topic: %s\n", topic)
	fmt.Fprintf(os.Stderr, "Wait time: %v\n", waitDuration)
	fmt.Fprintf(os.Stderr, "Will exit at: %s\n", startTime.Add(waitDuration).Format(time.RFC3339Nano))
	fmt.Fprintf(os.Stderr, "Writing latency logs to stdout in JSONL format\n")
	fmt.Fprintf(os.Stderr, "---\n")

	var (
		messageCount  = 0
		seenProducers = make(map[int]bool)
	)

	for {
		// Check if we should exit based on time
		if time.Since(startTime) >= waitDuration {
			fmt.Fprintf(os.Stderr, "Wait time completed after %v. Processed %d messages from %d producers.\n", 
				time.Since(startTime), messageCount, len(seenProducers))
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

			// Parse the message payload
			var payload MessagePayload
			if err := json.Unmarshal(record.Value, &payload); err != nil {
				log.Printf("Failed to unmarshal message: %v", err)
				return
			}

			// Track producers we've seen
			if payload.ProducerID > 0 {
				if !seenProducers[payload.ProducerID] {
					seenProducers[payload.ProducerID] = true
					fmt.Fprintf(os.Stderr, "Discovered producer %d [%d producers so far]\n", 
						payload.ProducerID, len(seenProducers))
				}
			}

			// Calculate latency
			latency := receivedAt.Sub(payload.SentAt)
			latencyMs := float64(latency.Nanoseconds()) / 1e6

			// Create latency record
			latencyRecord := LatencyRecord{
				MessageID:    payload.ID,
				Producer:     payload.Producer,
				ProducerID:   payload.ProducerID,
				Consumer:     consumerName,
				SentAt:       payload.SentAt,
				ReceivedAt:   receivedAt,
				LatencyMs:    latencyMs,
				LatencyNanos: latency.Nanoseconds(),
				Topic:        record.Topic,
				Partition:    record.Partition,
				Offset:       record.Offset,
				MessageNum:   payload.MessageNum,
			}

			// Output JSONL record to stdout
			jsonBytes, err := json.Marshal(latencyRecord)
			if err != nil {
				log.Printf("Failed to marshal latency record: %v", err)
				return
			}

			fmt.Println(string(jsonBytes))

			// Log to stderr for debugging
			fmt.Fprintf(os.Stderr, "Processed: %s, Latency: %.3f ms [%d total]\n", 
				payload.ID, latencyMs, messageCount)
		})
	}

	fmt.Fprintf(os.Stderr, "Coordinated Consumer %d completed! Processed %d messages from %d producers.\n", 
		consumerID, messageCount, len(seenProducers))
} 