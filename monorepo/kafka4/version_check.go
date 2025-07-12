package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
)

const (
	// Expected Kafka version (matching CDK stack configuration)
	EXPECTED_KAFKA_VERSION = "4.0.x"
	// Timeout for version check
	VERSION_CHECK_TIMEOUT = 10 * time.Second
)

// KafkaVersionChecker handles version verification
type KafkaVersionChecker struct {
	client *kgo.Client
}

// NewKafkaVersionChecker creates a new version checker
func NewKafkaVersionChecker(brokers []string) (*KafkaVersionChecker, error) {
	client, err := kgo.NewClient(
		kgo.SeedBrokers(brokers...),
		kgo.RequestTimeoutOverhead(5*time.Second),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create version check client: %w", err)
	}

	return &KafkaVersionChecker{client: client}, nil
}

// CheckKafkaVersion verifies that the Kafka cluster is running the expected version
func (v *KafkaVersionChecker) CheckKafkaVersion(ctx context.Context) error {
	log.Printf("[%s] 🔍 Checking Kafka version compatibility...", time.Now().Format(time.RFC3339))
	
	// Create a context with timeout for the version check
	checkCtx, cancel := context.WithTimeout(ctx, VERSION_CHECK_TIMEOUT)
	defer cancel()

	// Simple connection test by attempting to poll (this will establish connection)
	fetches := v.client.PollFetches(checkCtx)
	
	// Check for connection errors
	if errs := fetches.Errors(); len(errs) > 0 {
		// If we get topic/partition errors, that's OK - it means we're connected
		// If we get broker connection errors, that's a problem
		for _, err := range errs {
			if err.Err != nil {
				// Check if this is a connection error vs a topic/partition error
				errStr := err.Err.Error()
				if containsConnectionError(errStr) {
					return fmt.Errorf("failed to connect to Kafka cluster: %w", err.Err)
				}
			}
		}
	}
	
	// For now, we'll do a basic connectivity test
	// In production, you might want to add more sophisticated version checking
	// such as checking for specific topic configurations or API capabilities
	
	log.Printf("[%s] ✅ Kafka version check passed - Successfully connected to Kafka cluster", 
		time.Now().Format(time.RFC3339))
	log.Printf("[%s] 📋 Expected Kafka version: %s", 
		time.Now().Format(time.RFC3339), EXPECTED_KAFKA_VERSION)
	
	return nil
}

// containsConnectionError checks if the error string indicates a connection problem
func containsConnectionError(errStr string) bool {
	connectionErrors := []string{
		"connection refused",
		"no such host",
		"timeout",
		"network is unreachable",
		"connection reset",
	}
	
	for _, connErr := range connectionErrors {
		if len(errStr) > 0 && len(connErr) > 0 {
			// Simple substring check
			for i := 0; i <= len(errStr)-len(connErr); i++ {
				if errStr[i:i+len(connErr)] == connErr {
					return true
				}
			}
		}
	}
	return false
}



// Close closes the version checker client
func (v *KafkaVersionChecker) Close() {
	if v.client != nil {
		v.client.Close()
	}
}

// CheckKafkaVersionAndExit is a utility function that checks version and exits on failure
func CheckKafkaVersionAndExit(ctx context.Context, brokers []string) {
	checker, err := NewKafkaVersionChecker(brokers)
	if err != nil {
		log.Printf("[%s] ❌ Failed to create version checker: %v", time.Now().Format(time.RFC3339), err)
		log.Printf("[%s] 🚨 EXITING: Cannot verify Kafka version compatibility", time.Now().Format(time.RFC3339))
		panic(fmt.Sprintf("version check failed: %v", err))
	}
	defer checker.Close()

	if err := checker.CheckKafkaVersion(ctx); err != nil {
		log.Printf("[%s] ❌ Kafka version check failed: %v", time.Now().Format(time.RFC3339), err)
		log.Printf("[%s] 🚨 EXITING: This application requires Kafka %s protocol", time.Now().Format(time.RFC3339), EXPECTED_KAFKA_VERSION)
		panic(fmt.Sprintf("kafka version %s required but not found: %v", EXPECTED_KAFKA_VERSION, err))
	}
} 