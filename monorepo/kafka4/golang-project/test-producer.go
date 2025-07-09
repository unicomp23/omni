package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
)

func main() {
	// Kafka connection details
	brokers := []string{"kafka4:29092"}
	topic := "test-topic"

	// Create a new Kafka client
	client, err := kgo.NewClient(
		kgo.SeedBrokers(brokers...),
		kgo.DefaultProduceTopic(topic),
	)
	if err != nil {
		log.Fatalf("Failed to create kafka client: %v", err)
	}
	defer client.Close()

	// Send messages
	for i := 0; i < 5; i++ {
		message := fmt.Sprintf("Franz-Go Producer Message %d - %s", i+1, time.Now().Format(time.RFC3339))
		key := fmt.Sprintf("key-%d", i+1)
		
		// Create a record to produce
		record := &kgo.Record{
			Topic: topic,
			Key:   []byte(key),
			Value: []byte(message),
		}
		
		// Produce the message
		client.Produce(context.Background(), record, func(r *kgo.Record, err error) {
			if err != nil {
				log.Printf("Failed to send message %d: %v", i+1, err)
			} else {
				fmt.Printf("Sent: %s (partition: %d, offset: %d)\n", message, r.Partition, r.Offset)
			}
		})
		
		time.Sleep(1 * time.Second)
	}

	// Flush any remaining messages
	if err := client.Flush(context.Background()); err != nil {
		log.Printf("Failed to flush messages: %v", err)
	}

	fmt.Println("All messages sent successfully!")
} 