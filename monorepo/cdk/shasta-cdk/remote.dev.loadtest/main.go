package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/kmsg"
	"github.com/twmb/franz-go/pkg/sasl/scram"
	"crypto/tls"

	"loadtest/pkg/types"
	"loadtest/pkg/utils"
)

const (
	testDuration          = 3 * 7 * 24 * time.Hour // 3 week test duration
	warmupDuration        = 5 * time.Second        // 5 second warm-up phase
	messageInterval       = 500 * time.Millisecond // 0.5s spacing = 2 msg/s per producer
	numPartitions         = 18
	numProducerGoroutines = 16                                            // 16 producer goroutines
	producersPerGoroutine = 64                                            // 64 producers per goroutine
	numProducers          = numProducerGoroutines * producersPerGoroutine // 1,024 total producers
	numConsumers          = numPartitions                                 // 1 consumer per partition for optimal latency
)

func getBrokers() []string {
	if brokersEnv := os.Getenv("REDPANDA_BROKERS"); brokersEnv != "" {
		return strings.Split(brokersEnv, ",")
	}
	// Fallback to Private Link bootstrap URL
	return []string{"seed-beced2e2.d2f15c48ljef72usrte0.byoc.prd.cloud.redpanda.com:30292"}
}

func getEnvOrDefault(envVar, defaultValue string) string {
	if value := os.Getenv(envVar); value != "" {
		return value
	}
	return defaultValue
}

func getCredentials() (string, string) {
	user := getEnvOrDefault("REDPANDA_USER", "superuser")
	pass := getEnvOrDefault("REDPANDA_PASS", "secretpassword")
	return user, pass
}

func requiresTLS(brokers []string) bool {
	// Check if using cloud or privatelink endpoints that require TLS
	for _, broker := range brokers {
		if strings.Contains(broker, ".cloud.redpanda.com") || strings.Contains(broker, ":30292") {
			return true
		}
	}
	return false
}

// Buffer pool to reduce GC pressure from message allocations
var messageBufferPool = sync.Pool{
	New: func() interface{} {
		return make([]byte, 8)
	},
}

// LatencyLogger handles JSONL logging with 1-hour rotation and compression
type LatencyLogger struct {
	logDir      string
	currentFile *os.File
	currentHour time.Time
	encoder     *json.Encoder
	mutex       sync.Mutex
}

func NewLatencyLogger(logDir string) (*LatencyLogger, error) {
	// Create logging directory
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create log directory: %v", err)
	}

	logger := &LatencyLogger{
		logDir: logDir,
	}

	// Initialize first log file
	if err := logger.rotateFile(); err != nil {
		return nil, err
	}

	return logger, nil
}

func (ll *LatencyLogger) rotateFile() error {
	now := time.Now().UTC()
	// Truncate to hourly boundary
	currentPeriod := time.Date(now.Year(), now.Month(), now.Day(), now.Hour(), 0, 0, 0, time.UTC)

	// Check if we need to rotate
	if ll.currentFile != nil && ll.currentHour.Equal(currentPeriod) {
		return nil // No rotation needed
	}

	// Close previous file if exists
	var prevFilePath string
	if ll.currentFile != nil {
		prevFilePath = ll.currentFile.Name()
		ll.currentFile.Close()

		// Spawn background gzip compression of previous file
		go ll.compressPreviousFile(prevFilePath)
	}

	// Create new file with sortable timestamp (hourly intervals)
	filename := fmt.Sprintf("latency-%s.jsonl", currentPeriod.Format("2006-01-02T15-00-00Z"))
	filepath := filepath.Join(ll.logDir, filename)

	file, err := os.OpenFile(filepath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return fmt.Errorf("failed to create log file %s: %v", filepath, err)
	}

	ll.currentFile = file
	ll.currentHour = currentPeriod
	ll.encoder = json.NewEncoder(file)

	utils.TimestampedPrintf("📝 Started new latency log (1 hr rotation): %s\n", filename)
	return nil
}

func (ll *LatencyLogger) compressPreviousFile(filePath string) {
	utils.TimestampedPrintf("🗜️  Compressing previous log file: %s\n", filepath.Base(filePath))

	// Use gzip command for better performance than Go's gzip
	cmd := exec.Command("gzip", filePath)
	if err := cmd.Run(); err != nil {
		utils.TimestampedLogf("❌ Failed to gzip %s: %v", filePath, err)
		return
	}

	utils.TimestampedPrintf("✅ Compressed: %s.gz\n", filepath.Base(filePath))
}

func (ll *LatencyLogger) LogLatency(entry types.LatencyLogEntry) error {
	ll.mutex.Lock()
	defer ll.mutex.Unlock()

	// Check if we need to rotate to new hour
	if err := ll.rotateFile(); err != nil {
		return err
	}

	// Write JSONL entry
	return ll.encoder.Encode(entry)
}

