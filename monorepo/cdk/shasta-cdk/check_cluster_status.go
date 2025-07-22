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

type ClusterStatusChecker struct {
	keyPath   string
	nodes     []ClusterNodeInfo
	sshClient map[string]*ssh.Client
}

type ClusterNodeInfo struct {
	ID        int
	PublicIP  string
	PrivateIP string
	Name      string
}

type ContainerStatus struct {
	NodeID    int
	Name      string
	Status    string
	CreatedAt string
	Health    string
}

type ClusterHealth struct {
	Healthy                     bool
	Controllers                 []int
	AllNodes                   []int
	NodesDown                  []int
	LeaderlessPartitions       int
	UnderReplicatedPartitions  int
	ClusterUUID                string
}

func NewClusterStatusChecker(keyPath string) (*ClusterStatusChecker, error) {
	// Get configuration from CDK stack - no fallbacks
	config, err := GetStackConfigWithoutFallback("us-east-1", "RedPandaClusterStack")
	if err != nil {
		return nil, fmt.Errorf("failed to read CDK stack configuration: %v\n"+
			"Please ensure:\n"+
			"  - AWS credentials are configured (aws configure or IAM role)\n"+
			"  - CDK stack 'RedPandaClusterStack' is deployed\n"+
			"  - AWS CLI is installed and accessible", err)
	}
	
	log.Println("📡 Successfully loaded configuration from CDK stack outputs")
	
	var nodes []ClusterNodeInfo
	nodeInfos := config.GetNodesInfo()
	
	for _, nodeInfo := range nodeInfos {
		nodes = append(nodes, ClusterNodeInfo{
			ID:        nodeInfo.ID,
			PublicIP:  nodeInfo.PublicIP,
			PrivateIP: nodeInfo.PrivateIP,
			Name:      fmt.Sprintf("Node %d", nodeInfo.ID),
		})
	}
	
	return &ClusterStatusChecker{
		keyPath:   keyPath,
		nodes:     nodes,
		sshClient: make(map[string]*ssh.Client),
	}, nil
}

func (c *ClusterStatusChecker) Connect() error {
	log.Println("🔐 Connecting to cluster nodes...")
	
	// Read private key
	key, err := os.ReadFile(c.keyPath)
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
		Timeout:         10 * time.Second,
	}

	// Connect to all nodes
	for _, node := range c.nodes {
		log.Printf("🔗 Connecting to %s (%s)...", node.Name, node.PublicIP)
		client, err := ssh.Dial("tcp", node.PublicIP+":22", sshConfig)
		if err != nil {
			log.Printf("❌ Failed to connect to %s: %v", node.Name, err)
			continue
		}
		c.sshClient[node.PublicIP] = client
		log.Printf("✅ Connected to %s", node.Name)
	}

	if len(c.sshClient) == 0 {
		return fmt.Errorf("failed to connect to any nodes")
	}

	log.Printf("✅ Connected to %d/%d nodes", len(c.sshClient), len(c.nodes))
	return nil
}

func (c *ClusterStatusChecker) executeCommand(nodeIP, command string) (string, error) {
	client, exists := c.sshClient[nodeIP]
	if !exists {
		return "", fmt.Errorf("no connection to node %s", nodeIP)
	}

	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create session: %v", err)
	}
	defer session.Close()

	output, err := session.CombinedOutput(command)
	return string(output), err
}

func (c *ClusterStatusChecker) CheckContainerStatus() []ContainerStatus {
	log.Println("🐳 Checking container status on all nodes...")
	
	var statuses []ContainerStatus
	
	for _, node := range c.nodes {
		if _, exists := c.sshClient[node.PublicIP]; !exists {
			log.Printf("⚠️  Skipping %s (no connection)", node.Name)
			statuses = append(statuses, ContainerStatus{
				NodeID:    node.ID,
				Name:      fmt.Sprintf("redpanda-%d", node.ID),
				Status:    "NO_CONNECTION",
				CreatedAt: "N/A",
				Health:    "UNKNOWN",
			})
			continue
		}

		// Check if container exists and get status
		cmd := fmt.Sprintf("sudo docker ps -a --filter name=redpanda-%d --format '{{.Names}}\t{{.Status}}\t{{.CreatedAt}}'", node.ID)
		output, err := c.executeCommand(node.PublicIP, cmd)
		
		if err != nil || strings.TrimSpace(output) == "" {
			log.Printf("❌ %s: No RedPanda container found", node.Name)
			statuses = append(statuses, ContainerStatus{
				NodeID:    node.ID,
				Name:      fmt.Sprintf("redpanda-%d", node.ID),
				Status:    "NOT_FOUND",
				CreatedAt: "N/A",
				Health:    "NOT_RUNNING",
			})
			continue
		}

		// Parse container status
		parts := strings.Split(strings.TrimSpace(output), "\t")
		if len(parts) >= 3 {
			containerName := parts[0]
			status := parts[1]
			createdAt := parts[2]
			
			// Determine health
			health := "UNHEALTHY"
			if strings.Contains(status, "Up") {
				health = "RUNNING"
			} else if strings.Contains(status, "Exited") {
				health = "STOPPED"
			} else if strings.Contains(status, "Restarting") {
				health = "RESTARTING"
			}

			statuses = append(statuses, ContainerStatus{
				NodeID:    node.ID,
				Name:      containerName,
				Status:    status,
				CreatedAt: createdAt,
				Health:    health,
			})

			log.Printf("📦 %s: %s (%s)", node.Name, health, status)
		}
	}
	
	return statuses
}

