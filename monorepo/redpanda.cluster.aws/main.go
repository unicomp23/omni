package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/kmsg"
)

// Message represents a test message with timestamp
type Message struct {
	ID        int64  `json:"id"`
	Timestamp int64  `json:"timestamp"`
	Payload   string `json:"payload"`
}

// LatencyRecord represents a single latency measurement for JSONL output
type LatencyRecord struct {
	MessageID    int64         `json:"message_id"`
	ProducerID   int           `json:"producer_id"`
	ConsumerID   int           `json:"consumer_id"`
	ProduceTime  int64         `json:"produce_time"`
	ConsumeTime  int64         `json:"consume_time"`
	LatencyNs    int64         `json:"latency_ns"`
	LatencyMs    float64       `json:"latency_ms"`
	Topic        string        `json:"topic"`
	Partition    int32         `json:"partition"`
	Offset       int64         `json:"offset"`
	Timestamp    time.Time     `json:"timestamp"`
}

// LoadTest configuration and state
type LoadTest struct {
	brokers        []string
	baseTopic      string
	topic          string
	totalMessages  int64
	producerRate   int // total messages per second across all producers
	numProducers   int
	numConsumerWorkers int
	messageSize    int
	
	// Clients
	producerClients []*kgo.Client
	consumerClients []*kgo.Client
	adminClient     *kgo.Client // Added for topic management
	
	// Synchronization
	messageCounter int64
	completedMessages int64
	
	// Output
	jsonlFile *os.File
	jsonlMutex sync.Mutex
	
	// Metrics
	startTime time.Time
	endTime   time.Time
}

// generateUUID generates a simple UUID for topic naming
func generateUUID() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)[:8]
}

// listTopics lists all topics matching the pattern
func (lt *LoadTest) listTopics() ([]string, error) {
	req := kmsg.NewPtrMetadataRequest()
	shards := lt.adminClient.RequestSharded(context.Background(), req)
	
	var topics []string
	for _, shard := range shards {
		if shard.Err != nil {
			return nil, fmt.Errorf("metadata request failed: %w", shard.Err)
		}
		
		resp := shard.Resp.(*kmsg.MetadataResponse)
		for _, topic := range resp.Topics {
			if topic.Topic != nil && strings.HasPrefix(*topic.Topic, lt.baseTopic+"-") {
				topics = append(topics, *topic.Topic)
			}
		}
	}
	
	return topics, nil
}

// createTopic creates a new topic with optimized settings for latency
func (lt *LoadTest) createTopic() error {
	log.Printf("Creating topic: %s", lt.topic)
	
	req := kmsg.NewPtrCreateTopicsRequest()
	req.TimeoutMillis = 30000
	
	topicReq := kmsg.NewCreateTopicsRequestTopic()
	topicReq.Topic = lt.topic
	topicReq.NumPartitions = 36  // 36 partitions for better distribution
	topicReq.ReplicationFactor = 3
	
	// Optimize for latency
	configs := []kmsg.CreateTopicsRequestTopicConfig{
		{Name: "min.insync.replicas", Value: kmsg.StringPtr("2")},
		{Name: "unclean.leader.election.enable", Value: kmsg.StringPtr("false")},
		{Name: "retention.ms", Value: kmsg.StringPtr("3600000")}, // 1 hour
		{Name: "segment.ms", Value: kmsg.StringPtr("60000")},     // 1 minute
		{Name: "flush.ms", Value: kmsg.StringPtr("100")},         // Fast flush for latency
		{Name: "compression.type", Value: kmsg.StringPtr("lz4")}, // Fast compression
	}
	topicReq.Configs = configs
	
	req.Topics = []kmsg.CreateTopicsRequestTopic{topicReq}
	
	shards := lt.adminClient.RequestSharded(context.Background(), req)
	for _, shard := range shards {
		if shard.Err != nil {
			return fmt.Errorf("create topic request failed: %w", shard.Err)
		}
		
		resp := shard.Resp.(*kmsg.CreateTopicsResponse)
		for _, topic := range resp.Topics {
			if topic.ErrorCode != 0 {
				if topic.ErrorCode == 36 { // TOPIC_ALREADY_EXISTS
					log.Printf("Topic %s already exists", lt.topic)
					return nil
				}
				return fmt.Errorf("failed to create topic %s: error code %d", lt.topic, topic.ErrorCode)
			}
		}
	}
	
	log.Printf("Topic %s created successfully", lt.topic)
	return nil
}