func (ll *LatencyLogger) Close() error {
	ll.mutex.Lock()
	defer ll.mutex.Unlock()

	if ll.currentFile != nil {
		prevFilePath := ll.currentFile.Name()
		ll.currentFile.Close()

		// Compress final file
		go ll.compressPreviousFile(prevFilePath)
	}

	return nil
}

type LatencyStats struct {
	addCh   chan time.Duration
	calcCh  chan chan map[string]time.Duration
	closeCh chan struct{}
}

func NewLatencyStats() *LatencyStats {
	ls := &LatencyStats{
		addCh:   make(chan time.Duration, 1000), // Buffered to avoid blocking producers
		calcCh:  make(chan chan map[string]time.Duration),
		closeCh: make(chan struct{}),
	}

	// Start the goroutine that manages the latencies slice
	go ls.run()

	return ls
}

func (ls *LatencyStats) run() {
	var latencies []time.Duration

	for {
		select {
		case latency := <-ls.addCh:
			latencies = append(latencies, latency)

		case responseCh := <-ls.calcCh:
			// Calculate stats and send back result
			result := ls.calculateStats(latencies)
			responseCh <- result

		case <-ls.closeCh:
			return
		}
	}
}

func (ls *LatencyStats) Add(latency time.Duration) {
	select {
	case ls.addCh <- latency:
		// Successfully added
	default:
		// Channel full, could log this or use different strategy
		// For now, just drop the measurement to avoid blocking
	}
}

func (ls *LatencyStats) Calculate() map[string]time.Duration {
	responseCh := make(chan map[string]time.Duration)
	ls.calcCh <- responseCh
	return <-responseCh
}

func (ls *LatencyStats) Close() {
	close(ls.closeCh)
}

func (ls *LatencyStats) calculateStats(latencies []time.Duration) map[string]time.Duration {
	if len(latencies) == 0 {
		return map[string]time.Duration{}
	}

	// Create a copy to avoid modifying the original slice during sorting
	latenciesCopy := make([]time.Duration, len(latencies))
	copy(latenciesCopy, latencies)

	sort.Slice(latenciesCopy, func(i, j int) bool {
		return latenciesCopy[i] < latenciesCopy[j]
	})

	count := len(latenciesCopy)
	results := make(map[string]time.Duration)

	results["count"] = time.Duration(count)
	results["min"] = latenciesCopy[0]
	results["max"] = latenciesCopy[count-1]
	results["p50"] = latenciesCopy[count*50/100]
	results["p90"] = latenciesCopy[count*90/100]
	results["p95"] = latenciesCopy[count*95/100]
	results["p99"] = latenciesCopy[count*99/100]

	if count >= 100 {
		results["p99.9"] = latenciesCopy[count*999/1000]
	}
	if count >= 1000 {
		results["p99.99"] = latenciesCopy[count*9999/10000]
	}
	if count >= 10000 {
		results["p99.999"] = latenciesCopy[count*99999/100000]
	}

	var sum time.Duration
	for _, latency := range latenciesCopy {
		sum += latency
	}
	results["avg"] = sum / time.Duration(count)

	return results
}

func createMessage(sendTime time.Time) []byte {
	// Get pre-allocated buffer from pool to reduce GC pressure
	msg := messageBufferPool.Get().([]byte)
	// Ensure buffer is the right size (should always be 8 from pool)
	if len(msg) != 8 {
		msg = make([]byte, 8)
	}
	// Write timestamp to buffer
	binary.BigEndian.PutUint64(msg, uint64(sendTime.UnixNano()))
	return msg
}

func releaseMessageBuffer(msg []byte) {
	// Return buffer to pool for reuse (only if it's the right size)
	if len(msg) == 8 {
		messageBufferPool.Put(msg)
	}
}

func extractTimestampFromMessage(data []byte) time.Time {
	if len(data) < 8 {
		return time.Time{}
	}
	// Extract timestamp from first 8 bytes (rest is padding)
	nanos := binary.BigEndian.Uint64(data[:8])
	return time.Unix(0, int64(nanos))
}

func createTopic(client *kgo.Client, topicName string) error {
	req := kmsg.NewCreateTopicsRequest()
	reqTopic := kmsg.NewCreateTopicsRequestTopic()
	reqTopic.Topic = topicName
	reqTopic.NumPartitions = numPartitions
	reqTopic.ReplicationFactor = 3 // Match broker count
	req.Topics = append(req.Topics, reqTopic)

	resp, err := req.RequestWith(context.Background(), client)
	if err != nil {
		return fmt.Errorf("failed to send create topic request: %v", err)
	}

	// Check response for errors
	for _, topic := range resp.Topics {
		if topic.Topic == topicName {
			if topic.ErrorCode != 0 {
				// Error code 36 = TOPIC_ALREADY_EXISTS (acceptable)
				if topic.ErrorCode == 36 {
					utils.TimestampedPrintf("✅ Topic already exists: %s\n", topicName)
					return nil
				}
				return fmt.Errorf("topic creation failed with error code %d", topic.ErrorCode)
			}
		}
	}

	return nil
}

