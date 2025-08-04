package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/kmsg"
)

// Option 2: Partition Metadata Refresh Approach
// This approach forces metadata refresh which can trigger consumer rebalancing
// when combined with consumer group changes

type PartitionRebalancer struct {
	client    *kgo.Client
	topicName string
	interval  time.Duration
}

func NewPartitionRebalancer() (*PartitionRebalancer, error) {
	brokers := getBrokersForPartition()

	// Create admin client
	client, err := kgo.NewClient(kgo.SeedBrokers(brokers...))
	if err != nil {
		return nil, fmt.Errorf("failed to create admin client: %v", err)
	}

	// Get rebalance interval from environment or use default
	interval := 1 * time.Hour
	if intervalEnv := os.Getenv("REBALANCE_INTERVAL_MINUTES"); intervalEnv != "" {
		if minutes, err := strconv.Atoi(intervalEnv); err == nil {
			interval = time.Duration(minutes) * time.Minute
		}
	}

	return &PartitionRebalancer{
		client:    client,
		topicName: "loadtest-topic",
		interval:  interval,
	}, nil
}

func (pr *PartitionRebalancer) Start(ctx context.Context) {
	log.Printf("🔄 Partition rebalancer started - will trigger rebalance every %v", pr.interval)

	ticker := time.NewTicker(pr.interval)
	defer ticker.Stop()

	// Initial delay to let the main load test stabilize
	initialTimer := time.NewTimer(2 * time.Minute)
	defer initialTimer.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Printf("🔄 Partition rebalancer stopping...")
			pr.client.Close()
			return
		case <-initialTimer.C:
			log.Printf("🔄 Triggering initial partition rebalance...")
			pr.triggerMetadataRefresh(ctx)
		case <-ticker.C:
			log.Printf("🔄 Triggering scheduled partition rebalance...")
			pr.triggerMetadataRefresh(ctx)
		}
	}
}

func (pr *PartitionRebalancer) triggerMetadataRefresh(ctx context.Context) {
	log.Printf("🔄 Forcing metadata refresh to encourage rebalancing...")

	// Method 1: Force metadata refresh by requesting topic metadata
	metaReq := kmsg.NewMetadataRequest()
	metaReq.Topics = []kmsg.MetadataRequestTopic{{Topic: &pr.topicName}}

	metaResp, err := metaReq.RequestWith(ctx, pr.client)
	if err != nil {
		log.Printf("❌ Failed to request metadata: %v", err)
		return
	}

	// Log current topic state
	for _, topic := range metaResp.Topics {
		if topic.Topic != nil && *topic.Topic == pr.topicName {
			log.Printf("🔍 Topic %s has %d partitions", pr.topicName, len(topic.Partitions))
			for _, partition := range topic.Partitions {
				log.Printf("  Partition %d: Leader=%d, Replicas=%v",
					partition.Partition, partition.Leader, partition.Replicas)
			}
		}
	}

	// Method 2: Create a brief consumer that will trigger group coordinator interaction
	pr.triggerConsumerGroupInteraction(ctx)

	log.Printf("✅ Metadata refresh completed")
}

func (pr *PartitionRebalancer) triggerConsumerGroupInteraction(ctx context.Context) {
	log.Printf("🔄 Creating brief consumer interaction to trigger coordinator refresh...")

	// Create a very short-lived consumer to interact with group coordinator
	opts := []kgo.Opt{
		kgo.SeedBrokers(getBrokersForPartition()...),
		kgo.ConsumeTopics(pr.topicName),
		kgo.ConsumerGroup("loadtest-group-metadata-trigger"),
		kgo.ConsumeResetOffset(kgo.NewOffset().AtEnd()),

		// Very short timeouts for quick interaction
		kgo.SessionTimeout(6 * time.Second),
		kgo.HeartbeatInterval(2 * time.Second),
		kgo.RebalanceTimeout(10 * time.Second),
		kgo.MetadataMaxAge(5 * time.Second),
	}

	client, err := kgo.NewClient(opts...)
	if err != nil {
		log.Printf("❌ Failed to create metadata trigger consumer: %v", err)
		return
	}
	defer client.Close()

	// Very brief interaction - just join and immediately leave
	interactionCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	// Single poll to join the group
	fetches := client.PollFetches(interactionCtx)
	if errs := fetches.Errors(); len(errs) > 0 {
		for _, err := range errs {
			if !strings.Contains(err.Err.Error(), "context") {
				log.Printf("⚠️  Metadata trigger error (expected): %v", err)
			}
		}
	}

	// Close immediately to leave the group
	client.Close()
	log.Printf("✅ Group coordinator interaction completed")
}

// Helper function to get brokers (renamed to avoid conflicts)
func getBrokersForPartition() []string {
	if brokersEnv := os.Getenv("REDPANDA_BROKERS"); brokersEnv != "" {
		return strings.Split(brokersEnv, ",")
	}
	// Fallback to hardcoded brokers
	return []string{"10.1.0.217:9092", "10.1.1.237:9092", "10.1.2.12:9092"}
}

func main() {
	log.Printf("🚀 Starting Redpanda Partition Rebalancer Service")

	rebalancer, err := NewPartitionRebalancer()
	if err != nil {
		log.Fatalf("❌ Failed to create partition rebalancer: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	rebalancer.Start(ctx)
}
