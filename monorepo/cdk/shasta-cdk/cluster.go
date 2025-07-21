package main

import (
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// ClusterNode represents a RedPanda node in the cluster
type ClusterNode struct {
	ID        int
	PublicIP  string
	PrivateIP string
	SSHClient *ssh.Client
}

// RedPandaCluster manages the entire cluster
type RedPandaCluster struct {
	Nodes       []*ClusterNode
	KeyPath     string
	LoadTestIP  string
}

// NewRedPandaCluster creates a new cluster instance
func NewRedPandaCluster(keyPath string) *RedPandaCluster {
	return &RedPandaCluster{
		KeyPath: keyPath,
		Nodes: []*ClusterNode{
			{ID: 0, PublicIP: "54.237.232.219", PrivateIP: "10.0.0.62"},
			{ID: 1, PublicIP: "44.200.162.222", PrivateIP: "10.0.1.15"},
			{ID: 2, PublicIP: "54.234.45.204", PrivateIP: "10.0.2.154"},
		},
		LoadTestIP: "54.173.123.191",
	}
}

// ConnectToNodes establishes SSH connections to all nodes
func (c *RedPandaCluster) ConnectToNodes() error {
	// Read private key
	key, err := os.ReadFile(c.KeyPath)
	if err != nil {
		return fmt.Errorf("unable to read private key: %v", err)
	}

	signer, err := ssh.ParsePrivateKey(key)
	if err != nil {
		return fmt.Errorf("unable to parse private key: %v", err)
	}

	config := &ssh.ClientConfig{
		User: "ec2-user",
		Auth: []ssh.AuthMethod{
			ssh.PublicKeys(signer),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         30 * time.Second,
	}

	// Connect to all nodes
	for _, node := range c.Nodes {
		log.Printf("Connecting to node %d at %s...", node.ID, node.PublicIP)
		client, err := ssh.Dial("tcp", node.PublicIP+":22", config)
		if err != nil {
			return fmt.Errorf("failed to connect to node %d: %v", node.ID, err)
		}
		node.SSHClient = client
		log.Printf("Successfully connected to node %d", node.ID)
	}

	return nil
}

// ExecuteCommand runs a command on a specific node
func (c *RedPandaCluster) ExecuteCommand(node *ClusterNode, command string) (string, error) {
	session, err := node.SSHClient.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create session: %v", err)
	}
	defer session.Close()

	output, err := session.CombinedOutput(command)
	if err != nil {
		return string(output), fmt.Errorf("command failed: %v", err)
	}

	return string(output), nil
}

// SetupRedPandaContainer sets up RedPanda container on a single node
func (c *RedPandaCluster) SetupRedPandaContainer(node *ClusterNode) error {
	log.Printf("🔧 Setting up RedPanda container on node %d (%s)...", node.ID, node.PublicIP)

	// Create RedPanda configuration
	config := c.generateRedPandaConfig(node)
	
	// Commands to set up RedPanda
			commands := []string{
		"sudo mkdir -p /opt/redpanda/data",
		"sudo chown -R ec2-user:ec2-user /opt/redpanda/data",
		"sudo chmod -R 755 /opt/redpanda/data",
		fmt.Sprintf("cat > /tmp/redpanda.yaml << 'EOF'\n%s\nEOF", config),
		"sudo docker stop redpanda-" + fmt.Sprintf("%d", node.ID) + " 2>/dev/null || true",
		"sudo docker rm redpanda-" + fmt.Sprintf("%d", node.ID) + " 2>/dev/null || true",
		fmt.Sprintf(`sudo docker run -d \
  --name redpanda-%d \
  --hostname redpanda-%d \
  --network host \
  --restart unless-stopped \
  --user root \
  -v /tmp/redpanda.yaml:/etc/redpanda/redpanda.yaml \
  -v /opt/redpanda/data:/var/lib/redpanda/data \
  redpandadata/redpanda:latest \
  redpanda start --config /etc/redpanda/redpanda.yaml --check=false`, node.ID, node.ID),
	}

	for i, cmd := range commands {
		cmdDesc := strings.Split(cmd, "\n")[0]
		log.Printf("🔧 Node %d [%d/%d]: %s", node.ID, i+1, len(commands), cmdDesc)
		output, err := c.ExecuteCommand(node, cmd)
		if err != nil {
			log.Printf("❌ Command failed on node %d: %s", node.ID, output)
			return fmt.Errorf("failed to execute command on node %d: %v", node.ID, err)
		}
		if strings.TrimSpace(output) != "" {
			log.Printf("📋 Output: %s", strings.TrimSpace(output))
		}
	}

	// Wait for container to start
	log.Printf("Waiting for RedPanda container to start on node %d...", node.ID)
	time.Sleep(10 * time.Second)

	// Check if container is running
	output, err := c.ExecuteCommand(node, "sudo docker ps --filter name=redpanda-"+fmt.Sprintf("%d", node.ID))
	if err != nil {
		return fmt.Errorf("failed to check container status on node %d: %v", node.ID, err)
	}
	
	if !strings.Contains(output, "redpanda-"+fmt.Sprintf("%d", node.ID)) {
		return fmt.Errorf("RedPanda container failed to start on node %d", node.ID)
	}

	log.Printf("RedPanda container successfully started on node %d", node.ID)
	return nil
}

// generateRedPandaConfig creates the RedPanda configuration for a node
func (c *RedPandaCluster) generateRedPandaConfig(node *ClusterNode) string {
	// Build seed servers list
	var seedServers strings.Builder
	for _, n := range c.Nodes {
		seedServers.WriteString(fmt.Sprintf(`    - host:
        address: %s
        port: 33145
`, n.PrivateIP))
	}

	config := fmt.Sprintf(`redpanda:
  data_directory: /var/lib/redpanda/data
  node_id: %d
  rpc_server:
    address: 0.0.0.0
    port: 33145
  kafka_api:
    - address: 0.0.0.0
      port: 9092
  admin:
    - address: 0.0.0.0
      port: 9644
  advertised_rpc_api:
    address: %s
    port: 33145
  advertised_kafka_api:
    - address: %s
      port: 9092
  seed_servers:
%s
schema_registry:
  schema_registry_api:
    - address: 0.0.0.0
      port: 8081

pandaproxy:
  pandaproxy_api:
    - address: 0.0.0.0
      port: 8082`, 
		node.ID, node.PrivateIP, node.PrivateIP, seedServers.String())

	return config
}

// SetupCluster sets up RedPanda on all nodes
func (c *RedPandaCluster) SetupCluster() error {
	log.Println("Starting RedPanda cluster setup...")
	
	// Set up RedPanda on each node
	for _, node := range c.Nodes {
		if err := c.SetupRedPandaContainer(node); err != nil {
			return fmt.Errorf("failed to setup node %d: %v", node.ID, err)
		}
	}

	// Wait for cluster to stabilize
	log.Println("Waiting for cluster to stabilize...")
	time.Sleep(60 * time.Second)

	// Verify cluster health
	if err := c.VerifyClusterHealth(); err != nil {
		return fmt.Errorf("cluster health check failed: %v", err)
	}

	log.Println("RedPanda cluster setup completed successfully!")
	return nil
}

// VerifyClusterHealth checks if the cluster is healthy
func (c *RedPandaCluster) VerifyClusterHealth() error {
	log.Println("Verifying cluster health...")

	// Check each node with retries
	for _, node := range c.Nodes {
		for attempt := 1; attempt <= 3; attempt++ {
			log.Printf("Health check attempt %d for node %d", attempt, node.ID)
			
			// First check if container is running
			statusCmd := "sudo docker ps --filter name=redpanda-" + fmt.Sprintf("%d", node.ID) + " --format '{{.Status}}'"
			statusOutput, err := c.ExecuteCommand(node, statusCmd)
			if err != nil {
				log.Printf("Failed to check container status for node %d: %v", node.ID, err)
				if attempt == 3 {
					return fmt.Errorf("node %d container status check failed after 3 attempts", node.ID)
				}
				time.Sleep(10 * time.Second)
				continue
			}
			
			if !strings.Contains(statusOutput, "Up") {
				log.Printf("Node %d container status: %s", node.ID, statusOutput)
				// Check container logs for troubleshooting
				logsCmd := "sudo docker logs --tail 10 redpanda-" + fmt.Sprintf("%d", node.ID)
				logsOutput, _ := c.ExecuteCommand(node, logsCmd)
				log.Printf("Node %d container logs:\n%s", node.ID, logsOutput)
				
				if attempt == 3 {
					return fmt.Errorf("node %d container is not running after 3 attempts", node.ID)
				}
				time.Sleep(10 * time.Second)
				continue
			}
			
			// Now check RedPanda health
			cmd := "sudo docker exec redpanda-" + fmt.Sprintf("%d", node.ID) + " rpk cluster info --brokers localhost:9092"
			output, err := c.ExecuteCommand(node, cmd)
			if err != nil {
				log.Printf("RPK command failed for node %d (attempt %d): %s", node.ID, attempt, output)
				if attempt == 3 {
					return fmt.Errorf("node %d health check failed after 3 attempts: %v", node.ID, err)
				}
				time.Sleep(10 * time.Second)
				continue
			}
			
			log.Printf("Node %d is healthy", node.ID)
			break
		}
	}

	log.Println("All nodes are healthy!")
	return nil
}

// Close closes all SSH connections
func (c *RedPandaCluster) Close() {
	for _, node := range c.Nodes {
		if node.SSHClient != nil {
			node.SSHClient.Close()
		}
	}
}

// GetBootstrapServers returns the bootstrap servers string for Kafka clients
func (c *RedPandaCluster) GetBootstrapServers() string {
	var servers []string
	for _, node := range c.Nodes {
		servers = append(servers, node.PrivateIP+":9092")
	}
	return strings.Join(servers, ",")
} 