func verifyTopicPartitions(client *kgo.Client, topicName string, expectedPartitions int32) error {
	utils.TimestampedPrintf("🔍 Verifying topic has %d partitions...\n", expectedPartitions)

	// Get topic metadata
	metaReq := kmsg.NewMetadataRequest()
	metaReq.Topics = []kmsg.MetadataRequestTopic{{Topic: &topicName}}

	var lastErr error
	maxRetries := 10

	for attempt := 1; attempt <= maxRetries; attempt++ {
		metaResp, err := metaReq.RequestWith(context.Background(), client)
		if err != nil {
			lastErr = fmt.Errorf("metadata request failed: %v", err)
			utils.TimestampedPrintf("⚠️  Attempt %d/%d: %v\n", attempt, maxRetries, lastErr)
			time.Sleep(time.Duration(attempt) * time.Second)
			continue
		}

		// Find our topic in the response
		for _, topic := range metaResp.Topics {
			if topic.Topic != nil && *topic.Topic == topicName {
				if topic.ErrorCode != 0 {
					lastErr = fmt.Errorf("topic metadata error code %d", topic.ErrorCode)
					utils.TimestampedPrintf("⚠️  Attempt %d/%d: %v\n", attempt, maxRetries, lastErr)
					time.Sleep(time.Duration(attempt) * time.Second)
					continue
				}

				// Check partition count
				actualPartitions := int32(len(topic.Partitions))
				if actualPartitions != expectedPartitions {
					lastErr = fmt.Errorf("expected %d partitions, found %d", expectedPartitions, actualPartitions)
					utils.TimestampedPrintf("⚠️  Attempt %d/%d: %v\n", attempt, maxRetries, lastErr)
					time.Sleep(time.Duration(attempt) * time.Second)
					continue
				}

				// Verify each partition has a leader
				unavailablePartitions := []int32{}
				for _, partition := range topic.Partitions {
					if partition.Leader == -1 {
						unavailablePartitions = append(unavailablePartitions, partition.Partition)
					}
				}

				if len(unavailablePartitions) > 0 {
					lastErr = fmt.Errorf("partitions without leader: %v", unavailablePartitions)
					utils.TimestampedPrintf("⚠️  Attempt %d/%d: %v\n", attempt, maxRetries, lastErr)
					time.Sleep(time.Duration(attempt) * time.Second)
					continue
				}

				// Success!
				utils.TimestampedPrintf("✅ Topic verified: %d partitions all available with leaders\n", actualPartitions)
				return nil
			}
		}

		lastErr = fmt.Errorf("topic %s not found in metadata response", topicName)
		utils.TimestampedPrintf("⚠️  Attempt %d/%d: %v\n", attempt, maxRetries, lastErr)
		time.Sleep(time.Duration(attempt) * time.Second)
	}

	return fmt.Errorf("failed to verify topic after %d attempts: %v", maxRetries, lastErr)
}

func refreshClientMetadata(client *kgo.Client, topicName string) error {
	utils.TimestampedPrintf("🔄 Refreshing client metadata for topic %s...\n", topicName)

	// Force metadata refresh by requesting topic metadata
	metaReq := kmsg.NewMetadataRequest()
	metaReq.Topics = []kmsg.MetadataRequestTopic{{Topic: &topicName}}

	_, err := metaReq.RequestWith(context.Background(), client)
	if err != nil {
		return fmt.Errorf("failed to refresh metadata: %v", err)
	}

	utils.TimestampedPrintf("✅ Metadata refreshed for topic %s\n", topicName)
	return nil
}

func debugTopicInfo(client *kgo.Client, topicName string) {
	utils.TimestampedPrintf("🔍 DEBUG: Topic partition information for %s\n", topicName)

	metaReq := kmsg.NewMetadataRequest()
	metaReq.Topics = []kmsg.MetadataRequestTopic{{Topic: &topicName}}

	metaResp, err := metaReq.RequestWith(context.Background(), client)
	if err != nil {
		utils.TimestampedPrintf("❌ Failed to get topic metadata: %v\n", err)
		return
	}

	for _, topic := range metaResp.Topics {
		if topic.Topic != nil && *topic.Topic == topicName {
			utils.TimestampedPrintf("📋 Topic: %s, Partitions: %d, Error: %d\n",
				*topic.Topic, len(topic.Partitions), topic.ErrorCode)

			for _, partition := range topic.Partitions {
				utils.TimestampedPrintf("  📊 Partition %d: Leader=%d, Replicas=%v, ISR=%v\n",
					partition.Partition, partition.Leader,
					partition.Replicas, partition.ISR)
			}
			return
		}
	}

	utils.TimestampedPrintf("❌ Topic %s not found in metadata response\n", topicName)
}