// cleanupOldTopics deletes old topics matching the pattern
func (lt *LoadTest) cleanupOldTopics() error {
	log.Printf("Cleaning up old topics with pattern: %s-*", lt.baseTopic)
	
	topics, err := lt.listTopics()
	if err != nil {
		return fmt.Errorf("failed to list topics: %w", err)
	}
	
	// Filter out the current topic
	var topicsToDelete []string
	for _, topic := range topics {
		if topic != lt.topic {
			topicsToDelete = append(topicsToDelete, topic)
		}
	}
	
	if len(topicsToDelete) == 0 {
		log.Printf("No old topics to cleanup")
		return nil
	}
	
	log.Printf("Found %d old topics to cleanup: %v", len(topicsToDelete), topicsToDelete)
	
	req := kmsg.NewPtrDeleteTopicsRequest()
	req.TimeoutMillis = 30000
	
	for _, topic := range topicsToDelete {
		topicReq := kmsg.NewDeleteTopicsRequestTopic()
		topicReq.Topic = &topic
		req.Topics = append(req.Topics, topicReq)
	}
	
	shards := lt.adminClient.RequestSharded(context.Background(), req)
	for _, shard := range shards {
		if shard.Err != nil {
			return fmt.Errorf("delete topics request failed: %w", shard.Err)
		}
		
		resp := shard.Resp.(*kmsg.DeleteTopicsResponse)
		for _, topic := range resp.Topics {
			if topic.ErrorCode != 0 {
				log.Printf("Failed to delete topic %s: error code %d", *topic.Topic, topic.ErrorCode)
			} else {
				log.Printf("Deleted topic: %s", *topic.Topic)
			}
		}
	}
	
	return nil
}

// cleanup closes all clients and resources
func (lt *LoadTest) cleanup() {
	// Close producer clients
	for _, client := range lt.producerClients {
		if client != nil {
			client.Close()
		}
	}
	
	// Close consumer clients
	for _, client := range lt.consumerClients {
		if client != nil {
			client.Close()
		}
	}
	
	// Close admin client
	if lt.adminClient != nil {
		lt.adminClient.Close()
	}
	
	// Close JSONL file
	if lt.jsonlFile != nil {
		lt.jsonlFile.Close()
	}
}

func NewLoadTest() *LoadTest {
	// Parse brokers from environment variable
	brokersEnv := os.Getenv("REDPANDA_BROKERS")
	if brokersEnv == "" {
		brokersEnv = "localhost:9092"
	}
	brokers := strings.Split(brokersEnv, ",")
	
	// Parse configuration
	totalMessages := int64(100000)
	if msg := os.Getenv("TOTAL_MESSAGES"); msg != "" {
		if parsed, err := strconv.ParseInt(msg, 10, 64); err == nil {
			totalMessages = parsed
		}
	}
	
	producerRate := 2000
	if rate := os.Getenv("PRODUCER_RATE"); rate != "" {
		if parsed, err := strconv.Atoi(rate); err == nil {
			producerRate = parsed
		}
	}
	
	numProducers := 10
	if producers := os.Getenv("NUM_PRODUCERS"); producers != "" {
		if parsed, err := strconv.Atoi(producers); err == nil {
			numProducers = parsed
		}
	}
	
	numConsumerWorkers := 2
	if workers := os.Getenv("NUM_CONSUMER_WORKERS"); workers != "" {
		if parsed, err := strconv.Atoi(workers); err == nil {
			numConsumerWorkers = parsed
		}
	}
	
	messageSize := 1024
	if size := os.Getenv("MESSAGE_SIZE"); size != "" {
		if parsed, err := strconv.Atoi(size); err == nil {
			messageSize = parsed
		}
	}
	
	baseTopic := os.Getenv("BASE_TOPIC")
	if baseTopic == "" {
		baseTopic = "latency-test"
	}
	
	topic := fmt.Sprintf("%s-%s", baseTopic, generateUUID())
	
	// Create JSONL output file
	jsonlFile, err := os.Create("latency_records.jsonl")
	if err != nil {
		log.Fatalf("Failed to create JSONL output file: %v", err)
	}
	
	return &LoadTest{
		brokers:            brokers,
		baseTopic:          baseTopic,
		topic:              topic,
		totalMessages:      totalMessages,
		producerRate:       producerRate,
		numProducers:       numProducers,
		numConsumerWorkers: numConsumerWorkers,
		messageSize:        messageSize,
		jsonlFile:          jsonlFile,
	}
}

