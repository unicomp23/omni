package main

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
)

const (
	rebalanceInterval = 1 * time.Hour    // Trigger rebalance every hour
	consumerLifetime  = 30 * time.Second // How long the temporary consumer stays alive
)

type RebalanceTrigger struct {
	brokers       []string
	topicName     string
	consumerGroup string
}

func NewRebalanceTrigger() *RebalanceTrigger {
	brokers := getBrokers() // Use the same broker discovery as main.go

	return &RebalanceTrigger{
		brokers:       brokers,
		topicName:     "loadtest-topic", // Match your topic name
		consumerGroup: "loadtest-group", // Match your consumer group
	}
}

func (rt *RebalanceTrigger) Start(ctx context.Context) {
	log.Printf("🔄 Rebalance trigger started - will trigger rebalance every %v", rebalanceInterval)

	ticker := time.NewTicker(rebalanceInterval)
	defer ticker.Stop()

	// Trigger initial rebalance after 1 minute (to let main load test stabilize)
	initialTimer := time.NewTimer(1 * time.Minute)
	defer initialTimer.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Printf("🔄 Rebalance trigger stopping...")
			return
		case <-initialTimer.C:
			log.Printf("🔄 Triggering initial rebalance...")
			rt.triggerRebalance(ctx)
		case <-ticker.C:
			log.Printf("🔄 Triggering scheduled rebalance...")
			rt.triggerRebalance(ctx)
		}
	}
}

func (rt *RebalanceTrigger) triggerRebalance(ctx context.Context) {
	// Create a temporary consumer that joins the group briefly, then leaves
	// This forces the consumer group to rebalance

	log.Printf("🔄 Creating temporary consumer to trigger rebalance...")

	// Consumer client with same group but different client ID
	opts := []kgo.Opt{
		kgo.SeedBrokers(rt.brokers...),
		kgo.ConsumeTopics(rt.topicName),
		kgo.ConsumerGroup(rt.consumerGroup + "-rebalance-trigger"),
		kgo.ConsumeResetOffset(kgo.NewOffset().AtEnd()),

		// Use similar settings to main consumers but shorter timeouts
		kgo.SessionTimeout(6 * time.Second),
		kgo.HeartbeatInterval(2 * time.Second),
		kgo.RebalanceTimeout(15 * time.Second),

		// Quick metadata refresh
		kgo.MetadataMaxAge(10 * time.Second),
	}

	client, err := kgo.NewClient(opts...)
	if err != nil {
		log.Printf("❌ Failed to create rebalance trigger consumer: %v", err)
		return
	}
	defer client.Close()

	// Create a context with timeout for this specific rebalance operation
	rebalanceCtx, cancel := context.WithTimeout(ctx, consumerLifetime+10*time.Second)
	defer cancel()

	log.Printf("🔄 Temporary consumer joining group (will stay for %v)...", consumerLifetime)

	// Start consuming briefly to join the group
	go func() {
		for {
			select {
			case <-rebalanceCtx.Done():
				return
			default:
				fetches := client.PollFetches(rebalanceCtx)
				if errs := fetches.Errors(); len(errs) > 0 {
					// Ignore context cancellation errors
					for _, err := range errs {
						if !strings.Contains(err.Err.Error(), "context") {
							log.Printf("⚠️  Rebalance trigger consumer error: %v", err)
						}
					}
				}
				// Don't process any messages, just stay in the group
			}
		}
	}()

	// Stay in the group for the specified lifetime
	select {
	case <-time.After(consumerLifetime):
		log.Printf("🔄 Temporary consumer leaving group to trigger rebalance...")
	case <-rebalanceCtx.Done():
		log.Printf("🔄 Rebalance operation cancelled")
		return
	}

	// Close the client to leave the group, triggering rebalance
	client.Close()
	log.Printf("✅ Rebalance triggered successfully")
}

func main() {
	log.Printf("🚀 Starting Redpanda Rebalance Trigger Service")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	trigger := NewRebalanceTrigger()
	trigger.Start(ctx)
}

// Helper function to get brokers (same as main.go)
func getBrokers() []string {
	if brokersEnv := os.Getenv("REDPANDA_BROKERS"); brokersEnv != "" {
		return strings.Split(brokersEnv, ",")
	}
	// Fallback to hardcoded brokers
	return []string{"10.1.0.217:9092", "10.1.1.237:9092", "10.1.2.12:9092"}
}
