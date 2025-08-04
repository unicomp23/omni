package types

import "time"

// LatencyLogEntry represents a single latency measurement in JSONL format
type LatencyLogEntry struct {
	Timestamp   time.Time `json:"timestamp"`    // ISO8601 timestamp when message was received
	SendTime    time.Time `json:"send_time"`    // When message was originally sent
	ReceiveTime time.Time `json:"receive_time"` // When message was received
	LatencyMs   float64   `json:"latency_ms"`   // Latency in milliseconds
	ConsumerID  int       `json:"consumer_id"`  // Which consumer processed this
	Partition   int32     `json:"partition"`    // Kafka partition
	Offset      int64     `json:"offset"`       // Kafka offset
}
