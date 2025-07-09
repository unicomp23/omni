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

func main() {
	topic := os.Getenv("GO_LATENCY_TOPIC")
	if topic == "" {
		topic = "latency-topic"
	}

	// Get producer configuration from environment
	producerID := 1
	if idStr := os.Getenv("PRODUCER_ID"); idStr != "" {
		if id, err := strconv.Atoi(idStr); err == nil {
			producerID = id
		}
	}

	messageCount := 10
	if countStr := os.Getenv("MESSAGE_COUNT"); countStr != "" {
		if count, err := strconv.Atoi(countStr); err == nil {
			messageCount = count
		}
	}

	spacingMs := 500
	if spacingStr := os.Getenv("MESSAGE_SPACING_MS"); spacingStr != "" {
		if spacing, err := strconv.Atoi(spacingStr); err == nil {
			spacingMs = spacing
		}
	}

	// Create Kafka client
	client, err := kgo.NewClient(
		kgo.SeedBrokers("kafka4:29092"),
		kgo.ClientID(fmt.Sprintf("coordinated-producer-%d", producerID)),
	)
	if err != nil {
		log.Fatalf("Failed to create client: %v", err)
	}
	defer client.Close()

	ctx := context.Background()
	producerName := fmt.Sprintf("coordinated-producer-%d", producerID)

	fmt.Fprintf(os.Stderr, "Starting Coordinated Producer %d...\n", producerID)
	fmt.Fprintf(os.Stderr, "Producer: %s\n", producerName)
	fmt.Fprintf(os.Stderr, "Topic: %s\n", topic)
	fmt.Fprintf(os.Stderr, "Messages: %d\n", messageCount)
	fmt.Fprintf(os.Stderr, "Spacing: %dms\n", spacingMs)
	fmt.Fprintf(os.Stderr, "Expected duration: %dms\n", messageCount*spacingMs)
	fmt.Fprintf(os.Stderr, "---\n")

	startTime := time.Now()

	// Send messages with configured spacing
	for i := 1; i <= messageCount; i++ {
		payload := MessagePayload{
			ID:         fmt.Sprintf("prod-%d-msg-%d", producerID, i),
			Content:    fmt.Sprintf("Producer %d message %d", producerID, i),
			SentAt:     time.Now().UTC(),
			Producer:   producerName,
			ProducerID: producerID,
			MessageNum: i,
			TotalMsgs:  messageCount,
			SpacingMs:  spacingMs,
		}

		payloadBytes, err := json.Marshal(payload)
		if err != nil {
			log.Printf("Failed to marshal payload: %v", err)
			continue
		}

		record := &kgo.Record{
			Topic: topic,
			Key:   []byte(payload.ID),
			Value: payloadBytes,
		}

		// Send the record
		if err := client.ProduceSync(ctx, record).FirstErr(); err != nil {
			log.Printf("Failed to produce record: %v", err)
			continue
		}

		fmt.Fprintf(os.Stderr, "Sent: %s at %s [%d/%d]\n", 
			payload.ID, payload.SentAt.Format(time.RFC3339Nano), i, messageCount)

		// Wait for spacing (except after last message)
		if i < messageCount {
			time.Sleep(time.Duration(spacingMs) * time.Millisecond)
		}
	}

	duration := time.Since(startTime)
	fmt.Fprintf(os.Stderr, "Producer %d completed! Sent %d messages in %v\n", 
		producerID, messageCount, duration)
} 