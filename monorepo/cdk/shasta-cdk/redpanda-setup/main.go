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
		KeyPath:         getEnvOrDefault("KEY_PATH", os.ExpandEnv("$HOME/.ssh/john.davis.pem")),
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

	// Confirm before proceeding
	fmt.Print("\nProceed with RedPanda cluster setup? (y/N): ")
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Scan()
	if strings.ToLower(scanner.Text()) != "y" {
		fmt.Println("Setup cancelled.")
		return
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

	// Wait for cluster to stabilize
	fmt.Println("\nWaiting for cluster to stabilize...")
	time.Sleep(30 * time.Second)

	// Verify cluster health
	fmt.Println("\n=== Verifying Cluster Health ===")
	if err := verifyClusterHealth(config); err != nil {
		log.Printf("Cluster health check failed: %v", err)
	} else {
		fmt.Println("✅ RedPanda cluster is healthy!")
	}

	fmt.Println("\n=== Setup Complete ===")
	fmt.Println("RedPanda cluster is ready!")
	fmt.Printf("Bootstrap brokers: %s\n", getBootstrapBrokers(config.Nodes))
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

	// Setup commands
	commands := []string{
		// Create directories
		"sudo mkdir -p /opt/redpanda/conf /opt/redpanda/data",
		"sudo chown -R ec2-user:ec2-user /opt/redpanda/conf",
		"sudo chown -R 101:101 /opt/redpanda/data", // RedPanda runs as user 101:101 inside container
		
		// Stop any existing containers
		"sudo docker stop redpanda || true",
		"sudo docker rm redpanda || true",
		
		// Pull RedPanda image
		fmt.Sprintf("sudo docker pull redpandadata/redpanda:%s", config.RedPandaVersion),
	}

	for _, cmd := range commands {
		if err := executeSSHCommand(client, cmd); err != nil {
			return fmt.Errorf("failed to execute command '%s': %w", cmd, err)
		}
	}

	// Upload configuration file
	configPath := "/opt/redpanda/conf/redpanda.yaml"
	if err := uploadFile(client, configYAML, configPath); err != nil {
		return fmt.Errorf("failed to upload config: %w", err)
	}

	// Start RedPanda container
	dockerCmd := fmt.Sprintf(`sudo docker run -d \
		--name redpanda \
		--hostname %s \
		--network host \
		-v /opt/redpanda/data:/var/lib/redpanda/data \
		-v /opt/redpanda/conf:/etc/redpanda \
		--restart unless-stopped \
		redpandadata/redpanda:%s \
		redpanda start --config /etc/redpanda/redpanda.yaml`,
		node.Hostname, config.RedPandaVersion)

	if err := executeSSHCommand(client, dockerCmd); err != nil {
		return fmt.Errorf("failed to start RedPanda container: %w", err)
	}

	// Wait for container to start
	time.Sleep(10 * time.Second)

	// Check container status
	if err := executeSSHCommand(client, "sudo docker ps | grep redpanda"); err != nil {
		return fmt.Errorf("RedPanda container is not running: %w", err)
	}

	fmt.Printf("RedPanda container started on node %d\n", node.ID)
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
	// Connect to first node to check cluster status
	client, err := createSSHClient(config.Nodes[0].PublicIP, config.KeyPath)
	if err != nil {
		return fmt.Errorf("failed to connect to node 0: %w", err)
	}
	defer client.Close()

	// Check if RedPanda is responding
	healthChecks := []string{
		"sudo docker exec redpanda rpk cluster info",
		"sudo docker exec redpanda rpk topic list",
	}

	for _, cmd := range healthChecks {
		if err := executeSSHCommand(client, cmd); err != nil {
			return fmt.Errorf("health check failed: %s", cmd)
		}
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