func (lt *LoadTest) setupProducers() error {
	lt.producerClients = make([]*kgo.Client, lt.numProducers)
	
	for i := 0; i < lt.numProducers; i++ {
		// Optimize for latency over throughput
		opts := []kgo.Opt{
			kgo.SeedBrokers(lt.brokers...),
			kgo.DefaultProduceTopic(lt.topic),
			
			// Latency-optimized settings
			kgo.ProducerBatchMaxBytes(1024),        // Small batches
			kgo.ProducerLinger(1 * time.Millisecond), // Minimal linger
			kgo.RequiredAcks(kgo.AllISRAcks()),     // Strong consistency
			kgo.ProducerBatchCompression(kgo.NoCompression()), // No compression for latency
			kgo.MaxProduceRequestsInflightPerBroker(1), // Minimal inflight requests
			kgo.RequestTimeoutOverhead(5 * time.Second),
			kgo.ProduceRequestTimeout(10 * time.Second),
		}
		
		client, err := kgo.NewClient(opts...)
		if err != nil {
			return fmt.Errorf("failed to create producer client %d: %w", i, err)
		}
		
		lt.producerClients[i] = client
	}
	
	return nil
}

func (lt *LoadTest) setupConsumers() error {
	lt.consumerClients = make([]*kgo.Client, lt.numConsumerWorkers)
	
	for i := 0; i < lt.numConsumerWorkers; i++ {
		// Optimize for latency over throughput
		opts := []kgo.Opt{
			kgo.SeedBrokers(lt.brokers...),
			kgo.ConsumeTopics(lt.topic),
			kgo.ConsumerGroup(fmt.Sprintf("latency-test-group-%d", i)),
			kgo.ConsumeResetOffset(kgo.NewOffset().AtEnd()),
			
			// Latency-optimized settings
			kgo.FetchMaxBytes(32 * 1024),           // Smaller fetch sizes
			kgo.FetchMaxPartitionBytes(16 * 1024),  // Smaller partition fetches
			kgo.FetchMinBytes(1),                   // Fetch immediately
			kgo.FetchMaxWait(10 * time.Millisecond), // Minimal wait time
			kgo.MaxConcurrentFetches(1),            // Sequential fetches for latency
		}
		
		client, err := kgo.NewClient(opts...)
		if err != nil {
			return fmt.Errorf("failed to create consumer client %d: %w", i, err)
		}
		
		lt.consumerClients[i] = client
	}
	
	return nil
}

func (lt *LoadTest) writeLatencyRecord(record LatencyRecord) {
	lt.jsonlMutex.Lock()
	defer lt.jsonlMutex.Unlock()
	
	jsonData, err := json.Marshal(record)
	if err != nil {
		log.Printf("Failed to marshal latency record: %v", err)
		return
	}
	
	if _, err := lt.jsonlFile.Write(append(jsonData, '\n')); err != nil {
		log.Printf("Failed to write latency record: %v", err)
	}
}

