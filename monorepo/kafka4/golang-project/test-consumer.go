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
	groupID := "test-consumer-group"

	// Create a new Kafka client for consuming
	client, err := kgo.NewClient(
		kgo.SeedBrokers(brokers...),
		kgo.ConsumerGroup(groupID),
		kgo.ConsumeTopics(topic),
		kgo.ConsumeResetOffset(kgo.NewOffset().AtStart()), // Start from beginning
	)
	if err != nil {
		log.Fatalf("Failed to create kafka client: %v", err)
	}
	defer client.Close()

	fmt.Printf("Consumer starting, reading from topic: %s\n", topic)
	
	// Set a timeout context
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Read messages
	messageCount := 0
	for {
		// Poll for messages
		fetches := client.PollFetches(ctx)
		if errs := fetches.Errors(); len(errs) > 0 {
			// Check if context timeout
			if ctx.Err() != nil {
				fmt.Printf("Context timeout reached. Read %d messages.\n", messageCount)
				break
			}
			
			for _, err := range errs {
				log.Printf("Fetch error: %v", err)
			}
			continue
		}

		// Process messages
		fetches.EachPartition(func(p kgo.FetchTopicPartition) {
			for _, record := range p.Records {
				messageCount++
				fmt.Printf("Message #%d:\n", messageCount)
				fmt.Printf("  Topic: %s\n", record.Topic)
				fmt.Printf("  Partition: %d\n", record.Partition)
				fmt.Printf("  Offset: %d\n", record.Offset)
				fmt.Printf("  Key: %s\n", string(record.Key))
				fmt.Printf("  Value: %s\n", string(record.Value))
				fmt.Printf("  Timestamp: %s\n", record.Timestamp.Format(time.RFC3339))
				fmt.Println("  ---")
			}
		})

		// Break if no messages and context deadline approached
		if fetches.NumRecords() == 0 {
			select {
			case <-ctx.Done():
				fmt.Printf("Timeout reached. Read %d messages.\n", messageCount)
				return
			default:
				// Continue polling
				time.Sleep(100 * time.Millisecond)
			}
		}
	}

	fmt.Printf("Consumer completed. Total messages read: %d\n", messageCount)
} 