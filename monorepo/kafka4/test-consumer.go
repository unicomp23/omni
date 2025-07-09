package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/segmentio/kafka-go"
)

func main() {
	// Kafka connection details
	brokers := []string{"kafka4:29092"}
	topic := "test-topic"
	groupID := "test-consumer-group"

	// Create a reader (consumer)
	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:  brokers,
		Topic:    topic,
		GroupID:  groupID,
		MinBytes: 10e3, // 10KB
		MaxBytes: 10e6, // 10MB
	})
	defer reader.Close()

	fmt.Printf("Consumer starting, reading from topic: %s\n", topic)
	
	// Set a timeout context
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Read messages
	messageCount := 0
	for {
		message, err := reader.FetchMessage(ctx)
		if err != nil {
			if err == context.DeadlineExceeded {
				fmt.Printf("Timeout reached. Read %d messages.\n", messageCount)
				break
			}
			log.Printf("Error reading message: %v", err)
			break
		}

		fmt.Printf("Received - Key: %s, Value: %s, Partition: %d, Offset: %d\n",
			string(message.Key), string(message.Value), message.Partition, message.Offset)
		
		// Commit the message
		err = reader.CommitMessages(context.Background(), message)
		if err != nil {
			log.Printf("Error committing message: %v", err)
		}
		
		messageCount++
	}
	
	fmt.Printf("Consumer completed successfully! Read %d messages.\n", messageCount)
} 