func (lt *LoadTest) producer(ctx context.Context, producerID int) {
	defer func() {
		if lt.producerClients[producerID] != nil {
			lt.producerClients[producerID].Close()
		}
	}()
	
	// Rate limiting per producer
	ratePerProducer := lt.producerRate / lt.numProducers
	if ratePerProducer == 0 {
		ratePerProducer = 1
	}
	
	ticker := time.NewTicker(time.Second / time.Duration(ratePerProducer))
	defer ticker.Stop()
	
	payload := strings.Repeat("A", lt.messageSize-100) // Leave room for JSON overhead
	
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// Check if we've reached the message limit
			messageID := atomic.AddInt64(&lt.messageCounter, 1)
			if messageID > lt.totalMessages {
				return
			}
			
			msg := Message{
				ID:        messageID,
				Timestamp: time.Now().UnixNano(),
				Payload:   payload,
			}
			
			msgBytes, err := json.Marshal(msg)
			if err != nil {
				log.Printf("Producer %d: Failed to marshal message: %v", producerID, err)
				continue
			}
			
			record := &kgo.Record{
				Topic: lt.topic,
				Key:   []byte(strconv.FormatInt(messageID, 10)),
				Value: msgBytes,
			}
			
			lt.producerClients[producerID].Produce(ctx, record, func(r *kgo.Record, err error) {
				if err != nil {
					log.Printf("Producer %d: Failed to produce message %d: %v", producerID, messageID, err)
				}
			})
		}
	}
}

func (lt *LoadTest) consumer(ctx context.Context, consumerID int) {
	defer func() {
		if lt.consumerClients[consumerID] != nil {
			lt.consumerClients[consumerID].Close()
		}
	}()
	
	for {
		select {
		case <-ctx.Done():
			return
		default:
			fetches := lt.consumerClients[consumerID].PollFetches(ctx)
			if errs := fetches.Errors(); len(errs) > 0 {
				for _, err := range errs {
					log.Printf("Consumer %d error: %v", consumerID, err)
				}
				continue
			}
			
			fetches.EachPartition(func(p kgo.FetchTopicPartition) {
				for _, record := range p.Records {
					now := time.Now()
					consumeTime := now.UnixNano()
					
					var msg Message
					if err := json.Unmarshal(record.Value, &msg); err != nil {
						log.Printf("Consumer %d: Failed to unmarshal message: %v", consumerID, err)
						continue
					}
					
					latencyNs := consumeTime - msg.Timestamp
					latencyMs := float64(latencyNs) / 1000000.0
					
					latencyRecord := LatencyRecord{
						MessageID:   msg.ID,
						ProducerID:  -1, // We don't track individual producer IDs in messages
						ConsumerID:  consumerID,
						ProduceTime: msg.Timestamp,
						ConsumeTime: consumeTime,
						LatencyNs:   latencyNs,
						LatencyMs:   latencyMs,
						Topic:       record.Topic,
						Partition:   record.Partition,
						Offset:      record.Offset,
						Timestamp:   now,
					}
					
					lt.writeLatencyRecord(latencyRecord)
					
					// Track completion
					completed := atomic.AddInt64(&lt.completedMessages, 1)
					if completed >= lt.totalMessages {
						return
					}
				}
			})
		}
	}
}

func (lt *LoadTest) reportProgress(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			produced := atomic.LoadInt64(&lt.messageCounter)
			consumed := atomic.LoadInt64(&lt.completedMessages)
			
			elapsed := time.Since(lt.startTime)
			
			fmt.Printf("\n=== Progress Report ===\n")
			fmt.Printf("Messages produced: %d / %d\n", produced, lt.totalMessages)
			fmt.Printf("Messages consumed: %d / %d\n", consumed, lt.totalMessages)
			fmt.Printf("Elapsed time: %v\n", elapsed)
			
			if produced > 0 {
				fmt.Printf("Produce rate: %.2f msg/s\n", float64(produced)/elapsed.Seconds())
			}
			if consumed > 0 {
				fmt.Printf("Consume rate: %.2f msg/s\n", float64(consumed)/elapsed.Seconds())
			}
			fmt.Printf("Progress: %.2f%%\n", float64(consumed)/float64(lt.totalMessages)*100)
			fmt.Printf("=====================\n")
		}
	}
}