func (c *ClusterStatusChecker) CheckClusterHealth() *ClusterHealth {
	log.Println("🏥 Checking cluster health...")
	
	// Try to get cluster health from any running node
	for _, node := range c.nodes {
		if _, exists := c.sshClient[node.PublicIP]; !exists {
			continue
		}

		cmd := fmt.Sprintf("sudo docker exec redpanda-%d rpk cluster health --brokers localhost:9092 2>/dev/null", node.ID)
		output, err := c.executeCommand(node.PublicIP, cmd)
		
		if err != nil {
			log.Printf("⚠️  %s: Cannot get cluster health: %v", node.Name, err)
			continue
		}

		// Parse cluster health output
		health := &ClusterHealth{}
		lines := strings.Split(output, "\n")
		
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "Healthy:") {
				health.Healthy = strings.Contains(line, "true")
			} else if strings.Contains(line, "Controller ID:") {
				// Parse controller info
			} else if strings.Contains(line, "All nodes:") {
				// Parse nodes info
			} else if strings.Contains(line, "Leaderless partitions") {
				// Parse partition info
			}
		}
		
		log.Printf("🏥 Cluster Health: %t", health.Healthy)
		return health
	}
	
	log.Println("❌ Could not determine cluster health from any node")
	return &ClusterHealth{Healthy: false}
}

func (c *ClusterStatusChecker) CheckBrokerInfo() {
	log.Println("🌐 Checking broker information...")
	
	// Try to get broker info from any running node
	for _, node := range c.nodes {
		if _, exists := c.sshClient[node.PublicIP]; !exists {
			continue
		}

		cmd := fmt.Sprintf("sudo docker exec redpanda-%d rpk cluster info --brokers localhost:9092 2>/dev/null", node.ID)
		output, err := c.executeCommand(node.PublicIP, cmd)
		
		if err != nil {
			log.Printf("⚠️  %s: Cannot get broker info: %v", node.Name, err)
			continue
		}

		if strings.TrimSpace(output) != "" {
			fmt.Println("📋 Broker Information:")
			fmt.Println(strings.Repeat("-", 50))
			fmt.Print(output)
			fmt.Println(strings.Repeat("-", 50))
			return
		}
	}
	
	log.Println("❌ Could not get broker information from any node")
}

func (c *ClusterStatusChecker) PrintStatusSummary(containerStatuses []ContainerStatus, clusterHealth *ClusterHealth) {
	fmt.Println()
	fmt.Println(strings.Repeat("=", 70))
	fmt.Println("                    CLUSTER STATUS SUMMARY")
	fmt.Println(strings.Repeat("=", 70))
	
	// Container Status Summary
	fmt.Println("📦 CONTAINER STATUS:")
	runningCount := 0
	for _, status := range containerStatuses {
		icon := "❌"
		if status.Health == "RUNNING" {
			icon = "✅"
			runningCount++
		} else if status.Health == "NO_CONNECTION" {
			icon = "🔌"
		} else if status.Health == "NOT_FOUND" {
			icon = "❓"
		}
		
		fmt.Printf("   %s Node %d (%s): %s\n", icon, status.NodeID, status.Name, status.Health)
		if status.CreatedAt != "N/A" {
			fmt.Printf("      Created: %s\n", status.CreatedAt)
		}
	}
	
	fmt.Printf("\n📊 SUMMARY: %d/%d containers running\n", runningCount, len(containerStatuses))
	
	// Cluster Health Summary
	fmt.Printf("🏥 CLUSTER HEALTH: ")
	if clusterHealth.Healthy {
		fmt.Printf("✅ HEALTHY\n")
	} else {
		fmt.Printf("❌ UNHEALTHY\n")
	}
	
	// Recommendations
	fmt.Println("\n💡 RECOMMENDATIONS:")
	if runningCount == 0 {
		fmt.Println("   🔧 Run full cluster setup: ./redpanda-automation")
		fmt.Println("   🚀 Or use: go run kafka_test_automation.go")
	} else if runningCount == len(containerStatuses) && clusterHealth.Healthy {
		fmt.Println("   ✅ Cluster is ready! Skip setup and run tests:")
		fmt.Println("   🧪 ./redpanda-automation -setup=false -skip-setup")
		fmt.Println("   🚀 ./kafka_test_automation -messages 10 -timeout 20")
	} else {
		fmt.Println("   ⚠️  Partial cluster running. Consider:")
		fmt.Println("   🔄 Full restart: ./redpanda-automation")
		fmt.Println("   🔍 Manual investigation: Check individual nodes")
	}
	
	fmt.Println(strings.Repeat("=", 70))
}

func (c *ClusterStatusChecker) Close() {
	for _, client := range c.sshClient {
		client.Close()
	}
}

func main() {
	var (
		keyPath = flag.String("key", "/data/.ssh/john.davis.pem", "Path to SSH private key")
		verbose = flag.Bool("verbose", false, "Show detailed output")
	)
	flag.Parse()

	log.SetFlags(log.LstdFlags | log.Lshortfile)
	if !*verbose {
		log.SetFlags(0) // Reduce log verbosity
	}

	fmt.Println("🔍 RedPanda Cluster Status Checker")
	fmt.Println("==================================")

	checker, err := NewClusterStatusChecker(*keyPath)
	if err != nil {
		log.Fatalf("❌ Failed to initialize cluster status checker: %v", err)
	}
	defer checker.Close()

	// Step 1: Connect to nodes
	if err := checker.Connect(); err != nil {
		log.Fatalf("❌ Failed to connect: %v", err)
	}

	// Step 2: Check container status
	containerStatuses := checker.CheckContainerStatus()

	// Step 3: Check cluster health
	clusterHealth := checker.CheckClusterHealth()

	// Step 4: Get broker information if cluster is healthy
	if clusterHealth.Healthy {
		checker.CheckBrokerInfo()
	}

	// Step 5: Print summary and recommendations
	checker.PrintStatusSummary(containerStatuses, clusterHealth)
} 