func cleanupOldLoadtestTopics(client *kgo.Client) error {
	utils.TimestampedPrintf("🧹 Cleaning up old loadtest topics...\n")

	// Get list of topics
	metaReq := kmsg.NewMetadataRequest()
	metaResp, err := metaReq.RequestWith(context.Background(), client)
	if err != nil {
		return err
	}

	// Find loadtest topics to delete
	var topicsToDelete []string
	for _, topic := range metaResp.Topics {
		if topic.Topic != nil && len(*topic.Topic) > 15 && (*topic.Topic)[:15] == "loadtest-topic-" {
			topicsToDelete = append(topicsToDelete, *topic.Topic)
		}
	}

	if len(topicsToDelete) == 0 {
		utils.TimestampedPrintf("✅ No old loadtest topics to clean up\n")
		return nil
	}

	utils.TimestampedPrintf("🗑️  Found %d old loadtest topics to delete\n", len(topicsToDelete))

	// Delete topics in batches to avoid overwhelming the cluster
	batchSize := 10
	for i := 0; i < len(topicsToDelete); i += batchSize {
		end := i + batchSize
		if end > len(topicsToDelete) {
			end = len(topicsToDelete)
		}

		deleteReq := kmsg.NewDeleteTopicsRequest()
		for _, topicName := range topicsToDelete[i:end] {
			deleteReq.TopicNames = append(deleteReq.TopicNames, topicName)
			utils.TimestampedPrintf("  🗑️  Deleting: %s\n", topicName)
		}

		_, err := deleteReq.RequestWith(context.Background(), client)
		if err != nil {
			utils.TimestampedPrintf("⚠️  Warning: Failed to delete some topics: %v\n", err)
		} else {
			utils.TimestampedPrintf("✅ Deleted batch of %d topics\n", end-i)
		}
	}

	return nil
}

func producerGoroutine(ctx context.Context, client *kgo.Client, stats *LatencyStats, topicName string, startSignal <-chan struct{}, goroutineID int, isWarmup bool) {
	// Wait for consumers to be ready
	<-startSignal

	// Calculate producer ID range for this goroutine
	startProducerID := goroutineID * producersPerGoroutine
	endProducerID := startProducerID + producersPerGoroutine

	if isWarmup {
		utils.TimestampedPrintf("🔥 Warm-up Producer Goroutine %d started (producers %d-%d)\n", goroutineID, startProducerID, endProducerID-1)
	} else {
		utils.TimestampedPrintf("🚀 Producer Goroutine %d started (producers %d-%d, 2 msg/s each)\n", goroutineID, startProducerID, endProducerID-1)
	}

	// Track message count per producer (only for this goroutine's producers)
	messageCounts := make([]int, producersPerGoroutine)
	timer := time.NewTimer(messageInterval)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			if isWarmup {
				totalMessages := 0
				for i, count := range messageCounts {
					actualProducerID := startProducerID + i
					utils.TimestampedPrintf("🔥 Warm-up Producer %d finished. Sent %d messages\n", actualProducerID, count)
					totalMessages += count
				}
				utils.TimestampedPrintf("🔥 Goroutine %d warm-up messages sent: %d\n", goroutineID, totalMessages)
			} else {
				totalMessages := 0
				for i, count := range messageCounts {
					actualProducerID := startProducerID + i
					utils.TimestampedPrintf("📤 Producer %d finished. Sent %d messages\n", actualProducerID, count)
					totalMessages += count
				}
				utils.TimestampedPrintf("📤 Goroutine %d messages sent: %d\n", goroutineID, totalMessages)
			}
			return
		case <-timer.C:
			// Cycle through this goroutine's producers and send one message for each
			for i := 0; i < producersPerGoroutine; i++ {
				actualProducerID := startProducerID + i
				// ✅ Capture timestamp immediately before each producer send for accurate latency measurement
				sendTime := time.Now()
				message := createMessage(sendTime)

				record := &kgo.Record{
					Topic: topicName,
					Value: message,
				}

				// Capture actualProducerID for the callback
				currentProducerID := actualProducerID
				client.Produce(ctx, record, func(record *kgo.Record, err error) {
					if err != nil && err.Error() != "context deadline exceeded" {
						utils.TimestampedLogf("❌ Producer %d error: %v", currentProducerID, err)
					}
					// Return buffer to pool after message is sent
					releaseMessageBuffer(record.Value)
				})

				messageCounts[i]++
			}

			// Reset timer for next batch of messages
			timer.Reset(messageInterval)
		}
	}
}

