package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

type KafkaTestConfig struct {
	Topic             string
	Messages          int
	TimeoutSeconds    int
	KeyPath           string
	RedPandaNode      string
	LoadTestInstance  string
}

type KafkaTestAutomation struct {
	config          *KafkaTestConfig
	redPandaSSH     *ssh.Client
	loadTestSSH     *ssh.Client
}

func NewKafkaTestAutomation(config *KafkaTestConfig) *KafkaTestAutomation {
	return &KafkaTestAutomation{
		config: config,
	}
}

func (k *KafkaTestAutomation) Connect() error {
	log.Println("🔐 Establishing SSH connections...")
	
	// Read private key
	key, err := os.ReadFile(k.config.KeyPath)
	if err != nil {
		return fmt.Errorf("unable to read private key: %v", err)
	}

	signer, err := ssh.ParsePrivateKey(key)
	if err != nil {
		return fmt.Errorf("unable to parse private key: %v", err)
	}

	sshConfig := &ssh.ClientConfig{
		User: "ec2-user",
		Auth: []ssh.AuthMethod{
			ssh.PublicKeys(signer),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         30 * time.Second,
	}

	// Connect to RedPanda node
	log.Printf("🔗 Connecting to RedPanda node: %s", k.config.RedPandaNode)
	redPandaClient, err := ssh.Dial("tcp", k.config.RedPandaNode+":22", sshConfig)
	if err != nil {
		return fmt.Errorf("failed to connect to RedPanda node: %v", err)
	}
	k.redPandaSSH = redPandaClient

	// Connect to load test instance
	log.Printf("🔗 Connecting to load test instance: %s", k.config.LoadTestInstance)
	loadTestClient, err := ssh.Dial("tcp", k.config.LoadTestInstance+":22", sshConfig)
	if err != nil {
		return fmt.Errorf("failed to connect to load test instance: %v", err)
	}
	k.loadTestSSH = loadTestClient

	log.Println("✅ SSH connections established")
	return nil
}

func (k *KafkaTestAutomation) executeCommand(client *ssh.Client, command string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create session: %v", err)
	}
	defer session.Close()

	output, err := session.CombinedOutput(command)
	return string(output), err
}

func (k *KafkaTestAutomation) CreateTopic() error {
	log.Printf("📋 Creating topic '%s' on RedPanda cluster...", k.config.Topic)
	
	cmd := fmt.Sprintf("sudo docker exec redpanda-0 rpk topic create '%s' --partitions 3 --replicas 3", 
		k.config.Topic)
	
	output, err := k.executeCommand(k.redPandaSSH, cmd)
	if err != nil {
		if strings.Contains(output, "already exists") || strings.Contains(output, "TOPIC_ALREADY_EXISTS") {
			log.Printf("⚠️  Topic '%s' already exists", k.config.Topic)
			return nil
		}
		return fmt.Errorf("failed to create topic: %v, output: %s", err, output)
	}
	
	log.Printf("✅ Topic '%s' created successfully", k.config.Topic)
	return nil
}

func (k *KafkaTestAutomation) DeployTestScript() error {
	log.Println("📝 Deploying test script to load test instance...")
	
	testScript := k.generateTestScript()
	if testScript == "" {
		return fmt.Errorf("failed to generate test script - CDK configuration not available")
	}
	
	// Create the test script on load test instance
	cmd := fmt.Sprintf(`cat > /home/ec2-user/kafka_automation.go << 'EOF'
%s
EOF`, testScript)
	
	_, err := k.executeCommand(k.loadTestSSH, cmd)
	if err != nil {
		return fmt.Errorf("failed to deploy test script: %v", err)
	}
	
	// Ensure Go modules are set up
	setupCmd := `
export PATH=/usr/local/go/bin:$PATH
cd /home/ec2-user
go mod init kafka-auto-test 2>/dev/null || true
go mod tidy 2>/dev/null || echo "Module setup complete"
`
	_, err = k.executeCommand(k.loadTestSSH, setupCmd)
	if err != nil {
		return fmt.Errorf("failed to setup Go modules: %v", err)
	}
	
	log.Println("✅ Test script deployed successfully")
	return nil
}

func (k *KafkaTestAutomation) RunTest() (string, error) {
	log.Println("🚀 Running kafka test on load test instance...")
	
	cmd := fmt.Sprintf(`
export PATH=/usr/local/go/bin:$PATH
cd /home/ec2-user
go run kafka_automation.go '%s' %d %d
`, k.config.Topic, k.config.Messages, k.config.TimeoutSeconds)
	
	output, err := k.executeCommand(k.loadTestSSH, cmd)
	if err != nil {
		return output, fmt.Errorf("test execution failed: %v", err)
	}
	
	return output, nil
}

