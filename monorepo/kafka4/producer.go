package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
)

type MessageWithTimestamp struct {
	ID        string    `json:"id"`
	Timestamp time.Time `json:"timestamp"`
	Payload   string    `json:"payload"`
}

type Producer struct {
	client *kgo.Client
	topic  string
}

func NewProducer(brokers []string, topic string) (*Producer, error) {
	client, err := kgo.NewClient(
		kgo.SeedBrokers(brokers...),
		kgo.DefaultProduceTopic(topic),
		kgo.RequiredAcks(kgo.AllISRAcks()),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create kafka client: %w", err)
	}

	return &Producer{
		client: client,
		topic:  topic,
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

	results := p.client.ProduceSync(ctx, record)
	if err := results.FirstErr(); err != nil {
		return fmt.Errorf("failed to produce message: %w", err)
	}

	log.Printf("[%s] Produced message with ID: %s at %s", 
		time.Now().Format(time.RFC3339), id, msg.Timestamp.Format(time.RFC3339Nano))
	return nil
}

func (p *Producer) Close() {
	p.client.Close()
}

func (p *Producer) ProduceMessages(ctx context.Context, count int, interval time.Duration) error {
	startTime := time.Now()
	log.Printf("[%s] 🚀 Starting to produce %d messages with %v interval", 
		startTime.Format(time.RFC3339), count, interval)
	
	sentCount := 0
	progressInterval := count/20 // Show progress every 5%
	if progressInterval < 1 {
		progressInterval = 1
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

		id := fmt.Sprintf("msg-%d", i)
		payload := fmt.Sprintf("Test message %d", i)
		
		if err := p.SendMessage(ctx, id, payload); err != nil {
			log.Printf("[%s] ❌ Error sending message %s: %v", 
				time.Now().Format(time.RFC3339), id, err)
			continue
		}
		sentCount++

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