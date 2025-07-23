package main

import (
	"bufio"
	"fmt"
	"io/ioutil"
	"log"
	"net"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/cloudformation"
	"golang.org/x/crypto/ssh"
	"gopkg.in/yaml.v2"
)

type ClusterConfig struct {
	StackName       string
	Region          string
	KeyPath         string
	RedPandaVersion string
	Nodes           []NodeConfig
}

type NodeConfig struct {
	ID        int
	PrivateIP string
	PublicIP  string
	Hostname  string
}

type RedPandaConfig struct {
	RedPanda RedPandaSettings `yaml:"redpanda"`
	Pandaproxy PandaproxySettings `yaml:"pandaproxy"`
	SchemaRegistry SchemaRegistrySettings `yaml:"schema_registry"`
}

type RedPandaSettings struct {
	DataDirectory       string                   `yaml:"data_directory"`
	NodeID             int                      `yaml:"node_id"`
	RpcServer          ServerConfig             `yaml:"rpc_server"`
	KafkaAPI           []ServerConfig           `yaml:"kafka_api"`
	AdminAPI           []ServerConfig           `yaml:"admin"`
	SeedServers        []SeedServer             `yaml:"seed_servers"`
	DeveloperMode      bool                     `yaml:"developer_mode"`
	AutoCreateTopics   bool                     `yaml:"auto_create_topics_enabled"`
}

type PandaproxySettings struct {
	PandaproxyAPI []ServerConfig `yaml:"pandaproxy_api"`
}

type SchemaRegistrySettings struct {
	SchemaRegistryAPI []ServerConfig `yaml:"schema_registry_api"`
}

type ServerConfig struct {
	Address string `yaml:"address"`
	Port    int    `yaml:"port"`
}

type SeedServer struct {
	Host ServerConfig `yaml:"host"`
}

func main() {
	fmt.Println("RedPanda Cluster Setup Tool")
	fmt.Println("===========================")

	config := &ClusterConfig{
		StackName:       getEnvOrDefault("STACK_NAME", "RedPandaClusterStack"),
		Region:          getEnvOrDefault("AWS_DEFAULT_REGION", "us-east-1"),
		KeyPath:         getEnvOrDefault("KEY_PATH", "/data/.ssh/john.davis.pem"),
		RedPandaVersion: getEnvOrDefault("REDPANDA_VERSION", "latest"),
	}

	fmt.Printf("Stack: %s, Region: %s\n", config.StackName, config.Region)
	fmt.Printf("RedPanda Version: %s\n", config.RedPandaVersion)

	// Fetch cluster information from CloudFormation
	if err := fetchClusterInfo(config); err != nil {
		log.Fatalf("Failed to fetch cluster info: %v", err)
	}

	fmt.Printf("Found %d RedPanda nodes:\n", len(config.Nodes))
	for _, node := range config.Nodes {
		fmt.Printf("  Node %d: %s (public: %s)\n", node.ID, node.PrivateIP, node.PublicIP)
	}

	// Confirm before proceeding (unless non-interactive mode)
	nonInteractive := strings.ToLower(getEnvOrDefault("NON_INTERACTIVE", "false")) == "true"
	
	if !nonInteractive {
		fmt.Print("\nProceed with RedPanda cluster setup? (y/N): ")
		scanner := bufio.NewScanner(os.Stdin)
		scanner.Scan()
		if strings.ToLower(scanner.Text()) != "y" {
			fmt.Println("Setup cancelled.")
			return
		}
	} else {
		fmt.Println("\nRunning in non-interactive mode, proceeding with setup...")
	}

	// Setup each node
	for i, node := range config.Nodes {
		fmt.Printf("\n=== Setting up Node %d (%s) ===\n", node.ID, node.PrivateIP)
		if err := setupRedPandaNode(config, node); err != nil {
			log.Printf("Failed to setup node %d: %v", node.ID, err)
			continue
		}
		fmt.Printf("Node %d setup complete\n", node.ID)
		
		// Wait between nodes to avoid overwhelming
		if i < len(config.Nodes)-1 {
			time.Sleep(5 * time.Second)
		}
	}

	// Verify cluster health with polling
	fmt.Println("\n=== Verifying Cluster Health ===")
	if err := verifyClusterHealth(config); err != nil {
		log.Fatalf("Cluster health check failed: %v", err)
	}

	fmt.Println("\n=== Setup Complete ===")
	fmt.Println("🎉 RedPanda cluster is healthy and ready!")
	fmt.Printf("Bootstrap brokers: %s\n", getBootstrapBrokers(config.Nodes))
	fmt.Println("✅ All systems operational!")
}

func getEnvOrDefault(envVar, defaultValue string) string {
	if value := os.Getenv(envVar); value != "" {
		return value
	}
	return defaultValue
}