func (k *KafkaTestAutomation) generateTestScript() string {
	// Get bootstrap servers from CDK config - no fallbacks
	config, err := GetStackConfigWithoutFallback("us-east-1", "RedPandaClusterStack")
	if err != nil {
		log.Printf("❌ Warning: Could not read CDK config for test script: %v", err)
		return ""
	}
	
	// Convert comma-separated string to Go slice format
	servers := strings.Split(config.BootstrapServers, ",")
	var formattedServers []string
	for _, server := range servers {
		formattedServers = append(formattedServers, fmt.Sprintf(`"%s"`, strings.TrimSpace(server)))
	}
	bootstrapServersStr := fmt.Sprintf("[]string{%s}", strings.Join(formattedServers, ", "))

	return fmt.Sprintf(`package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
)

func main() {
	if len(os.Args) < 4 {
		log.Fatal("Usage: go run kafka_automation.go <topic> <messages> <timeout>")
	}
	
	topic := os.Args[1]
	messages, _ := strconv.Atoi(os.Args[2])
	timeout, _ := strconv.Atoi(os.Args[3])
	
	bootstrapServers := %s
	
	log.Printf("🚀 Starting automated test: topic=%%s, messages=%%d, timeout=%%ds", topic, messages, timeout)
	
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
	defer cancel()
	
	// Test connectivity first
	log.Printf("🔍 Testing connectivity to RedPanda cluster...")
	testClient, err := kgo.NewClient(kgo.SeedBrokers(bootstrapServers...))
	if err != nil {
		log.Fatalf("❌ Connectivity test failed: %%v", err)
	}
	testClient.Close()
	log.Printf("✅ Connectivity test successful")
	
	// Producer phase
	log.Printf("📤 Starting producer phase...")
	producer, err := kgo.NewClient(
		kgo.SeedBrokers(bootstrapServers...),
		kgo.RequestTimeoutOverhead(10*time.Second),
	)
	if err != nil {
		log.Fatalf("❌ Failed to create producer: %%v", err)
	}
	defer producer.Close()
	
	messagesSent := 0
	producerStart := time.Now()
	
	for i := 0; i < messages; i++ {
		record := &kgo.Record{
			Topic: topic,
			Key:   []byte(fmt.Sprintf("auto-key-%%d", i)),
			Value: []byte(fmt.Sprintf("Auto-message #%%d produced at %%s", i, time.Now().Format(time.RFC3339))),
		}
		
		producer.Produce(ctx, record, func(r *kgo.Record, err error) {
			if err != nil {
				log.Printf("❌ Failed to send message %%d: %%v", i, err)
			} else {
				messagesSent++
			}
		})
	}
	
	if err := producer.Flush(ctx); err != nil {
		log.Printf("⚠️  Producer flush warning: %%v", err)
	}
	
	producerDuration := time.Since(producerStart)
	log.Printf("📤 Producer phase completed: %%d/%%d messages sent in %%v", messagesSent, messages, producerDuration)
	
	// Consumer phase
	log.Printf("📥 Starting consumer phase...")
	consumerGroupID := fmt.Sprintf("auto-test-group-%%d", time.Now().Unix())
	consumer, err := kgo.NewClient(
		kgo.SeedBrokers(bootstrapServers...),
		kgo.ConsumeTopics(topic),
		kgo.ConsumerGroup(consumerGroupID),
		kgo.FetchMaxWait(3*time.Second),
	)
	if err != nil {
		log.Fatalf("❌ Failed to create consumer: %%v", err)
	}
	defer consumer.Close()
	
	messagesReceived := 0
	consumerStart := time.Now()
	maxConsumerTime := time.Duration(timeout-5) * time.Second
	
	for time.Since(consumerStart) < maxConsumerTime && messagesReceived < messagesSent {
		fetches := consumer.PollFetches(ctx)
		if err := fetches.Err(); err != nil {
			if !strings.Contains(err.Error(), "context deadline exceeded") {
				log.Printf("❌ Consumer poll error: %%v", err)
			}
			break
		}
		
		fetches.EachPartition(func(p kgo.FetchTopicPartition) {
			for _, record := range p.Records {
				messagesReceived++
				if messagesReceived %% 10 == 0 || messagesReceived <= 5 {
					log.Printf("📥 Received message %%d: key=%%s", messagesReceived, string(record.Key))
				}
			}
		})
		
		if messagesReceived >= messagesSent {
			log.Printf("🎯 All messages received!")
			break
		}
	}
	
	consumerDuration := time.Since(consumerStart)
	totalDuration := time.Since(producerStart)
	
	// Calculate metrics
	successRate := float64(messagesReceived) / float64(messagesSent) * 100
	producerThroughput := float64(messagesSent) / producerDuration.Seconds()
	consumerThroughput := float64(messagesReceived) / consumerDuration.Seconds()
	
	// Results report
	fmt.Println()
	fmt.Println(strings.Repeat("=", 70))
	fmt.Printf("           AUTOMATED KAFKA TEST RESULTS - Topic: %%s\n", topic)
	fmt.Println(strings.Repeat("=", 70))
	fmt.Printf("Messages Sent:          %%d\n", messagesSent)
	fmt.Printf("Messages Received:      %%d\n", messagesReceived)
	fmt.Printf("Success Rate:           %%.1f%%%%\n", successRate)
	fmt.Printf("Producer Duration:      %%v\n", producerDuration)
	fmt.Printf("Consumer Duration:      %%v\n", consumerDuration)
	fmt.Printf("Total Test Duration:    %%v\n", totalDuration)
	fmt.Printf("Producer Throughput:    %%.2f msg/sec\n", producerThroughput)
	fmt.Printf("Consumer Throughput:    %%.2f msg/sec\n", consumerThroughput)
	fmt.Printf("Consumer Group:         %%s\n", consumerGroupID)
	
	if successRate >= 90.0 {
		fmt.Printf("Test Status:            ✅ SUCCESS\n")
	} else if successRate >= 70.0 {
		fmt.Printf("Test Status:            ⚠️  PARTIAL SUCCESS\n")
	} else {
		fmt.Printf("Test Status:            ❌ FAILED\n")
	}
	
	fmt.Println(strings.Repeat("=", 70))
	
	if successRate < 90.0 {
		log.Printf("⚠️  Success rate below 90%%%%, consider investigating cluster health")
	}
}`, bootstrapServersStr)
}

