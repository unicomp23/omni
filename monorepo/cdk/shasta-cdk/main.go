package main

import (
	"flag"
	"log"
	"os"
	"strings"
	"time"
)

func main() {
	// Command line flags
	var (
		keyPath          = flag.String("key", "/data/.ssh/john.davis.pem", "Path to SSH private key")
		setupCluster     = flag.Bool("setup", true, "Set up RedPanda cluster")
		runTest          = flag.Bool("test", true, "Run load test")
		skipClusterSetup = flag.Bool("skip-setup", false, "Skip cluster setup (use existing cluster)")
		numProducers     = flag.Int("producers", 3, "Number of producer goroutines")
		numConsumers     = flag.Int("consumers", 3, "Number of consumer goroutines")
		messagesPerProducer = flag.Int("messages", 10000, "Messages per producer")
		messageSize      = flag.Int("size", 1024, "Message size in bytes")
		testDuration     = flag.Duration("duration", 5*time.Minute, "Test duration")
		topic            = flag.String("topic", "load-test-topic", "Kafka topic name")
	)
	flag.Parse()

	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("Starting RedPanda Cluster Automation...")

	// Validate key file exists
	if _, err := os.Stat(*keyPath); os.IsNotExist(err) {
		log.Fatalf("SSH key file not found: %s", *keyPath)
	}

	// Create cluster instance
	cluster := NewRedPandaCluster(*keyPath)
	defer cluster.Close()

	// Set up cluster if requested
	if *setupCluster && !*skipClusterSetup {
		log.Println("Setting up RedPanda cluster...")
		
		// Connect to nodes
		if err := cluster.ConnectToNodes(); err != nil {
			log.Fatalf("Failed to connect to nodes: %v", err)
		}
		
		// Set up cluster
		if err := cluster.SetupCluster(); err != nil {
			log.Fatalf("Failed to setup cluster: %v", err)
		}
		
		log.Println("✅ RedPanda cluster setup completed successfully!")
	} else if *skipClusterSetup {
		log.Println("Skipping cluster setup (using existing cluster)")
		// Still need to connect for health checks
		if err := cluster.ConnectToNodes(); err != nil {
			log.Fatalf("Failed to connect to nodes: %v", err)
		}
	}

	// Run load test if requested
	if *runTest {
		log.Println("Starting load test...")
		
		// Configure load test
		config := &LoadTestConfig{
			BootstrapServers: cluster.GetBootstrapServers(),
			Topic:            *topic,
			NumProducers:     *numProducers,
			NumConsumers:     *numConsumers,
			MessagesPerProducer: *messagesPerProducer,
			MessageSize:      *messageSize,
			TestDuration:     *testDuration,
			SuccessThreshold: 0.95, // 95% of messages must be consumed for success
			MaxWaitAfterProducers: 30 * time.Second, // Wait max 30s for consumers after producers finish
		}
		
		log.Printf("Load test configuration: %+v", config)
		
		// Run the test
		results, err := RunLoadTest(config)
		if err != nil {
			log.Fatalf("Load test failed: %v", err)
		}
		
		// Print results
		PrintLoadTestResults(results)
		
		// Additional cluster information
		printClusterInfo(cluster)
		
		log.Println("✅ Load test completed successfully!")
	}

	log.Println("🎉 All operations completed!")
}

// printClusterInfo displays cluster connection information
func printClusterInfo(cluster *RedPandaCluster) {
	log.Println("\n" + strings.Repeat("=", 60))
	log.Println("              CLUSTER INFORMATION")
	log.Println(strings.Repeat("=", 60))
	log.Printf("Bootstrap Servers: %s\n", cluster.GetBootstrapServers())
	log.Printf("Load Test Instance: %s\n", cluster.LoadTestIP)
	log.Println("\nCluster Nodes:")
	for _, node := range cluster.Nodes {
		log.Printf("  Node %d: %s (private: %s)\n", node.ID, node.PublicIP, node.PrivateIP)
	}
	log.Println("\nSSH Commands for manual access:")
	for _, node := range cluster.Nodes {
		log.Printf("  ssh -i %s ec2-user@%s  # Node %d\n", cluster.KeyPath, node.PublicIP, node.ID)
	}
	log.Printf("  ssh -i %s ec2-user@%s  # Load Test Instance\n", cluster.KeyPath, cluster.LoadTestIP)
	log.Println(strings.Repeat("=", 60))
} 