func fetchClusterInfo(config *ClusterConfig) error {
	sess, err := session.NewSession(&aws.Config{
		Region: aws.String(config.Region),
	})
	if err != nil {
		return fmt.Errorf("failed to create AWS session: %w", err)
	}

	cfSvc := cloudformation.New(sess)

	// Get stack outputs
	input := &cloudformation.DescribeStacksInput{
		StackName: aws.String(config.StackName),
	}

	result, err := cfSvc.DescribeStacks(input)
	if err != nil {
		return fmt.Errorf("failed to describe stack: %w", err)
	}

	if len(result.Stacks) == 0 {
		return fmt.Errorf("stack %s not found", config.StackName)
	}

	stack := result.Stacks[0]
	outputs := make(map[string]string)
	
	for _, output := range stack.Outputs {
		if output.OutputKey != nil && output.OutputValue != nil {
			outputs[*output.OutputKey] = *output.OutputValue
		}
	}

	// Parse cluster IPs
	privateIPs := strings.Split(outputs["RedPandaClusterIPs"], ",")
	publicIPs := strings.Split(outputs["RedPandaClusterPublicIPs"], ",")

	if len(privateIPs) != len(publicIPs) {
		return fmt.Errorf("mismatch between private and public IP counts")
	}

	// Create node configurations
	for i, privateIP := range privateIPs {
		privateIP = strings.TrimSpace(privateIP)
		publicIP := strings.TrimSpace(publicIPs[i])
		
		node := NodeConfig{
			ID:        i,
			PrivateIP: privateIP,
			PublicIP:  publicIP,
			Hostname:  fmt.Sprintf("redpanda-%d", i),
		}
		config.Nodes = append(config.Nodes, node)
	}

	return nil
}

func setupRedPandaNode(config *ClusterConfig, node NodeConfig) error {
	// Create SSH connection
	client, err := createSSHClient(node.PublicIP, config.KeyPath)
	if err != nil {
		return fmt.Errorf("failed to create SSH client: %w", err)
	}
	defer client.Close()

	fmt.Printf("Connected to node %d via SSH\n", node.ID)

	// Generate RedPanda configuration
	rpConfig := generateRedPandaConfig(config, node)
	configYAML, err := yaml.Marshal(rpConfig)
	if err != nil {
		return fmt.Errorf("failed to marshal RedPanda config: %w", err)
	}

	// Setup commands for native installation
	commands := []string{
		// Ensure Redpanda is stopped before configuration
		"sudo systemctl stop redpanda || true",
		
		// Create directories (should already exist from package installation)
		"sudo mkdir -p /etc/redpanda /var/lib/redpanda/data",
		"sudo chown -R redpanda:redpanda /var/lib/redpanda/data",
		"sudo chown -R redpanda:redpanda /etc/redpanda",
		
		// Set proper permissions
		"sudo chmod 755 /var/lib/redpanda/data",
		"sudo chmod 755 /etc/redpanda",
	}

	for _, cmd := range commands {
		if err := executeSSHCommand(client, cmd); err != nil {
			return fmt.Errorf("failed to execute command '%s': %w", cmd, err)
		}
	}

	// Apply ultra-low latency network optimizations
	fmt.Printf("⚡ Applying ultra-low latency network optimizations on node %d...\n", node.ID)
	if err := applyNetworkOptimizations(client); err != nil {
		fmt.Printf("⚠️  Warning: Failed to apply network optimizations on node %d: %v\n", node.ID, err)
		// Continue anyway - this is not critical for basic functionality
	}

	// Upload configuration file to the native config location
	configPath := "/etc/redpanda/redpanda.yaml"
	if err := uploadFile(client, configYAML, configPath); err != nil {
		return fmt.Errorf("failed to upload config: %w", err)
	}

	// Set proper ownership and permissions for config file
	if err := executeSSHCommand(client, "sudo chown redpanda:redpanda /etc/redpanda/redpanda.yaml"); err != nil {
		return fmt.Errorf("failed to set config file ownership: %w", err)
	}

	// Start and enable Redpanda service
	if err := executeSSHCommand(client, "sudo systemctl start redpanda"); err != nil {
		return fmt.Errorf("failed to start RedPanda service: %w", err)
	}

	if err := executeSSHCommand(client, "sudo systemctl enable redpanda"); err != nil {
		return fmt.Errorf("failed to enable RedPanda service: %w", err)
	}

	// Wait for service to start
	time.Sleep(10 * time.Second)

	// Check service status
	if err := executeSSHCommand(client, "sudo systemctl is-active redpanda"); err != nil {
		// Get more detailed status information
		executeSSHCommand(client, "sudo systemctl status redpanda")
		executeSSHCommand(client, "sudo journalctl -u redpanda --lines=20 --no-pager")
		return fmt.Errorf("RedPanda service is not running: %w", err)
	}

	fmt.Printf("RedPanda service started on node %d\n", node.ID)
	return nil
}

