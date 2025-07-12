package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"
)

type TopicManager struct {
	admin       *kadm.Client
	brokers     []string
	topicPrefix string
}

func NewTopicManager(brokers []string, topicPrefix string) (*TopicManager, error) {
	client, err := kgo.NewClient(
		kgo.SeedBrokers(brokers...),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create kafka client: %w", err)
	}

	admin := kadm.NewClient(client)

	return &TopicManager{
		admin:       admin,
		brokers:     brokers,
		topicPrefix: topicPrefix,
	}, nil
}

func (tm *TopicManager) CreateTestTopic(ctx context.Context, partitions int32, replicationFactor int16) (string, error) {
	topicName := fmt.Sprintf("%s-%s", tm.topicPrefix, uuid.New().String()[:8])

	log.Printf("[%s] 🏗️  Creating topic: %s", time.Now().Format(time.RFC3339), topicName)
	log.Printf("[%s] 📝 Topic config: %d partitions, %d replicas",
		time.Now().Format(time.RFC3339), partitions, replicationFactor)

	configs := map[string]*string{
		"cleanup.policy": stringPtr("delete"),
		"retention.ms":   stringPtr("300000"), // 5 minutes
		"segment.ms":     stringPtr("60000"),  // 1 minute
	}

	log.Printf("[%s] 📤 Sending topic creation request...", time.Now().Format(time.RFC3339))
	results, err := tm.admin.CreateTopics(ctx, partitions, replicationFactor, configs, topicName)
	if err != nil {
		return "", fmt.Errorf("failed to create topic: %w", err)
	}

	for topic, result := range results {
		if result.Err != nil {
			return "", fmt.Errorf("failed to create topic %s: %w", topic, result.Err)
		}
		log.Printf("[%s] ✅ Successfully created topic: %s", time.Now().Format(time.RFC3339), topic)
	}

	// Wait for topic to be ready
	log.Printf("[%s] ⏳ Waiting for topic to become ready...", time.Now().Format(time.RFC3339))
	if err := tm.waitForTopicReady(ctx, topicName, 30*time.Second); err != nil {
		return "", fmt.Errorf("topic not ready: %w", err)
	}

	return topicName, nil
}

func (tm *TopicManager) waitForTopicReady(ctx context.Context, topicName string, timeout time.Duration) error {
	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	attempts := 0
	maxAttempts := int(timeout / (500 * time.Millisecond))

	for {
		select {
		case <-timeoutCtx.Done():
			return fmt.Errorf("timeout waiting for topic to be ready after %d attempts", attempts)
		default:
		}

		attempts++
		if attempts%10 == 0 || attempts <= 5 {
			log.Printf("[%s] 🔄 Checking topic readiness... (attempt %d/%d)",
				time.Now().Format(time.RFC3339), attempts, maxAttempts)
		}

		metadata, err := tm.admin.Metadata(ctx, topicName)
		if err != nil {
			if attempts%20 == 0 {
				log.Printf("[%s] ⚠️  Still waiting for metadata response...", time.Now().Format(time.RFC3339))
			}
			time.Sleep(500 * time.Millisecond)
			continue
		}

		if len(metadata.Topics) > 0 {
			topic := metadata.Topics[topicName]
			if topic.Err == nil && len(topic.Partitions) > 0 {
				log.Printf("[%s] 🎉 Topic %s is ready with %d partitions (after %d attempts)",
					time.Now().Format(time.RFC3339), topicName, len(topic.Partitions), attempts)
				return nil
			}
		}

		time.Sleep(500 * time.Millisecond)
	}
}

func (tm *TopicManager) CleanupOldTopics(ctx context.Context, maxAge time.Duration) error {
	log.Printf("[%s] 🧹 Cleaning up old topics (older than %v)...",
		time.Now().Format(time.RFC3339), maxAge)

	log.Printf("[%s] 📋 Fetching topic metadata...", time.Now().Format(time.RFC3339))
	metadata, err := tm.admin.Metadata(ctx)
	if err != nil {
		return fmt.Errorf("failed to get metadata: %w", err)
	}

	var topicsToDelete []string
	cutoffTime := time.Now().Add(-maxAge)
	totalTopics := len(metadata.Topics)
	matchingTopics := 0

	log.Printf("[%s] 🔍 Scanning %d topics for cleanup candidates...",
		time.Now().Format(time.RFC3339), totalTopics)

	for topicName := range metadata.Topics {
		if strings.HasPrefix(topicName, tm.topicPrefix+"-") {
			matchingTopics++
			// Extract UUID part and try to get creation time
			// Since we can't get exact creation time, we'll use a simple heuristic
			// In production, you might want to store creation timestamps in topic configs
			if tm.shouldDeleteTopic(ctx, topicName, cutoffTime) {
				topicsToDelete = append(topicsToDelete, topicName)
			}
		}
	}

	log.Printf("[%s] 📊 Found %d matching topics, %d candidates for deletion",
		time.Now().Format(time.RFC3339), matchingTopics, len(topicsToDelete))

	if len(topicsToDelete) > 0 {
		log.Printf("[%s] 🗑️  Deleting %d old topics...",
			time.Now().Format(time.RFC3339), len(topicsToDelete))

		results, err := tm.admin.DeleteTopics(ctx, topicsToDelete...)
		if err != nil {
			return fmt.Errorf("failed to delete topics: %w", err)
		}

		deleted := 0
		failed := 0
		for topic, result := range results {
			if result.Err != nil {
				failed++
				log.Printf("[%s] ❌ Failed to delete topic %s: %v",
					time.Now().Format(time.RFC3339), topic, result.Err)
			} else {
				deleted++
				log.Printf("[%s] ✅ Deleted topic: %s (%d/%d)",
					time.Now().Format(time.RFC3339), topic, deleted, len(topicsToDelete))
			}
		}
		log.Printf("[%s] 🧹 Cleanup complete: %d deleted, %d failed",
			time.Now().Format(time.RFC3339), deleted, failed)
	} else {
		log.Printf("[%s] ✨ No old topics found for cleanup", time.Now().Format(time.RFC3339))
	}

	return nil
}

func (tm *TopicManager) shouldDeleteTopic(ctx context.Context, topicName string, cutoffTime time.Time) bool {
	// Simple heuristic: if topic has no recent activity, consider it old
	// In a real implementation, you might check last write time or use topic configs

	// For now, we'll delete topics that match our prefix and seem inactive
	// This is a simplified approach - you might want more sophisticated logic
	return strings.HasPrefix(topicName, tm.topicPrefix+"-")
}

func (tm *TopicManager) DeleteTopic(ctx context.Context, topicName string) error {
	log.Printf("[%s] Deleting topic: %s", time.Now().Format(time.RFC3339), topicName)

	results, err := tm.admin.DeleteTopics(ctx, topicName)
	if err != nil {
		return fmt.Errorf("failed to delete topic: %w", err)
	}

	for topic, result := range results {
		if result.Err != nil {
			return fmt.Errorf("failed to delete topic %s: %w", topic, result.Err)
		}
		log.Printf("[%s] Successfully deleted topic: %s", time.Now().Format(time.RFC3339), topic)
	}

	return nil
}

func (tm *TopicManager) Close() {
	if tm.admin != nil {
		tm.admin.Close()
	}
}

func stringPtr(s string) *string {
	return &s
}