func (lt *LoadTest) Run() error {
	fmt.Printf("Starting Kafka latency load test...\n")
	fmt.Printf("Brokers: %v\n", lt.brokers)
	fmt.Printf("Base topic: %s\n", lt.baseTopic)
	fmt.Printf("Topic: %s\n", lt.topic)
	fmt.Printf("Total messages: %d\n", lt.totalMessages)
	fmt.Printf("Producer rate: %d msg/s\n", lt.producerRate)
	fmt.Printf("Number of producers: %d\n", lt.numProducers)
	fmt.Printf("Number of consumer workers: %d\n", lt.numConsumerWorkers)
	fmt.Printf("Message size: %d bytes\n", lt.messageSize)
	fmt.Printf("JSONL output: latency_records.jsonl\n")
	fmt.Printf("=======================\n")
	
	// Setup clients
	if err := lt.setupProducers(); err != nil {
		return err
	}
	
	if err := lt.setupConsumers(); err != nil {
		return err
	}

	// Create admin client for topic management
	adminOpts := []kgo.Opt{
		kgo.SeedBrokers(lt.brokers...),
	}
	adminClient, err := kgo.NewClient(adminOpts...)
	if err != nil {
		return fmt.Errorf("failed to create admin client: %w", err)
	}
	lt.adminClient = adminClient

	// Create topic if it doesn't exist
	if err := lt.createTopic(); err != nil {
		return err
	}

	// Cleanup old topics
	if err := lt.cleanupOldTopics(); err != nil {
		return err
	}
	
	// Create context for cancellation
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	
	// Handle graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	
	// Start timestamp
	lt.startTime = time.Now()
	
	// Start all components
	var wg sync.WaitGroup
	
	// Start producers
	for i := 0; i < lt.numProducers; i++ {
		wg.Add(1)
		go func(producerID int) {
			defer wg.Done()
			lt.producer(ctx, producerID)
		}(i)
	}
	
	// Start consumers
	for i := 0; i < lt.numConsumerWorkers; i++ {
		wg.Add(1)
		go func(consumerID int) {
			defer wg.Done()
			lt.consumer(ctx, consumerID)
		}(i)
	}
	
	// Start progress reporter
	wg.Add(1)
	go func() {
		defer wg.Done()
		lt.reportProgress(ctx)
	}()
	
	// Wait for completion or signal
	go func() {
		for {
			if atomic.LoadInt64(&lt.completedMessages) >= lt.totalMessages {
				fmt.Println("\nAll messages processed, shutting down...")
				cancel()
				return
			}
			time.Sleep(100 * time.Millisecond)
		}
	}()
	
	// Wait for signal or completion
	select {
	case <-sigChan:
		fmt.Println("\nReceived signal, shutting down...")
		cancel()
	case <-ctx.Done():
		// Completed or canceled
	}
	
	wg.Wait()
	
	lt.endTime = time.Now()
	
	// Final report
	produced := atomic.LoadInt64(&lt.messageCounter)
	consumed := atomic.LoadInt64(&lt.completedMessages)
	duration := lt.endTime.Sub(lt.startTime)
	
	fmt.Printf("\n=== Final Report ===\n")
	fmt.Printf("Total messages produced: %d\n", produced)
	fmt.Printf("Total messages consumed: %d\n", consumed)
	fmt.Printf("Total duration: %v\n", duration)
	fmt.Printf("Average produce rate: %.2f msg/s\n", float64(produced)/duration.Seconds())
	fmt.Printf("Average consume rate: %.2f msg/s\n", float64(consumed)/duration.Seconds())
	fmt.Printf("JSONL records written to: latency_records.jsonl\n")
	fmt.Printf("===================\n")
	
	return nil
}

func main() {
	loadTest := NewLoadTest()
	defer loadTest.cleanup()
	
	if err := loadTest.Run(); err != nil {
		log.Fatalf("Load test failed: %v", err)
	}
} 