func consumer(ctx context.Context, client *kgo.Client, stats *LatencyStats, logger *LatencyLogger, consumerID int, readySignal chan<- struct{}, isWarmup bool) {
	if isWarmup {
		utils.TimestampedPrintf("🔥 Warm-up Consumer %d started (1:1 consumer-to-partition ratio)\n", consumerID)
	} else {
		utils.TimestampedPrintf("🚀 Consumer %d started (1:1 consumer-to-partition ratio)\n", consumerID)
	}

	// Signal that this consumer is ready
	readySignal <- struct{}{}

	receivedCount := 0

	// Channel for communicating event counts to logging goroutine
	countChan := make(chan int, 100)

	// Start logging goroutine that logs every 10k events
	go func() {
		lastLoggedCount := 0
		for {
			select {
			case <-ctx.Done():
				return
			case count := <-countChan:
				if count-lastLoggedCount >= 10000 {
					utils.TimestampedPrintf("📊 Consumer %d: Processed %d events (total: %d)\n", consumerID, count-lastLoggedCount, count)
					lastLoggedCount = count
				}
			}
		}
	}()

	for {
		select {
		case <-ctx.Done():
			if isWarmup {
				utils.TimestampedPrintf("🔥 Warm-up Consumer %d finished. Received %d messages\n", consumerID, receivedCount)
			} else {
				utils.TimestampedPrintf("📥 Consumer %d finished. Received %d messages\n", consumerID, receivedCount)
			}
			return
		default:
			fetches := client.PollFetches(ctx)
			if errs := fetches.Errors(); len(errs) > 0 {
				for _, err := range errs {
					if err.Err.Error() != "context deadline exceeded" {
						utils.TimestampedLogf("❌ Consumer %d error: %v", consumerID, err)
					}
				}
				continue
			}

			fetches.EachPartition(func(p kgo.FetchTopicPartition) {
				for _, record := range p.Records {
					// ✅ Capture receive time immediately for each individual record
					receiveTime := time.Now()

					sendTime := extractTimestampFromMessage(record.Value)
					if !sendTime.IsZero() && !isWarmup {
						// Only collect stats during main test, not warm-up
						latency := receiveTime.Sub(sendTime)

						// ✅ CRITICAL PATH: Add to stats immediately (non-blocking)
						stats.Add(latency)

						// ✅ OPTIMIZED: Fast logging with minimal allocation
						entry := types.LatencyLogEntry{
							Timestamp:   receiveTime,
							SendTime:    sendTime,
							ReceiveTime: receiveTime,
							LatencyMs:   float64(latency.Nanoseconds()) / 1e6, // Convert to milliseconds
							ConsumerID:  consumerID,
							Partition:   record.Partition,
							Offset:      record.Offset,
						}

						// Log synchronously but with optimized logger (already has internal buffering)
						if err := logger.LogLatency(entry); err != nil {
							// Only log errors occasionally to avoid spam
							if receivedCount%10000 == 0 {
								utils.TimestampedLogf("❌ Failed to log latency for consumer %d: %v", consumerID, err)
							}
						}
					}
					receivedCount++

					// Send count update to logging goroutine every 1000 events to avoid channel flooding
					if receivedCount%1000 == 0 {
						select {
						case countChan <- receivedCount:
						default:
							// Don't block if channel is full
						}
					}
				}
			})
		}
	}
}

// SharedTestInfo represents the test configuration shared with rebalance triggers
type SharedTestInfo struct {
	TopicName     string `json:"topic_name"`
	ConsumerGroup string `json:"consumer_group"`
	UUID          string `json:"uuid"`
	StartTime     string `json:"start_time"`
}

// writeSharedTestInfo writes test info to a shared file for rebalance triggers
func writeSharedTestInfo(topicName, consumerGroup, uuid string) error {
	info := SharedTestInfo{
		TopicName:     topicName,
		ConsumerGroup: consumerGroup,
		UUID:          uuid,
		StartTime:     time.Now().Format(time.RFC3339),
	}

	data, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal test info: %w", err)
	}

	// Write to shared file that rebalance triggers can poll
	if err := os.WriteFile("loadtest-info.json", data, 0644); err != nil {
		return fmt.Errorf("failed to write shared test info: %w", err)
	}

	return nil
}

// cleanupSharedFile removes the shared test info file
func cleanupSharedFile() {
	if err := os.Remove("loadtest-info.json"); err != nil {
		if !os.IsNotExist(err) {
			utils.TimestampedPrintf("⚠️  Warning: Failed to clean up shared test info file: %v\n", err)
		}
	} else {
		utils.TimestampedPrintf("🧹 Cleaned up shared test info file\n")
	}
}

