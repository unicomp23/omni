package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/IBM/sarama"
	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Add configuration constants
const (
	KPI                  = 100 * time.Millisecond // KPI threshold
	messageTimeout       = 5 * time.Minute
	statsInterval        = 5 * time.Second
	timeoutCheckInterval = 10 * time.Second
)

var (
	inKPI, totalInput atomic.Int64
	AppName           = "consumer"
	lastMessageTime   atomic.Value
	logFile           *os.File
	logMutex          sync.Mutex // Add mutex for synchronizing log writes
)

// Add error handling helper
func logError(msg string, err error) {
	log.Printf(`{"type":"error","message":%q,"error":%q}`, msg, err.Error())
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if err := initialize(ctx); err != nil {
		log.Fatalf("Failed to initialize: %v", err)
	}
	defer logFile.Close()

	latency := &Latency{duration: newMetrics()}

	// Start services with error channels
	errCh := make(chan error, 3)

	go func() {
		if err := newWebserver(); err != nil {
			errCh <- fmt.Errorf("webserver error: %w", err)
		}
	}()

	cg := newKafkaConsumerGroup()
	go func() {
		if err := consumeMsg(ctx, cg, latency); err != nil {
			errCh <- fmt.Errorf("consumer error: %w", err)
		}
	}()

	go printStats(ctx)
	go checkMessageTimeout(ctx, cancel)

	// Handle errors or context cancellation
	select {
	case err := <-errCh:
		log.Printf(`{"type":"fatal","error":%q}`, err.Error())
		cancel()
	case <-ctx.Done():
		log.Println(`{"type":"info","message":"shutdown_initiated"}`)
	}

	log.Printf(`{"type":"info","message":"shutdown_complete"}`)
}

// Initialize application
func initialize(ctx context.Context) error {
	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds)
	log.SetPrefix("[" + AppName + "] ")
	log.Printf(`{"type":"info","message":"starting","app":%q}`, AppName)

	lastMessageTime.Store(time.Now())

	// Create log filename with sortable timestamp
	timestamp := time.Now().Format("20060102_150405")
	logFileName := fmt.Sprintf("consumer.%s.jsonl", timestamp)

	var err error
	logFile, err = os.OpenFile(logFileName, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("failed to open log file: %w", err)
	}

	return nil
}

func newWebserver() error {
	http.Handle("/metrics", promhttp.Handler())
	log.Printf(`{"type":"info","message":"starting_webserver","address":%q}`, addr)

	server := &http.Server{
		Addr:         addr,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		return fmt.Errorf("server error: %w", err)
	}
	return nil
}

func newKafkaConsumerGroup() sarama.ConsumerGroup {
	config := sarama.NewConfig()
	version, err := parseKafkaVersion(brokerVer)
	if err != nil {
		log.Panicf("Error parsing source Kafka version: %v", err)
	}
	config.Version = version
	switch assignor {
	case "sticky":
		config.Consumer.Group.Rebalance.GroupStrategies = []sarama.BalanceStrategy{sarama.NewBalanceStrategySticky()}
	case "roundrobin":
		config.Consumer.Group.Rebalance.GroupStrategies = []sarama.BalanceStrategy{sarama.NewBalanceStrategyRoundRobin()}
	case "range":
		config.Consumer.Group.Rebalance.GroupStrategies = []sarama.BalanceStrategy{sarama.NewBalanceStrategyRange()}
	default:
		log.Panicf("Unrecognized consumer group partition assignor: %s", assignor)
	}
	if oldest {
		config.Consumer.Offsets.Initial = sarama.OffsetOldest
	}

	cg, err := sarama.NewConsumerGroup(strings.Split(broker, ","), group, config)
	if err != nil {
		log.Panicf("Error creating consumer group client: %v", err)
	}

	return cg
}

func consumeMsg(ctx context.Context, cg sarama.ConsumerGroup, handler sarama.ConsumerGroupHandler) error {
	for {
		if err := cg.Consume(ctx, strings.Split(topic, ","), handler); err != nil {
			return fmt.Errorf("error from consumer: %w", err)
		}

		if ctx.Err() != nil {
			return nil
		}
	}
}

