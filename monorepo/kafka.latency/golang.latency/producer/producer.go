package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
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

// const MaxInflight = 10

var (
	AppName              = "producer"
	succCount, failCount atomic.Uint64
	payload              []byte
	wg                   sync.WaitGroup
	logFile              *os.File
)

func init() {
	uuid.EnableRandPool()

	payload = make([]byte, 512)
	if _, err := rand.Read(payload); err != nil {
		log.Panicf("Unable to generate payload %v", err)
	}

	// Create log filename with sortable timestamp
	timestamp := time.Now().Format("20060102_150405")
	logFileName := "producer." + timestamp + ".jsonl"

	// Open log file in current directory
	var err error
	logFile, err = os.OpenFile(logFileName, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		log.Fatalf("Failed to open log file: %v", err)
	}
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds)
	log.SetPrefix("[" + AppName + "] ")
	log.Println("Start", AppName)

	registerMetrics()
	go newWebserver()

	// var producer sarama.SyncProducer
	for i := 0; i < thread; i++ {
		// if i%MaxInflight == 0 {
		producer := newKafkaProducer()
		// }
		wg.Add(1)
		go produceMsg(producer, time.Duration(i%1000)*time.Millisecond)
	}

	go printStats()

	go func() {
		wg.Wait()
		cancel()
	}()

	defer logFile.Close()

	<-ctx.Done()
	// test app, not doing proper shutdown
	log.Println("Shutdown", AppName)
}

func newWebserver() {
	http.Handle("/metrics", promhttp.Handler())
	log.Println("Listening on", addr)
	if err := http.ListenAndServe(addr, nil); err != http.ErrServerClosed {
		log.Fatalf("Could not listen on %s: %v", addr, err)
	}
}

func newKafkaProducer() sarama.SyncProducer {
	config := sarama.NewConfig()
	version, err := parseKafkaVersion(brokerVer)
	if err != nil {
		log.Fatalf("Error parsing Kafka version: %v", err)
	}
	config.Version = version
	// config.Net.MaxOpenRequests = MaxInflight
	config.Producer.RequiredAcks = sarama.RequiredAcks(ack)
	config.Producer.Return.Successes = true

	producer, err := sarama.NewSyncProducer(strings.Split(broker, ","), config)
	if err != nil {
		log.Fatalf("Failed to start Sarama producer: %v", err)
	}

	return producer
}

func produceMsg(producer sarama.SyncProducer, delay time.Duration) {
	defer wg.Done()
	time.Sleep(delay)

	ticker := time.NewTicker(500 * time.Millisecond)
	count := 0
	for count < iterations {
		uuid, _ := uuid.NewV7()
		key, _ := uuid.MarshalBinary()
		start := time.Now()
		_, _, err := producer.SendMessage(&sarama.ProducerMessage{
			Topic: topic,
			Key:   sarama.ByteEncoder(key),
			Value: sarama.ByteEncoder(payload),
		})
		duration := time.Since(start)

		event := struct {
			Type      string    `json:"type"`
			Timestamp time.Time `json:"timestamp"`
			Key       string    `json:"key"`
			Duration  int64     `json:"duration_ms"`
			Error     string    `json:"error,omitempty"`
		}{
			Type:      "produce",
			Timestamp: time.Now(),
			Key:       uuid.String(),
			Duration:  duration.Milliseconds(),
		}

		if err != nil {
			event.Error = err.Error()
			log.Printf(`{"type":"error","error":%q}`, err.Error())
			failCount.Add(1)
		} else {
			succCount.Add(1)
		}

		// Write event to file
		if bytes, err := json.Marshal(event); err == nil {
			logFile.Write(bytes)
			logFile.Write([]byte("\n"))
		}

		count++
		<-ticker.C
	}
}

func printStats() {
	start := time.Now()
	timer := time.NewTicker(5 * time.Second)
	for now := range timer.C {
		succ := succCount.Load()
		fail := failCount.Load()
		duration := float64(now.Sub(start) / time.Second)
		succRate := float64(succ) / duration
		failRate := float64(fail) / duration

		log.Printf(`{"type":"stats","success":%d,"success_rate":%.2f,"failed":%d,"failed_rate":%.2f}`,
			succ, succRate, fail, failRate)
	}
}

func registerMetrics() {
	succ := prometheus.NewCounterFunc(
		prometheus.CounterOpts{
			Namespace:   AppName,
			Name:        "msg_total",
			Help:        "A counter for total number of messages produced",
			ConstLabels: prometheus.Labels{"code": "succ"},
		},
		func() float64 { return float64(succCount.Load()) },
	)
	fail := prometheus.NewCounterFunc(
		prometheus.CounterOpts{
			Namespace:   AppName,
			Name:        "msg_total",
			Help:        "A counter for total number of messages produced",
			ConstLabels: prometheus.Labels{"code": "fail"},
		},
		func() float64 { return float64(failCount.Load()) },
	)

	prometheus.MustRegister(succ, fail)
}