func generateRedPandaConfig(config *ClusterConfig, node NodeConfig) RedPandaConfig {
	// Generate seed servers (all nodes including this one)
	var seedServers []SeedServer
	for _, n := range config.Nodes {
		seedServers = append(seedServers, SeedServer{
			Host: ServerConfig{
				Address: n.PrivateIP,
				Port:    33145,
			},
		})
	}

	return RedPandaConfig{
		RedPanda: RedPandaSettings{
			DataDirectory: "/var/lib/redpanda/data",
			NodeID:       node.ID,
			RpcServer: ServerConfig{
				Address: node.PrivateIP,
				Port:    33145,
			},
			KafkaAPI: []ServerConfig{
				{
					Address: node.PrivateIP,
					Port:    9092,
				},
			},
			AdminAPI: []ServerConfig{
				{
					Address: node.PrivateIP,
					Port:    9644,
				},
			},
			SeedServers:        seedServers,
			DeveloperMode:      false,
			AutoCreateTopics:   true,
		},
		Pandaproxy: PandaproxySettings{
			PandaproxyAPI: []ServerConfig{
				{
					Address: node.PrivateIP,
					Port:    8082,
				},
			},
		},
		SchemaRegistry: SchemaRegistrySettings{
			SchemaRegistryAPI: []ServerConfig{
				{
					Address: node.PrivateIP,
					Port:    8081,
				},
			},
		},
	}
}

func createSSHClient(host, keyPath string) (*ssh.Client, error) {
	// Read private key
	key, err := ioutil.ReadFile(keyPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read private key: %w", err)
	}

	// Parse private key
	signer, err := ssh.ParsePrivateKey(key)
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	// Create SSH config
	config := &ssh.ClientConfig{
		User: "ec2-user",
		Auth: []ssh.AuthMethod{
			ssh.PublicKeys(signer),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // In production, use proper host key verification
		Timeout:         30 * time.Second,
	}

	// Connect
	client, err := ssh.Dial("tcp", net.JoinHostPort(host, "22"), config)
	if err != nil {
		return nil, fmt.Errorf("failed to connect via SSH: %w", err)
	}

	return client, nil
}

func executeSSHCommand(client *ssh.Client, command string) error {
	session, err := client.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()

	output, err := session.CombinedOutput(command)
	if err != nil {
		return fmt.Errorf("command failed: %s, output: %s", err, string(output))
	}

	fmt.Printf("Command: %s\n", command)
	if len(output) > 0 {
		fmt.Printf("Output: %s\n", string(output))
	}

	return nil
}

func uploadFile(client *ssh.Client, content []byte, remotePath string) error {
	session, err := client.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()

	// Create directory if needed
	dir := remotePath[:strings.LastIndex(remotePath, "/")]
	if err := executeSSHCommand(client, fmt.Sprintf("sudo mkdir -p %s", dir)); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	// Write content to temporary file
	tempFile := "/tmp/redpanda_config.yaml"
	cmd := fmt.Sprintf("cat > %s << 'EOF'\n%s\nEOF", tempFile, string(content))
	
	if err := executeSSHCommand(client, cmd); err != nil {
		return fmt.Errorf("failed to write temp file: %w", err)
	}

	// Move to final location with proper permissions
	if err := executeSSHCommand(client, fmt.Sprintf("sudo mv %s %s", tempFile, remotePath)); err != nil {
		return fmt.Errorf("failed to move file: %w", err)
	}

	if err := executeSSHCommand(client, fmt.Sprintf("sudo chown ec2-user:ec2-user %s", remotePath)); err != nil {
		return fmt.Errorf("failed to change ownership: %w", err)
	}

	return nil
}

func verifyClusterHealth(config *ClusterConfig) error {
	fmt.Println("🔍 Polling cluster status until healthy...")
	
	// Connect to first node to check cluster status
	client, err := createSSHClient(config.Nodes[0].PublicIP, config.KeyPath)
	if err != nil {
		return fmt.Errorf("failed to connect to node 0: %w", err)
	}
	defer client.Close()

	expectedBrokers := len(config.Nodes)
	maxAttempts := 60 // 5 minutes with 5-second intervals
	
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		fmt.Printf("  Attempt %d/%d: Checking cluster health...\n", attempt, maxAttempts)
		
		// Check if cluster is responding
		session, err := client.NewSession()
		if err != nil {
			fmt.Printf("  ❌ SSH session failed: %v\n", err)
			time.Sleep(5 * time.Second)
			continue
		}
		
		output, err := session.CombinedOutput(fmt.Sprintf("rpk cluster info --brokers %s:9092", config.Nodes[0].PrivateIP))
		session.Close()
		
		if err != nil {
			fmt.Printf("  ⏳ Cluster not ready yet: %v\n", err)
			time.Sleep(5 * time.Second)
			continue
		}
		
		outputStr := string(output)
		fmt.Printf("  📊 Cluster info:\n%s\n", outputStr)
		
		// Parse cluster info to check broker count
		// Count broker lines in the BROKERS section
		lines := strings.Split(outputStr, "\n")
		brokerCount := 0
		inBrokersSection := false
		
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if strings.Contains(line, "BROKERS") {
				inBrokersSection = true
				continue
			}
			if inBrokersSection && strings.Contains(line, "=======") {
				continue // Skip separator line
			}
			if inBrokersSection && line != "" && !strings.Contains(line, "ID") && !strings.Contains(line, "HOST") {
				// This is a broker line if it has the format: ID HOST PORT
				parts := strings.Fields(line)
				if len(parts) >= 3 {
					brokerCount++
				}
			}
			// Stop counting if we hit an empty line after brokers section
			if inBrokersSection && line == "" {
				break
			}
		}
		
		if brokerCount == expectedBrokers {
			fmt.Printf("  ✅ All %d brokers are healthy!\n", expectedBrokers)
			
			// Additional health checks
			if err := performAdditionalHealthChecks(client, config); err != nil {
				fmt.Printf("  ⚠️  Additional health check failed: %v\n", err)
				time.Sleep(5 * time.Second)
				continue
			}
			
			return nil
		}
		
		fmt.Printf("  ⏳ Found %d brokers, expecting %d. Waiting for full cluster...\n", brokerCount, expectedBrokers)
		time.Sleep(5 * time.Second)
	}
	
	return fmt.Errorf("cluster failed to become healthy after %d attempts", maxAttempts)
}