func (k *KafkaTestAutomation) Close() {
	if k.redPandaSSH != nil {
		k.redPandaSSH.Close()
	}
	if k.loadTestSSH != nil {
		k.loadTestSSH.Close()
	}
}

func main() {
	// Get configuration from CDK stack - no fallbacks
	config, err := GetStackConfigWithoutFallback("us-east-1", "RedPandaClusterStack")
	if err != nil {
		log.Fatalf("❌ Failed to read CDK stack configuration: %v\n"+
			"Please ensure:\n"+
			"  - AWS credentials are configured (aws configure or IAM role)\n"+
			"  - CDK stack 'RedPandaClusterStack' is deployed\n"+
			"  - AWS CLI is installed and accessible", err)
	}
	
	// Use CDK outputs for default values
	defaultRedPandaNode := config.ClusterPublicIPs[0]
	defaultLoadTestInstance := config.LoadTestIP

	var (
		topic            = flag.String("topic", fmt.Sprintf("auto-test-%d", time.Now().Unix()), "Kafka topic name")
		messages         = flag.Int("messages", 10, "Number of messages to send")
		timeoutSeconds   = flag.Int("timeout", 30, "Test timeout in seconds")
		keyPath          = flag.String("key", "/data/.ssh/john.davis.pem", "Path to SSH private key")
		redPandaNode     = flag.String("redpanda", defaultRedPandaNode, "RedPanda node IP address")
		loadTestInstance = flag.String("loadtest", defaultLoadTestInstance, "Load test instance IP address")
	)
	flag.Parse()

	log.SetFlags(log.LstdFlags | log.Lshortfile)
	
	kafkaConfig := &KafkaTestConfig{
		Topic:             *topic,
		Messages:          *messages,
		TimeoutSeconds:    *timeoutSeconds,
		KeyPath:           *keyPath,
		RedPandaNode:      *redPandaNode,
		LoadTestInstance:  *loadTestInstance,
	}

	log.Println("🚀 Starting automated Kafka test automation...")
	log.Printf("📡 Using CDK configuration: Bootstrap Servers: %s", config.BootstrapServers)
	log.Printf("📋 Test Configuration: topic=%s, messages=%d, timeout=%ds", 
		kafkaConfig.Topic, kafkaConfig.Messages, kafkaConfig.TimeoutSeconds)
	log.Printf("🔗 RedPanda Node: %s", kafkaConfig.RedPandaNode)
	log.Printf("🧪 Load Test Instance: %s", kafkaConfig.LoadTestInstance)

	automation := NewKafkaTestAutomation(kafkaConfig)
	defer automation.Close()

	// Step 1: Connect to instances
	if err := automation.Connect(); err != nil {
		log.Fatalf("❌ Connection failed: %v", err)
	}

	// Step 2: Create topic
	if err := automation.CreateTopic(); err != nil {
		log.Fatalf("❌ Topic creation failed: %v", err)
	}

	// Step 3: Deploy test script
	if err := automation.DeployTestScript(); err != nil {
		log.Fatalf("❌ Test script deployment failed: %v", err)
	}

	// Step 4: Run test
	output, err := automation.RunTest()
	if err != nil {
		log.Printf("❌ Test execution encountered an error: %v", err)
		log.Printf("📋 Test output:\n%s", output)
		return
	}

	// Display results
	fmt.Println()
	fmt.Println("📊 Test completed! Results from load test instance:")
	fmt.Println(strings.Repeat("-", 70))
	fmt.Print(output)
	
	if strings.Contains(output, "✅ SUCCESS") {
		log.Println("🎉 Automated kafka test completed successfully!")
	} else {
		log.Println("⚠️  Test completed with warnings or errors")
	}
} 