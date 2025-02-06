package main

import (
	"errors"
	"flag"
	"slices"

	"github.com/IBM/sarama"
)

var (
	addr      = ""
	broker    = ""
	brokerVer = ""
	topic     = ""
	group     = ""
	assignor  = ""
	oldest    = true
	verbose   = false
)

func init() {
	flag.StringVar(&addr, "addr", ":8080", "The address to bind to, default: :8080")
	flag.StringVar(&broker, "broker", "", "Kafka bootstrap brokers to connect to, use a comma separated list")
	flag.StringVar(&brokerVer, "kafka_version", "2.1.0", "Kafka cluster version, default: 2.1.0")
	flag.StringVar(&topic, "topic", "", "Kafka topic to consume from")
	flag.StringVar(&group, "group", "", "Kafka consumer group name")
	flag.StringVar(&assignor, "assignor", "sticky", "Consumer group partition assignment strategy (range, roundrobin, sticky)")
	flag.BoolVar(&oldest, "oldest", true, "Kafka consumer initial offset")
	flag.BoolVar(&verbose, "verbose", false, "Verbose logging")
	flag.Parse()

	if len(broker) == 0 {
		panic("no source Kafka bootstrap brokers defined, please set the -srcBrokers flag")
	}

	if len(topic) == 0 {
		panic("no source topics given to copy from, please set the -srcTopics flag")
	}

	if len(group) == 0 {
		panic("no Kafka consumer group defined, please set the -group flag")
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
