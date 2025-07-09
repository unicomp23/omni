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

	// Create a writer (producer)
	writer := kafka.Writer{
		Addr:     kafka.TCP(brokers...),
		Topic:    topic,
		Balancer: &kafka.LeastBytes{},
	}
	defer writer.Close()

	// Send messages
	for i := 0; i < 5; i++ {
		message := fmt.Sprintf("Go Producer Message %d - %s", i+1, time.Now().Format(time.RFC3339))
		
		err := writer.WriteMessages(context.Background(),
			kafka.Message{
				Key:   []byte(fmt.Sprintf("key-%d", i+1)),
				Value: []byte(message),
			},
		)
		
		if err != nil {
			log.Printf("Failed to write message %d: %v", i+1, err)
		} else {
			fmt.Printf("Sent: %s\n", message)
		}
		
		time.Sleep(1 * time.Second)
	}
	
	fmt.Println("Producer completed successfully!")
} 