func main() {
	// Generate unique topic name
	topicUUID := uuid.New().String()[:8]
	topicName := fmt.Sprintf("loadtest-topic-%s", topicUUID)
	consumerGroup := fmt.Sprintf("loadtest-group-%s", topicUUID)

	// Write shared test info for rebalance triggers
	if err := writeSharedTestInfo(topicName, consumerGroup, topicUUID); err != nil {
		log.Printf("⚠️  Warning: Failed to write shared test info: %v", err)
	} else {
		utils.TimestampedPrintf("📄 Shared test info written to loadtest-info.json\n")
	}

	// Set up graceful shutdown to clean up shared file
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigChan
		utils.TimestampedPrintf("\n🛑 Received shutdown signal, cleaning up...\n")
		cleanupSharedFile()
		os.Exit(0)
	}()

	utils.TimestampedPrintf("🎯 Redpanda Load Test - 16 PRODUCER GOROUTINES, 2 msg/s per producer, ack=1\n")
	utils.TimestampedPrintf("🔗 Brokers: %v\n", getBrokers())
	utils.TimestampedPrintf("📝 Topic: %s\n", topicName)
	utils.TimestampedPrintf("👥 Consumer Group: %s\n", consumerGroup)
	utils.TimestampedPrintf("📊 Config: %d partitions, %d producers, %d consumers (1:1 consumer-to-partition)\n", numPartitions, numProducers, numConsumers)
	utils.TimestampedPrintf("📦 Message size: 8 bytes (timestamp only)\n")
	utils.TimestampedPrintf("⏱️  Message interval: %v (2 msg/s per producer)\n", messageInterval)
	utils.TimestampedPrintf("📋 Logging: JSONL latency logs in ./logs/ (1 hr rotation + gzip)\n")
	utils.TimestampedPrintf("💻 CPU: %d cores, GOMAXPROCS=%d, %d goroutines total (%d producers + %d consumers)\n\n", runtime.NumCPU(), runtime.GOMAXPROCS(0), numProducerGoroutines+numConsumers, numProducerGoroutines, numConsumers)

	stats := NewLatencyStats()

	// Create latency logger with 1-hour rotation and compression
	latencyLogger, err := NewLatencyLogger("./logs")
	if err != nil {
		log.Fatalf("❌ Failed to create latency logger: %v", err)
	}
	defer latencyLogger.Close()

	// Producer client optimized for ULTRA-LOW latency (<50ms P99.99 goal)
	brokers := getBrokers()
	producerOpts := []kgo.Opt{
		kgo.SeedBrokers(brokers...),
		kgo.RequiredAcks(kgo.LeaderAck()), // ack=1 (lower latency than ack=all)
		kgo.DisableIdempotentWrite(),      // Allow ack=1, reduce overhead
	}

	// Add TLS and SASL only if required
	if requiresTLS(brokers) {
		user, pass := getCredentials()
		producerOpts = append(producerOpts,
			// TLS configuration for SASL_SSL
			kgo.DialTLSConfig(&tls.Config{}),
			// SASL/SCRAM authentication
			kgo.SASL(scram.Auth{
				User: user,
				Pass: pass,
			}.AsSha256Mechanism()),
		)
	}

	// Add remaining producer optimizations
	producerOpts = append(producerOpts,
		// Ultra-low latency optimizations
		kgo.ProducerLinger(0),                             // Zero linger = immediate send
		kgo.ProducerBatchMaxBytes(1024),                   // ULTRA-small batches (1KB) for lowest latency
		kgo.ProducerBatchCompression(kgo.NoCompression()), // No compression for speed

		// Ultra-aggressive timeouts for speed
		kgo.ConnIdleTimeout(15 * time.Second),       // More aggressive connection management
		kgo.RequestTimeoutOverhead(1 * time.Second), // Minimum allowed timeout (library enforced)
		kgo.RetryBackoffFn(func(tries int) time.Duration {
			return time.Millisecond * 5 // Ultra-fast retries
		}),
	)

	producerClient, err := kgo.NewClient(producerOpts...)
	if err != nil {
		log.Fatalf("❌ Failed to create producer: %v", err)
	}
	defer producerClient.Close()

	// Cleanup old loadtest topics before starting
	err = cleanupOldLoadtestTopics(producerClient)
	if err != nil {
		utils.TimestampedPrintf("⚠️  Warning: Topic cleanup failed: %v\n", err)
	}

	// Brief pause to let deletions process
	if err == nil {
		utils.TimestampedPrintf("⏳ Waiting for topic deletions to complete...\n")
		time.Sleep(2 * time.Second)
	}

	// Consumer client optimized for ULTRA-LOW latency & improved disconnect detection
	consumerOpts := []kgo.Opt{
		kgo.SeedBrokers(brokers...),
		kgo.ConsumeTopics(topicName),
		kgo.ConsumerGroup(consumerGroup),
		kgo.ConsumeResetOffset(kgo.NewOffset().AtEnd()),
	}

	// Add TLS and SASL only if required
	if requiresTLS(brokers) {
		user, pass := getCredentials()
		consumerOpts = append(consumerOpts,
			// TLS configuration for SASL_SSL
			kgo.DialTLSConfig(&tls.Config{}),
			// SASL/SCRAM authentication
			kgo.SASL(scram.Auth{
				User: user,
				Pass: pass,
			}.AsSha256Mechanism()),
		)
	}

	// Add remaining consumer optimizations
	consumerOpts = append(consumerOpts,

		// Ultra-low latency fetch optimizations
		kgo.FetchMinBytes(1),                    // Don't wait for minimum bytes
		kgo.FetchMaxWait(10 * time.Millisecond), // Minimum allowed max wait (10ms - library enforced)
		kgo.FetchMaxBytes(64 * 1024),            // Smaller fetch size for lower latency (64KB vs 1MB)

		// ULTRA-AGGRESSIVE disconnect detection for lowest latency
		kgo.SessionTimeout(6 * time.Second),            // 6s - ultra-aggressive (minimum stable for most clusters)
		kgo.HeartbeatInterval(2 * time.Second),         // 2s (1/3 of 6s)
		kgo.AutoCommitInterval(100 * time.Millisecond), // Minimum allowed commit interval (library enforced)

		// Faster connection management for improved reconnection
		kgo.ConnIdleTimeout(20 * time.Second),       // Reduced from 30s
		kgo.RequestTimeoutOverhead(1 * time.Second), // Minimum allowed timeout

		// Faster retry backoff for quicker recovery
		kgo.RetryBackoffFn(func(tries int) time.Duration {
			return time.Millisecond * 100 // Reasonable backoff
		}),
		kgo.RetryTimeout(10 * time.Second),

		// Improved rebalancing for quicker group recovery
		kgo.RebalanceTimeout(15 * time.Second),

		// More frequent metadata refresh
		kgo.MetadataMaxAge(30 * time.Second),
	)

	consumerClient, err := kgo.NewClient(consumerOpts...)
	if err != nil {
		log.Fatalf("❌ Failed to create consumer: %v", err)
	}
	defer consumerClient.Close()

	// Create topic with proper error handling
	utils.TimestampedPrintf("🔧 Creating topic...\n")
	err = createTopic(producerClient, topicName)
	if err != nil {
		log.Fatalf("❌ Failed to create topic: %v", err)
	}

	// Verify all partitions are available with retry logic
	utils.TimestampedPrintf("⏳ Verifying topic and partitions are ready...\n")
	err = verifyTopicPartitions(producerClient, topicName, int32(numPartitions))
	if err != nil {
		log.Fatalf("❌ Topic verification failed: %v", err)
	}

	// Force metadata refresh on both clients to ensure they have current partition info
	utils.TimestampedPrintf("🔄 Ensuring clients have latest metadata...\n")
	err = refreshClientMetadata(producerClient, topicName)
	if err != nil {
		log.Fatalf("❌ Producer metadata refresh failed: %v", err)
	}

	err = refreshClientMetadata(consumerClient, topicName)
	if err != nil {
		log.Fatalf("❌ Consumer metadata refresh failed: %v", err)
	}

	// Show partition details for debugging
	debugTopicInfo(producerClient, topicName)

	utils.TimestampedPrintf("🔍 Debug: About to start warm-up phase with duration: %v\n", warmupDuration)

	// ========================================
	// WARM-UP PHASE
	// ========================================
	utils.TimestampedPrintf("🔥 Starting %v warm-up phase...\n\n", warmupDuration)

	warmupCtx, warmupCancel := context.WithTimeout(context.Background(), warmupDuration)
	defer warmupCancel()

	var warmupWg sync.WaitGroup

	// Channels for warm-up coordination
	warmupConsumerReady := make(chan struct{}, numConsumers)
	warmupProducerStart := make(chan struct{})

	// Start warm-up consumers
	for i := 0; i < numConsumers; i++ {
		warmupWg.Add(1)
		go func(consumerID int) {
			defer warmupWg.Done()
			consumer(warmupCtx, consumerClient, stats, latencyLogger, consumerID, warmupConsumerReady, true) // true for warmup
		}(i)
	}

	// Wait for all warm-up consumers to be ready
	go func() {
		for i := 0; i < numConsumers; i++ {
			<-warmupConsumerReady
		}
		utils.TimestampedPrintf("🔥 All %d consumers ready for warm-up (1:1 consumer-to-partition), starting %d producer goroutines...\n\n", numConsumers, numProducerGoroutines)
		close(warmupProducerStart)
	}()

	// Start multiple warm-up producer goroutines
	for goroutineID := 0; goroutineID < numProducerGoroutines; goroutineID++ {
		warmupWg.Add(1)
		go func(gID int) {
			defer warmupWg.Done()
			producerGoroutine(warmupCtx, producerClient, stats, topicName, warmupProducerStart, gID, true) // true for warmup
		}(goroutineID)
	}

	warmupWg.Wait()
	utils.TimestampedPrintf("\n🔥 Warm-up completed!\n\n")

	// Clean up warm-up stats and create fresh stats for actual test
	stats.Close()
	stats = NewLatencyStats()

	// ========================================
	// MAIN LOAD TEST
	// ========================================
	utils.TimestampedPrintf("⏱️  Starting %v main load test...\n\n", testDuration)

	// Collect GC stats before test
	var gcStatsBefore runtime.MemStats
	runtime.ReadMemStats(&gcStatsBefore)

	startTime := time.Now()

	ctx, cancel := context.WithTimeout(context.Background(), testDuration)
	defer cancel()

	var wg sync.WaitGroup

	// Channels for coordination
	consumerReady := make(chan struct{}, numConsumers)
	producerStart := make(chan struct{})

	// Start consumers first
	for i := 0; i < numConsumers; i++ {
		wg.Add(1)
		go func(consumerID int) {
			defer wg.Done()
			consumer(ctx, consumerClient, stats, latencyLogger, consumerID, consumerReady, false) // false for main test
		}(i)
	}

	// Wait for all consumers to be ready
	go func() {
		for i := 0; i < numConsumers; i++ {
			<-consumerReady
		}
		utils.TimestampedPrintf("✅ All %d consumers ready (1:1 consumer-to-partition), starting %d producer goroutines...\n\n", numConsumers, numProducerGoroutines)
		close(producerStart)
	}()

	// Start multiple producer goroutines
	for goroutineID := 0; goroutineID < numProducerGoroutines; goroutineID++ {
		wg.Add(1)
		go func(gID int) {
			defer wg.Done()
			producerGoroutine(ctx, producerClient, stats, topicName, producerStart, gID, false) // false for main test
		}(goroutineID)
	}

	wg.Wait()

	actualDuration := time.Since(startTime)
	utils.TimestampedPrintf("\n⏱️  Test completed in %v\n\n", actualDuration)

	// Clean up shared test info file
	cleanupSharedFile()

	// Collect GC stats after test
	var gcStatsAfter runtime.MemStats
	runtime.ReadMemStats(&gcStatsAfter)

	// Display results
	results := stats.Calculate()

	utils.TimestampedPrintf("📊 LATENCY STATISTICS\n")
	utils.TimestampedPrintf("═════════════════════\n")

	if count, ok := results["count"]; ok && count > 0 {
		utils.TimestampedPrintf("Messages:  %d\n", int(count))
		utils.TimestampedPrintf("Min:       %v\n", results["min"])
		utils.TimestampedPrintf("Avg:       %v\n", results["avg"])
		utils.TimestampedPrintf("P50:       %v\n", results["p50"])
		utils.TimestampedPrintf("P90:       %v\n", results["p90"])
		utils.TimestampedPrintf("P95:       %v\n", results["p95"])
		utils.TimestampedPrintf("P99:       %v\n", results["p99"])
		if p999, exists := results["p99.9"]; exists {
			utils.TimestampedPrintf("P99.9:     %v\n", p999)
		}
		if p9999, exists := results["p99.99"]; exists {
			utils.TimestampedPrintf("P99.99:    %v\n", p9999)
		}
		if p99999, exists := results["p99.999"]; exists {
			utils.TimestampedPrintf("P99.999:   %v\n", p99999)
		}
		utils.TimestampedPrintf("Max:       %v\n", results["max"])

		throughput := float64(int(count)) / actualDuration.Seconds()
		expectedThroughput := float64(numProducers) * 2.0 // 2 msg/s per producer = 2,048 msg/s total
		dataThroughputKB := (throughput * 8) / 1024       // 8 bytes per message
		utils.TimestampedPrintf("\n📈 Throughput: %.2f messages/second\n", throughput)
		utils.TimestampedPrintf("📊 Data throughput: %.2f KB/second\n", dataThroughputKB)
		utils.TimestampedPrintf("📊 Per-producer: %.2f msg/sec (target: 2.0 msg/sec)\n", throughput/float64(numProducers))
		utils.TimestampedPrintf("📊 Per-partition: %.2f msg/sec\n", throughput/float64(numPartitions))
		utils.TimestampedPrintf("🎯 Expected total: %.2f msg/sec\n", expectedThroughput)

		// Display GC statistics
		gcCollections := gcStatsAfter.NumGC - gcStatsBefore.NumGC
		gcPauseTotal := time.Duration(gcStatsAfter.PauseTotalNs - gcStatsBefore.PauseTotalNs)
		var avgPause time.Duration
		if gcCollections > 0 {
			avgPause = gcPauseTotal / time.Duration(gcCollections)
		}
		utils.TimestampedPrintf("\n🗑️  GC STATISTICS\n")
		utils.TimestampedPrintf("═══════════════\n")
		utils.TimestampedPrintf("Collections: %d\n", gcCollections)
		utils.TimestampedPrintf("Total pause: %v\n", gcPauseTotal)
		utils.TimestampedPrintf("Avg pause:   %v\n", avgPause)
		utils.TimestampedPrintf("Heap size:   %.2f MB\n", float64(gcStatsAfter.HeapInuse)/(1024*1024))
	} else {
		utils.TimestampedPrintf("❌ No messages received - check cluster connectivity\n")
	}

	utils.TimestampedPrintf("\n✅ Load test completed!\n")

	// Clean up the stats goroutine
	stats.Close()
}