// Latency represents a Sarama consumer group consumer, implements ConsumerGroupHandler
type Latency struct {
	duration prometheus.Histogram
}

// Setup is run at the beginning of a new session, before ConsumeClaim
func (l *Latency) Setup(session sarama.ConsumerGroupSession) error {
	log.Printf(`{"type":"info","message":"consumer_ready","member_id":%q,"claims":%q}`,
		session.MemberID(), session.Claims())
	return nil
}

// Cleanup is run at the end of a session, once all ConsumeClaim goroutines have exited
func (l *Latency) Cleanup(session sarama.ConsumerGroupSession) error {
	log.Printf(`{"type":"info","message":"session_ending"}`)
	return nil
}

// ConsumeClaim must start a consumer loop of ConsumerGroupClaim's Messages().
func (l *Latency) ConsumeClaim(session sarama.ConsumerGroupSession, claim sarama.ConsumerGroupClaim) error {
	for message := range claim.Messages() {
		now := time.Now()
		lastMessageTime.Store(now)

		key, err := uuid.FromBytes(message.Key)
		if err != nil {
			logError("failed to parse message key", err)
			continue
		}

		ts := time.Unix(key.Time().UnixTime())
		diff := now.Sub(ts)

		event := struct {
			Type      string    `json:"type"`
			Timestamp time.Time `json:"timestamp"`
			Key       string    `json:"key"`
			Latency   int64     `json:"latency_ms"`
			WithinKPI bool      `json:"within_kpi"`
		}{
			Type:      "consume",
			Timestamp: now,
			Key:       key.String(),
			Latency:   diff.Milliseconds(),
			WithinKPI: diff < KPI,
		}

		if bytes, err := json.Marshal(event); err == nil {
			logMutex.Lock() // Lock before writing to file
			if _, err := logFile.Write(append(bytes, '\n')); err != nil {
				logError("failed to write log entry", err)
			}
			logMutex.Unlock() // Unlock after writing
		} else {
			logError("failed to marshal event", err)
		}

		totalInput.Add(1)
		if diff < KPI {
			inKPI.Add(1)
		}

		l.duration.Observe(float64(diff.Milliseconds()))
		session.MarkMessage(message, "")
	}
	return nil
}

func printStats(ctx context.Context) {
	start := time.Now()
	timer := time.NewTicker(5 * time.Second)
	for {
		select {
		case now := <-timer.C:
			in := totalInput.Load()
			good := inKPI.Load()
			duration := float64(now.Sub(start) / time.Second)
			rps := float64(in) / duration
			kpiPct := float64(good) / float64(in) * 100
			exceedPct := float64(in-good) / float64(in) * 100

			log.Printf(`{"type":"stats","total":%d,"rps":%.2f,"meet_kpi":%d,"meet_kpi_pct":%.4f,"exceed_kpi":%d,"exceed_kpi_pct":%.4f}`,
				in, rps, good, kpiPct, in-good, exceedPct)
		case <-ctx.Done():
			return
		}
	}
}

func newMetrics() prometheus.Histogram {
	latency := prometheus.NewHistogram(
		prometheus.HistogramOpts{
			Namespace: AppName,
			Name:      "msg_latency_milliseconds",
			Help:      "A histogram of message latency",
			Buckets:   []float64{5, 10, 20, 50, 100, 200, 500, 1000},
		},
	)

	prometheus.MustRegister(latency)
	return latency
}

// Add new function to check for message timeout
func checkMessageTimeout(ctx context.Context, cancel context.CancelFunc) {
	ticker := time.NewTicker(timeoutCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			lastMsg := lastMessageTime.Load().(time.Time)
			if time.Since(lastMsg) > messageTimeout {
				log.Printf(`{"type":"warning","message":"message_timeout","last_message_age":"%v"}`,
					time.Since(lastMsg))
				cancel()
				return
			}
		}
	}
}
