package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
)

type MessagePayload struct {
	ID        string    `json:"id"`
	Content   string    `json:"content"`
	SentAt    time.Time `json:"sent_at"`
	Producer  string    `json:"producer"`
}

func main() {
	// Create Kafka client
	client, err := kgo.NewClient(
		kgo.SeedBrokers("kafka4:29092"),
		kgo.ClientID("go-latency-producer"),
	)
	if err != nil {
		log.Fatalf("Failed to create client: %v", err)
	}
	defer client.Close()

	ctx := context.Background()
	topic := "latency-topic"

	fmt.Println("Starting Go Latency Producer...")
	fmt.Printf("Producer: %s\n", "go-latency-producer")
	fmt.Printf("Topic: %s\n", topic)

	// Send messages with timestamps
	for i := 1; i <= 10; i++ {
		payload := MessagePayload{
			ID:       fmt.Sprintf("go-msg-%d", i),
			Content:  fmt.Sprintf("Go latency test message %d", i),
			SentAt:   time.Now().UTC(),
			Producer: "go-latency-producer",
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

		fmt.Printf("Sent: %s at %s\n", payload.ID, payload.SentAt.Format(time.RFC3339Nano))
		
		// Small delay between messages
		time.Sleep(500 * time.Millisecond)
	}

	fmt.Println("Go Latency Producer completed!")
} 