func performAdditionalHealthChecks(client *ssh.Client, config *ClusterConfig) error {
	healthChecks := []struct {
		name string
		cmd  string
	}{
		{"Broker list", "rpk redpanda admin brokers list"},
		{"Topic operations", fmt.Sprintf("rpk topic list --brokers %s:9092", config.Nodes[0].PrivateIP)},
		{"Service status", "sudo systemctl is-active redpanda"},
	}

	for _, check := range healthChecks {
		session, err := client.NewSession()
		if err != nil {
			return fmt.Errorf("%s check - session failed: %v", check.name, err)
		}
		
		output, err := session.CombinedOutput(check.cmd)
		session.Close()
		
		if err != nil {
			return fmt.Errorf("%s check failed: %v, output: %s", check.name, err, string(output))
		}
		
		fmt.Printf("    ✅ %s: OK\n", check.name)
	}
	
	return nil
}

func getBootstrapBrokers(nodes []NodeConfig) string {
	var brokers []string
	for _, node := range nodes {
		brokers = append(brokers, fmt.Sprintf("%s:9092", node.PrivateIP))
	}
	return strings.Join(brokers, ",")
}

func applyNetworkOptimizations(client *ssh.Client) error {
	// Network optimization script content
	optimizationScript := `#!/bin/bash
# Ultra-Low Latency Network Optimizations for RedPanda
set -e

# Create optimized sysctl configuration
sudo tee /etc/sysctl.d/99-redpanda-latency.conf > /dev/null << 'EOF'
# Ultra-Low Latency Network Optimizations for RedPanda
net.core.rmem_default = 262144
net.core.rmem_max = 134217728
net.core.wmem_default = 262144
net.core.wmem_max = 134217728
net.core.netdev_max_backlog = 5000
net.core.netdev_budget = 600
net.ipv4.tcp_rmem = 4096 87380 134217728
net.ipv4.tcp_wmem = 4096 65536 134217728
net.ipv4.tcp_congestion_control = bbr
net.core.default_qdisc = fq
net.ipv4.tcp_low_latency = 1
net.ipv4.tcp_no_delay_ack = 1
net.core.busy_read = 50
net.core.busy_poll = 50
vm.swappiness = 1
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
EOF

# Apply settings
sudo sysctl -p /etc/sysctl.d/99-redpanda-latency.conf >/dev/null 2>&1

# Set CPU governor to performance
echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor >/dev/null 2>&1 || true

echo "Network optimizations applied"
`

	// Upload and execute the optimization script
	if err := uploadFile(client, []byte(optimizationScript), "/tmp/optimize-network.sh"); err != nil {
		return fmt.Errorf("failed to upload optimization script: %w", err)
	}

	if err := executeSSHCommand(client, "chmod +x /tmp/optimize-network.sh"); err != nil {
		return fmt.Errorf("failed to make script executable: %w", err)
	}

	if err := executeSSHCommand(client, "/tmp/optimize-network.sh"); err != nil {
		return fmt.Errorf("failed to execute optimization script: %w", err)
	}

	// Clean up the script
	executeSSHCommand(client, "rm -f /tmp/optimize-network.sh")

	return nil
} 