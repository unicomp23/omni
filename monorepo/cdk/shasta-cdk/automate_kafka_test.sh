#!/bin/bash

# Automated RedPanda Producer-Consumer Test Script
# Usage: ./automate_kafka_test.sh [topic-name] [message-count] [timeout]

set -e

TOPIC=${1:-"auto-test-$(date +%s)"}
MESSAGES=${2:-10}
TIMEOUT=${3:-30}
KEY_PATH="/data/.ssh/john.davis.pem"
REDPANDA_NODE="54.237.232.219"
LOAD_TEST_INSTANCE="54.173.123.191"

echo "🚀 Starting automated RedPanda test..."
echo "📋 Topic: $TOPIC"
echo "📊 Messages: $MESSAGES" 
echo "⏱️  Timeout: ${TIMEOUT}s"

# 1. Create topic on RedPanda cluster
echo "🔧 Creating topic '$TOPIC' on RedPanda cluster..."
ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no ec2-user@"$REDPANDA_NODE" "
    sudo docker exec redpanda-0 rpk topic create '$TOPIC' --partitions 3 --replicas 3 2>/dev/null || echo 'Topic may already exist'
"

# 2. Create simple test on load test instance
echo "📝 Creating test script on load test instance..."
ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no ec2-user@"$LOAD_TEST_INSTANCE" "
export PATH=/usr/local/go/bin:\$PATH
cat > kafka_demo.go << 'EOF'
package main

import (
	\"context\"
	\"fmt\"
	\"log\"
	\"os\"
	\"strconv\"
	\"strings\"
	\"time\"
	\"github.com/twmb/franz-go/pkg/kgo\"
)

func main() {
	topic := os.Args[1]
	messages, _ := strconv.Atoi(os.Args[2])
	timeout, _ := strconv.Atoi(os.Args[3])
	
	bootstrapServers := []string{\"10.0.0.62:9092\", \"10.0.1.15:9092\", \"10.0.2.154:9092\"}
	
	log.Printf(\"🚀 Testing topic: %s, Messages: %d, Timeout: %ds\", topic, messages, timeout)
	
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
	defer cancel()
	
	// Producer
	producer, err := kgo.NewClient(kgo.SeedBrokers(bootstrapServers...))
	if err != nil {
		log.Fatalf(\"❌ Producer failed: %v\", err)
	}
	defer producer.Close()
	
	messagesSent := 0
	for i := 0; i < messages; i++ {
		record := &kgo.Record{
			Topic: topic,
			Key:   []byte(fmt.Sprintf(\"key-%d\", i)),
			Value: []byte(fmt.Sprintf(\"Message #%d at %s\", i, time.Now().Format(time.RFC3339))),
		}
		
		producer.Produce(ctx, record, func(r *kgo.Record, err error) {
			if err == nil {
				messagesSent++
			}
		})
	}
	
	if err := producer.Flush(ctx); err != nil {
		log.Printf(\"❌ Flush failed: %v\", err)
	}
	
	// Consumer  
	consumer, err := kgo.NewClient(
		kgo.SeedBrokers(bootstrapServers...),
		kgo.ConsumeTopics(topic),
		kgo.ConsumerGroup(\"test-group-\" + fmt.Sprintf(\"%d\", time.Now().Unix())),
		kgo.FetchMaxWait(2*time.Second),
	)
	if err != nil {
		log.Fatalf(\"❌ Consumer failed: %v\", err)
	}
	defer consumer.Close()
	
	messagesReceived := 0
	startTime := time.Now()
	
	for time.Since(startTime) < time.Duration(timeout-5)*time.Second && messagesReceived < messagesSent {
		fetches := consumer.PollFetches(ctx)
		if err := fetches.Err(); err != nil {
			break
		}
		
		fetches.EachPartition(func(p kgo.FetchTopicPartition) {
			messagesReceived += len(p.Records)
		})
		
		if messagesReceived >= messagesSent {
			break
		}
	}
	
	// Results
	duration := time.Since(startTime)
	successRate := float64(messagesReceived) / float64(messagesSent) * 100
	
	fmt.Println(strings.Repeat(\"=\", 60))
	fmt.Printf(\"KAFKA TEST RESULTS - Topic: %s\\n\", topic)  
	fmt.Println(strings.Repeat(\"=\", 60))
	fmt.Printf(\"Messages Sent:     %d\\n\", messagesSent)
	fmt.Printf(\"Messages Received: %d\\n\", messagesReceived)
	fmt.Printf(\"Success Rate:      %.1f%%\\n\", successRate)
	fmt.Printf(\"Duration:          %v\\n\", duration)
	
	if successRate >= 80.0 {
		fmt.Printf(\"Status:            ✅ SUCCESS\\n\")
	} else {
		fmt.Printf(\"Status:            ❌ FAILED\\n\")
	}
	fmt.Println(strings.Repeat(\"=\", 60))
}
EOF
"

# 3. Run the test
echo "🏃 Running test on load test instance..."
ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no ec2-user@"$LOAD_TEST_INSTANCE" "
    export PATH=/usr/local/go/bin:\$PATH
    cd /home/ec2-user
    go mod init kafka-test 2>/dev/null || true
    go mod tidy 2>/dev/null || true
    go run kafka_demo.go '$TOPIC' '$MESSAGES' '$TIMEOUT'
"

echo "✅ Automated RedPanda test completed!" 