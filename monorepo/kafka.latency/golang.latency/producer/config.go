package main

import (
	"errors"
	"flag"
	"log"
	"slices"

	"github.com/IBM/sarama"
)

var (
	addr       = ""
	broker     = ""
	brokerVer  = ""
	topic      = ""
	ack        = 0
	thread     = 0
	iterations = 100000 // default 100k iterations
)

func init() {
	flag.StringVar(&broker, "broker", "", "Kafka bootstrap brokers to connect to, use a comma separated list")
	flag.StringVar(&brokerVer, "kafka_version", "2.1.0", "Kafka cluster version, default: 2.1.0")
	flag.StringVar(&topic, "topic", "", "Kafka topic to produce to")
	flag.StringVar(&addr, "addr", ":8080", "The address to bind to, default: :8080")
	flag.IntVar(&ack, "ack", 1, "Broker ack required, 0=None, 1=Local, -1=All, default: 1")
	flag.IntVar(&thread, "thread", 1000, "Number of concurrent threads to produce messages, default: 1000")
	flag.IntVar(&iterations, "iterations", 100000, "Number of messages each thread will produce, default: 100000")
	flag.Parse()

	if len(broker) == 0 {
		log.Panic("no destination Kafka bootstrap brokers defined, please set the -broker flag")
	}

	if len(topic) == 0 {
		log.Panic("no dstination topic given to copy to, please set the -topic flag")
	}
}

// Helper function to ensure the version is valid
func parseKafkaVersion(s string) (sarama.KafkaVersion, error) {
	v, err := sarama.ParseKafkaVersion(s)
	if err != nil {
		return v, err
	}

	if slices.Contains(sarama.SupportedVersions, v) {
		return v, nil
	}

	return v, errors.New("not a supported Kafka version")
}
