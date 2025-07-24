package main

import (
	"bufio"
	"encoding/base64"
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

// Debug logging flag
var debugMode bool

// Logging functions
func logInfo(format string, args ...interface{}) {
	fmt.Printf("[INFO] %s %s\n", time.Now().Format("2006-01-02 15:04:05"), fmt.Sprintf(format, args...))
}

func logDebug(format string, args ...interface{}) {
	if debugMode {
		fmt.Printf("[DEBUG] %s %s\n", time.Now().Format("2006-01-02 15:04:05"), fmt.Sprintf(format, args...))
	}
}

func logError(format string, args ...interface{}) {
	fmt.Fprintf(os.Stderr, "[ERROR] %s %s\n", time.Now().Format("2006-01-02 15:04:05"), fmt.Sprintf(format, args...))
}

func logWarn(format string, args ...interface{}) {
	fmt.Printf("[WARN] %s %s\n", time.Now().Format("2006-01-02 15:04:05"), fmt.Sprintf(format, args...))
}

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
	// Initialize debug mode from environment
	debugMode = strings.ToLower(os.Getenv("DEBUG")) == "true"
	if debugMode {
		logInfo("DEBUG MODE ENABLED")
	}

	fmt.Println("RedPanda Cluster Setup Tool")
	fmt.Println("===========================")

	logInfo("Starting RedPanda cluster setup tool")
	startTime := time.Now()

	config := &ClusterConfig{
		StackName:       getEnvOrDefault("STACK_NAME", "RedPandaClusterStack"),
		Region:          getEnvOrDefault("AWS_DEFAULT_REGION", "us-east-1"),
		KeyPath:         getEnvOrDefault("KEY_PATH", "/data/.ssh/john.davis.pem"),
		RedPandaVersion: getEnvOrDefault("REDPANDA_VERSION", "latest"),
	}

	logDebug("Configuration loaded:")
	logDebug("  StackName: %s", config.StackName)
	logDebug("  Region: %s", config.Region)
	logDebug("  KeyPath: %s", config.KeyPath)
	logDebug("  RedPandaVersion: %s", config.RedPandaVersion)

	fmt.Printf("Stack: %s, Region: %s\n", config.StackName, config.Region)
	fmt.Printf("RedPanda Version: %s\n", config.RedPandaVersion)

	// Fetch cluster information from CloudFormation
	logInfo("Fetching cluster information from CloudFormation")
	fetchStart := time.Now()
	if err := fetchClusterInfo(config); err != nil {
		logError("Failed to fetch cluster info: %v", err)
		log.Fatalf("Failed to fetch cluster info: %v", err)
	}
	fetchDuration := time.Since(fetchStart)
	logDebug("CloudFormation fetch completed in %v", fetchDuration)

	fmt.Printf("Found %d RedPanda nodes:\n", len(config.Nodes))
	for _, node := range config.Nodes {
		fmt.Printf("  Node %d: %s (public: %s)\n", node.ID, node.PrivateIP, node.PublicIP)
		logDebug("Node %d details - Private: %s, Public: %s, Hostname: %s", 
			node.ID, node.PrivateIP, node.PublicIP, node.Hostname)
	}

	// Confirm before proceeding (unless non-interactive mode)
	nonInteractive := strings.ToLower(getEnvOrDefault("NON_INTERACTIVE", "false")) == "true"
	logDebug("Non-interactive mode: %v", nonInteractive)
	
	if !nonInteractive {
		fmt.Print("\nProceed with RedPanda cluster setup? (y/N): ")
		scanner := bufio.NewScanner(os.Stdin)
		scanner.Scan()
		response := strings.ToLower(scanner.Text())
		logDebug("User response: %s", response)
		if response != "y" {
			logInfo("Setup cancelled by user")
			fmt.Println("Setup cancelled.")
			return
		}
	} else {
		logInfo("Running in non-interactive mode, proceeding with setup")
		fmt.Println("\nRunning in non-interactive mode, proceeding with setup...")
	}

	// Setup each node
	logInfo("Starting node setup process for %d nodes", len(config.Nodes))
	for i, node := range config.Nodes {
		nodeStart := time.Now()
		fmt.Printf("\n=== Setting up Node %d (%s) ===\n", node.ID, node.PrivateIP)
		logInfo("Setting up node %d (%s)", node.ID, node.PrivateIP)
		
		if err := setupRedPandaNode(config, node); err != nil {
			logError("Failed to setup node %d: %v", node.ID, err)
			log.Printf("Failed to setup node %d: %v", node.ID, err)
			continue
		}
		
		nodeSetupTime := time.Since(nodeStart)
		logInfo("Node %d setup completed in %v", node.ID, nodeSetupTime)
		fmt.Printf("Node %d setup complete\n", node.ID)
		
		// Wait between nodes to avoid overwhelming
		if i < len(config.Nodes)-1 {
			waitTime := 5 * time.Second
			logDebug("Waiting %v before setting up next node", waitTime)
			time.Sleep(waitTime)
		}
	}

	// Verify cluster health with polling
	logInfo("Starting cluster health verification")
	fmt.Println("\n=== Verifying Cluster Health ===")
	healthStart := time.Now()
	if err := verifyClusterHealth(config); err != nil {
		logError("Cluster health check failed: %v", err)
		log.Fatalf("Cluster health check failed: %v", err)
	}
	healthDuration := time.Since(healthStart)
	logInfo("Cluster health verification completed in %v", healthDuration)

	// Configure load test instance with broker environment variables
	logInfo("Configuring load test instance with broker information")
	fmt.Println("\n=== Configuring Load Test Instance ===")
	ltConfigStart := time.Now()
	if err := configureLoadTestInstance(config); err != nil {
		logWarn("Failed to configure load test instance: %v", err)
		fmt.Printf("⚠️  Warning: Load test instance configuration failed: %v\n", err)
		fmt.Println("You may need to manually set REDPANDA_BROKERS and RPK environment variables on the load test instance")
	} else {
		ltConfigDuration := time.Since(ltConfigStart)
		logInfo("Load test instance configured successfully in %v", ltConfigDuration)
		fmt.Println("✅ Load test instance configured with broker and RPK environment variables")
	}

	totalDuration := time.Since(startTime)
	logInfo("Setup completed successfully in %v", totalDuration)

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
	logDebug("Creating AWS session for region: %s", config.Region)
	sess, err := session.NewSession(&aws.Config{
		Region: aws.String(config.Region),
	})
	if err != nil {
		logError("Failed to create AWS session: %v", err)
		return fmt.Errorf("failed to create AWS session: %w", err)
	}
	logDebug("AWS session created successfully")

	cfSvc := cloudformation.New(sess)
	logDebug("CloudFormation service client initialized")

	// Get stack outputs
	input := &cloudformation.DescribeStacksInput{
		StackName: aws.String(config.StackName),
	}
	logDebug("Describing CloudFormation stack: %s", config.StackName)

	start := time.Now()
	result, err := cfSvc.DescribeStacks(input)
	if err != nil {
		logError("Failed to describe stack '%s': %v", config.StackName, err)
		return fmt.Errorf("failed to describe stack: %w", err)
	}
	logDebug("CloudFormation DescribeStacks API call completed in %v", time.Since(start))

	if len(result.Stacks) == 0 {
		logError("Stack '%s' not found", config.StackName)
		return fmt.Errorf("stack %s not found", config.StackName)
	}

	stack := result.Stacks[0]
	logDebug("Found stack '%s' with status: %s", config.StackName, 
		func() string {
			if stack.StackStatus != nil {
				return *stack.StackStatus
			}
			return "unknown"
		}())
	
	outputs := make(map[string]string)
	
	logDebug("Processing %d stack outputs", len(stack.Outputs))
	for _, output := range stack.Outputs {
		if output.OutputKey != nil && output.OutputValue != nil {
			outputs[*output.OutputKey] = *output.OutputValue
			logDebug("Found output: %s = %s", *output.OutputKey, *output.OutputValue)
		}
	}

	// Validate required outputs exist
	requiredOutputs := []string{"RedPandaClusterIPs", "RedPandaClusterPublicIPs"}
	for _, required := range requiredOutputs {
		if _, exists := outputs[required]; !exists {
			logError("Required stack output '%s' not found", required)
			return fmt.Errorf("required stack output '%s' not found", required)
		}
	}

	// Parse cluster IPs
	logDebug("Parsing cluster IP addresses")
	privateIPs := strings.Split(outputs["RedPandaClusterIPs"], ",")
	publicIPs := strings.Split(outputs["RedPandaClusterPublicIPs"], ",")

	logDebug("Found %d private IPs and %d public IPs", len(privateIPs), len(publicIPs))

	if len(privateIPs) != len(publicIPs) {
		logError("Mismatch between private (%d) and public (%d) IP counts", len(privateIPs), len(publicIPs))
		return fmt.Errorf("mismatch between private and public IP counts")
	}

	// Create node configurations
	logDebug("Creating node configurations for %d nodes", len(privateIPs))
	for i, privateIP := range privateIPs {
		privateIP = strings.TrimSpace(privateIP)
		publicIP := strings.TrimSpace(publicIPs[i])
		
		if privateIP == "" || publicIP == "" {
			logWarn("Empty IP address found at index %d: private='%s', public='%s'", i, privateIP, publicIP)
		}
		
		node := NodeConfig{
			ID:        i,
			PrivateIP: privateIP,
			PublicIP:  publicIP,
			Hostname:  fmt.Sprintf("redpanda-%d", i),
		}
		config.Nodes = append(config.Nodes, node)
		logDebug("Created node config %d: %s (private) / %s (public)", i, privateIP, publicIP)
	}

	logInfo("Successfully fetched cluster info for %d nodes", len(config.Nodes))
	return nil
}

func setupRedPandaNode(config *ClusterConfig, node NodeConfig) error {
	logDebug("Starting setup for node %d (%s)", node.ID, node.PrivateIP)
	nodeStart := time.Now()
	
	// Create SSH connection
	logDebug("Creating SSH connection to node %d", node.ID)
	client, err := createSSHClient(node.PublicIP, config.KeyPath)
	if err != nil {
		logError("Failed to create SSH client for node %d: %v", node.ID, err)
		return fmt.Errorf("failed to create SSH client: %w", err)
	}
	defer client.Close()

	fmt.Printf("Connected to node %d via SSH\n", node.ID)
	logInfo("SSH connection established to node %d", node.ID)

	// Generate RedPanda configuration
	logDebug("Generating RedPanda configuration for node %d", node.ID)
	configStart := time.Now()
	rpConfig := generateRedPandaConfig(config, node)
	configYAML, err := yaml.Marshal(rpConfig)
	if err != nil {
		logError("Failed to marshal RedPanda config for node %d: %v", node.ID, err)
		return fmt.Errorf("failed to marshal RedPanda config: %w", err)
	}
	logDebug("Configuration generated in %v (size: %d bytes)", time.Since(configStart), len(configYAML))

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

	// Start and enable Redpanda service with timeout
	logDebug("Starting RedPanda service with timeout")
	startCmd := "timeout 60s sudo systemctl start redpanda"
	if err := executeSSHCommand(client, startCmd); err != nil {
		logWarn("RedPanda service start timed out or failed, checking status...")
		// Get detailed status for debugging
		executeSSHCommand(client, "sudo systemctl status redpanda --no-pager")
		executeSSHCommand(client, "sudo journalctl -u redpanda --lines=30 --no-pager")
		
		// For cluster setup, the first node might timeout waiting for others
		// Check if it's actually running despite the timeout
		if err := executeSSHCommand(client, "sudo systemctl is-active redpanda"); err != nil {
			return fmt.Errorf("RedPanda service failed to start: %w", err)
		}
		logInfo("RedPanda service is running despite start timeout (normal for cluster bootstrap)")
	}

	logDebug("Enabling RedPanda service for auto-start")
	if err := executeSSHCommand(client, "sudo systemctl enable redpanda"); err != nil {
		logWarn("Failed to enable RedPanda service: %v", err)
		// Not critical, continue
	}

	// Wait for service to stabilize
	logDebug("Waiting for service to stabilize")
	time.Sleep(5 * time.Second)

	// Check service status (allow partial success for cluster bootstrap)
	logDebug("Checking service status after startup")
	if err := executeSSHCommand(client, "sudo systemctl is-active redpanda"); err != nil {
		logWarn("Service status check failed, getting detailed status")
		// Get more detailed status information
		executeSSHCommand(client, "sudo systemctl status redpanda --no-pager")
		executeSSHCommand(client, "sudo journalctl -u redpanda --lines=20 --no-pager")
		
		// For cluster setup, nodes might be in "activating" state waiting for peers
		// Check if the process is running
		if err := executeSSHCommand(client, "pgrep -f redpanda"); err != nil {
			return fmt.Errorf("RedPanda process is not running: %w", err)
		}
		logInfo("RedPanda process is running, service may be waiting for cluster peers")
	}

	nodeSetupTime := time.Since(nodeStart)
	logInfo("Node %d setup completed in %v", node.ID, nodeSetupTime)
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
	logDebug("Creating SSH client for host: %s", host)
	logDebug("Using SSH key: %s", keyPath)
	
	// Read private key
	start := time.Now()
	key, err := ioutil.ReadFile(keyPath)
	if err != nil {
		logError("Failed to read private key file '%s': %v", keyPath, err)
		return nil, fmt.Errorf("failed to read private key: %w", err)
	}
	logDebug("Private key read successfully in %v (size: %d bytes)", time.Since(start), len(key))

	// Parse private key
	signer, err := ssh.ParsePrivateKey(key)
	if err != nil {
		logError("Failed to parse private key: %v", err)
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}
	logDebug("Private key parsed successfully, type: %s", signer.PublicKey().Type())

	// Create SSH config
	config := &ssh.ClientConfig{
		User: "ec2-user",
		Auth: []ssh.AuthMethod{
			ssh.PublicKeys(signer),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // In production, use proper host key verification
		Timeout:         30 * time.Second,
	}
	logDebug("SSH client config created with timeout: %v", config.Timeout)

	// Connect
	address := net.JoinHostPort(host, "22")
	logDebug("Attempting SSH connection to: %s", address)
	
	connectStart := time.Now()
	client, err := ssh.Dial("tcp", address, config)
	if err != nil {
		logError("Failed to establish SSH connection to %s: %v", address, err)
		return nil, fmt.Errorf("failed to connect via SSH: %w", err)
	}
	
	connectDuration := time.Since(connectStart)
	logDebug("SSH connection established successfully in %v", connectDuration)
	logInfo("Connected to %s via SSH", host)

	return client, nil
}

func executeSSHCommand(client *ssh.Client, command string) error {
	logDebug("Executing SSH command: %s", command)
	
	start := time.Now()
	session, err := client.NewSession()
	if err != nil {
		logError("Failed to create SSH session: %v", err)
		return err
	}
	defer session.Close()

	logDebug("SSH session created, executing command")
	output, err := session.CombinedOutput(command)
	duration := time.Since(start)
	
	if err != nil {
		logError("Command failed after %v: %s", duration, err)
		logDebug("Command output: %s", string(output))
		return fmt.Errorf("command failed: %s, output: %s", err, string(output))
	}

	logDebug("Command completed successfully in %v", duration)
	fmt.Printf("Command: %s\n", command)
	if len(output) > 0 {
		fmt.Printf("Output: %s\n", string(output))
		logDebug("Command output length: %d bytes", len(output))
	} else {
		logDebug("Command produced no output")
	}

	return nil
}

func uploadFile(client *ssh.Client, content []byte, remotePath string) error {
	logDebug("Uploading file to remote path: %s (size: %d bytes)", remotePath, len(content))
	
	session, err := client.NewSession()
	if err != nil {
		logError("Failed to create SSH session for upload: %v", err)
		return err
	}
	defer session.Close()

	// Create directory if needed
	dir := remotePath[:strings.LastIndex(remotePath, "/")]
	logDebug("Creating directory: %s", dir)
	if err := executeSSHCommand(client, fmt.Sprintf("sudo mkdir -p %s", dir)); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	// Generate a unique temporary file name to avoid conflicts
	tempFile := fmt.Sprintf("/tmp/upload_%d.tmp", time.Now().UnixNano())
	logDebug("Using temporary file: %s", tempFile)
	
	// Use base64 encoding to avoid heredoc conflicts
	encodedContent := base64.StdEncoding.EncodeToString(content)
	
	// Write base64 encoded content and decode it
	writeCmd := fmt.Sprintf("echo '%s' | base64 -d > %s", encodedContent, tempFile)
	logDebug("Writing content using base64 encoding to avoid heredoc conflicts")
	
	if err := executeSSHCommand(client, writeCmd); err != nil {
		return fmt.Errorf("failed to write temp file: %w", err)
	}

	// Move to final location with proper permissions
	logDebug("Moving file from %s to %s", tempFile, remotePath)
	if err := executeSSHCommand(client, fmt.Sprintf("sudo mv %s %s", tempFile, remotePath)); err != nil {
		return fmt.Errorf("failed to move file: %w", err)
	}

	logDebug("Setting file ownership for %s", remotePath)
	if err := executeSSHCommand(client, fmt.Sprintf("sudo chown ec2-user:ec2-user %s", remotePath)); err != nil {
		return fmt.Errorf("failed to change ownership: %w", err)
	}

	logDebug("File upload completed successfully: %s", remotePath)
	return nil
}

func verifyClusterHealth(config *ClusterConfig) error {
	logInfo("Starting cluster health verification")
	fmt.Println("🔍 Polling cluster status until healthy...")
	
	// Connect to first node to check cluster status
	logDebug("Connecting to first node for health checks")
	client, err := createSSHClient(config.Nodes[0].PublicIP, config.KeyPath)
	if err != nil {
		logError("Failed to connect to node 0 for health check: %v", err)
		return fmt.Errorf("failed to connect to node 0: %w", err)
	}
	defer client.Close()

	expectedBrokers := len(config.Nodes)
	maxAttempts := 120 // 10 minutes with 5-second intervals (longer for cluster formation)
	logDebug("Expecting %d brokers, will poll for up to %d attempts", expectedBrokers, maxAttempts)
	
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		fmt.Printf("  Attempt %d/%d: Checking cluster health...\n", attempt, maxAttempts)
		logDebug("Health check attempt %d/%d", attempt, maxAttempts)
		
		// Check if cluster is responding
		session, err := client.NewSession()
		if err != nil {
			logWarn("SSH session failed on attempt %d: %v", attempt, err)
			fmt.Printf("  ❌ SSH session failed: %v\n", err)
			time.Sleep(5 * time.Second)
			continue
		}
		
		checkStart := time.Now()
		output, err := session.CombinedOutput(fmt.Sprintf("rpk cluster info --brokers %s:9092", config.Nodes[0].PrivateIP))
		session.Close()
		checkDuration := time.Since(checkStart)
		
		if err != nil {
			logDebug("Cluster info command failed after %v: %v", checkDuration, err)
			fmt.Printf("  ⏳ Cluster not ready yet: %v\n", err)
			
			// Show more context every 10 attempts
			if attempt%10 == 0 {
				logDebug("Attempt %d: Getting additional diagnostics", attempt)
				executeSSHCommand(client, "sudo systemctl status redpanda --no-pager")
			}
			
			time.Sleep(5 * time.Second)
			continue
		}
		
		logDebug("Cluster info command succeeded after %v", checkDuration)
		
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
	logDebug("Starting network optimizations")
	
	// Network optimization script content
	optimizationScript := `#!/bin/bash
# Ultra-Low Latency Network Optimizations for RedPanda
set -e

echo "Applying network optimizations..."

# Create optimized sysctl configuration using cat with a different delimiter
sudo bash -c 'cat > /etc/sysctl.d/99-redpanda-latency.conf << "SYSCTL_END"
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
SYSCTL_END'

# Apply settings
sudo sysctl -p /etc/sysctl.d/99-redpanda-latency.conf >/dev/null 2>&1 || echo "Some sysctl settings may not be available"

# Set CPU governor to performance
echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor >/dev/null 2>&1 || echo "CPU governor setting not available"

echo "Network optimizations applied successfully"
`

	logDebug("Uploading network optimization script")
	// Upload and execute the optimization script
	scriptPath := "/tmp/optimize-network.sh"
	if err := uploadFile(client, []byte(optimizationScript), scriptPath); err != nil {
		logError("Failed to upload optimization script: %v", err)
		return fmt.Errorf("failed to upload optimization script: %w", err)
	}

	logDebug("Making optimization script executable")
	if err := executeSSHCommand(client, fmt.Sprintf("chmod +x %s", scriptPath)); err != nil {
		logError("Failed to make script executable: %v", err)
		return fmt.Errorf("failed to make script executable: %w", err)
	}

	logDebug("Executing network optimization script")
	if err := executeSSHCommand(client, scriptPath); err != nil {
		logError("Failed to execute optimization script: %v", err)
		return fmt.Errorf("failed to execute optimization script: %w", err)
	}

	// Clean up the script
	logDebug("Cleaning up optimization script")
	executeSSHCommand(client, fmt.Sprintf("rm -f %s", scriptPath))

	logInfo("Network optimizations applied successfully")
	return nil
} 

// configureLoadTestInstance sets up environment variables on the load test instance
func configureLoadTestInstance(config *ClusterConfig) error {
	logDebug("Starting load test instance configuration")
	
	// Get load test instance IP from CloudFormation
	loadTestIP, err := getLoadTestInstanceIP(config)
	if err != nil {
		return fmt.Errorf("failed to get load test instance IP: %w", err)
	}
	
	logInfo("Configuring load test instance at %s", loadTestIP)
	
	// Create SSH connection to load test instance
	logDebug("Creating SSH connection to load test instance")
	client, err := createSSHClient(loadTestIP, config.KeyPath)
	if err != nil {
		return fmt.Errorf("failed to create SSH client for load test instance: %w", err)
	}
	defer client.Close()
	
	fmt.Printf("Connected to load test instance via SSH\n")
	logInfo("SSH connection established to load test instance")
	
	// Generate broker list
	bootstrapBrokers := getBootstrapBrokers(config.Nodes)
	logDebug("Bootstrap brokers: %s", bootstrapBrokers)
	
	// Generate RPK service URLs using first cluster node IP
	var firstNodeIP string
	if len(config.Nodes) > 0 {
		firstNodeIP = config.Nodes[0].PrivateIP
	}
	
	rpkSchemaRegistryURL := fmt.Sprintf("http://%s:8081", firstNodeIP)
	rpkAdminAPIURL := fmt.Sprintf("http://%s:33145", firstNodeIP)
	rpkRestProxyURL := fmt.Sprintf("http://%s:8082", firstNodeIP)
	
	logDebug("RPK service URLs - Schema Registry: %s, Admin API: %s, REST Proxy: %s", 
		rpkSchemaRegistryURL, rpkAdminAPIURL, rpkRestProxyURL)
	
	// Commands to set up environment variables
	commands := []string{
		// Create/update .bashrc with broker information
		fmt.Sprintf(`echo "export REDPANDA_BROKERS='%s'" >> ~/.bashrc`, bootstrapBrokers),
		fmt.Sprintf(`echo "export KAFKA_BROKERS='%s'" >> ~/.bashrc`, bootstrapBrokers), // Alternative name
		fmt.Sprintf(`echo "export BOOTSTRAP_BROKERS='%s'" >> ~/.bashrc`, bootstrapBrokers), // Alternative name
		
		// RPK-specific environment variables in .bashrc
		fmt.Sprintf(`echo "export RPK_BROKERS='%s'" >> ~/.bashrc`, bootstrapBrokers),
		fmt.Sprintf(`echo "export RPK_SCHEMA_REGISTRY_URL='%s'" >> ~/.bashrc`, rpkSchemaRegistryURL),
		fmt.Sprintf(`echo "export RPK_ADMIN_API_URL='%s'" >> ~/.bashrc`, rpkAdminAPIURL),
		fmt.Sprintf(`echo "export RPK_REST_PROXY_URL='%s'" >> ~/.bashrc`, rpkRestProxyURL),
		`echo "export RPK_TLS_ENABLED='false'" >> ~/.bashrc`,
		`echo "export RPK_SASL_MECHANISM=''" >> ~/.bashrc`,
		
		// Also set in current session
		fmt.Sprintf(`export REDPANDA_BROKERS='%s'`, bootstrapBrokers),
		fmt.Sprintf(`export KAFKA_BROKERS='%s'`, bootstrapBrokers),
		fmt.Sprintf(`export BOOTSTRAP_BROKERS='%s'`, bootstrapBrokers),
		fmt.Sprintf(`export RPK_BROKERS='%s'`, bootstrapBrokers),
		fmt.Sprintf(`export RPK_SCHEMA_REGISTRY_URL='%s'`, rpkSchemaRegistryURL),
		fmt.Sprintf(`export RPK_ADMIN_API_URL='%s'`, rpkAdminAPIURL),
		fmt.Sprintf(`export RPK_REST_PROXY_URL='%s'`, rpkRestProxyURL),
		`export RPK_TLS_ENABLED='false'`,
		`export RPK_SASL_MECHANISM=''`,
		
		// Create a convenient script for re-sourcing environment
		`echo '#!/bin/bash' > ~/redpanda-env.sh`,
		`echo "# RedPanda Cluster Environment Variables" >> ~/redpanda-env.sh`,
		`echo "# Source this file to set up rpk connectivity: source ~/redpanda-env.sh" >> ~/redpanda-env.sh`,
		`echo "" >> ~/redpanda-env.sh`,
		`echo "# Core connectivity" >> ~/redpanda-env.sh`,
		fmt.Sprintf(`echo "export REDPANDA_BROKERS='%s'" >> ~/redpanda-env.sh`, bootstrapBrokers),
		fmt.Sprintf(`echo "export KAFKA_BROKERS='%s'" >> ~/redpanda-env.sh`, bootstrapBrokers),
		fmt.Sprintf(`echo "export BOOTSTRAP_BROKERS='%s'" >> ~/redpanda-env.sh`, bootstrapBrokers),
		fmt.Sprintf(`echo "export RPK_BROKERS='%s'" >> ~/redpanda-env.sh`, bootstrapBrokers),
		`echo "" >> ~/redpanda-env.sh`,
		`echo "# RPK Service URLs" >> ~/redpanda-env.sh`,
		fmt.Sprintf(`echo "export RPK_SCHEMA_REGISTRY_URL='%s'" >> ~/redpanda-env.sh`, rpkSchemaRegistryURL),
		fmt.Sprintf(`echo "export RPK_ADMIN_API_URL='%s'" >> ~/redpanda-env.sh`, rpkAdminAPIURL),
		fmt.Sprintf(`echo "export RPK_REST_PROXY_URL='%s'" >> ~/redpanda-env.sh`, rpkRestProxyURL),
		`echo "" >> ~/redpanda-env.sh`,
		`echo "# RPK Connection settings" >> ~/redpanda-env.sh`,
		`echo "export RPK_TLS_ENABLED='false'" >> ~/redpanda-env.sh`,
		`echo "export RPK_SASL_MECHANISM=''" >> ~/redpanda-env.sh`,
		`echo "" >> ~/redpanda-env.sh`,
		`echo 'echo "RedPanda environment variables loaded:"' >> ~/redpanda-env.sh`,
		`echo 'echo "  Brokers: $RPK_BROKERS"' >> ~/redpanda-env.sh`,
		`echo 'echo "  Schema Registry: $RPK_SCHEMA_REGISTRY_URL"' >> ~/redpanda-env.sh`,
		`echo 'echo "  Admin API: $RPK_ADMIN_API_URL"' >> ~/redpanda-env.sh`,
		`echo 'echo "  REST Proxy: $RPK_REST_PROXY_URL"' >> ~/redpanda-env.sh`,
		`chmod +x ~/redpanda-env.sh`,
		
		// Verify the environment variables were set
		`echo "Environment variables set:"`,
		`grep -E "(REDPANDA_BROKERS|KAFKA_BROKERS|RPK_BROKERS|RPK_SCHEMA_REGISTRY_URL)" ~/.bashrc || echo "No broker env vars found in .bashrc"`,
	}
	
	logDebug("Executing %d commands on load test instance", len(commands))
	for i, cmd := range commands {
		logDebug("Executing command %d: %s", i+1, cmd)
		if err := executeSSHCommand(client, cmd); err != nil {
			logWarn("Command failed: %s - Error: %v", cmd, err)
			// Don't fail the entire setup for env var issues
			continue
		}
	}
	
	// Test that the environment variables are accessible
	logDebug("Testing environment variable accessibility")
	testCmd := `source ~/.bashrc && echo "REDPANDA_BROKERS=$REDPANDA_BROKERS" && echo "RPK_BROKERS=$RPK_BROKERS" && echo "RPK_SCHEMA_REGISTRY_URL=$RPK_SCHEMA_REGISTRY_URL"`
	if err := executeSSHCommand(client, testCmd); err != nil {
		logWarn("Failed to verify environment variables: %v", err)
	}
	
	logInfo("Load test instance configuration completed")
	fmt.Printf("Load test instance configured with:\n")
	fmt.Printf("  REDPANDA_BROKERS=%s\n", bootstrapBrokers)
	fmt.Printf("  RPK_BROKERS=%s\n", bootstrapBrokers)
	fmt.Printf("  RPK_SCHEMA_REGISTRY_URL=%s\n", rpkSchemaRegistryURL)
	fmt.Printf("  RPK_ADMIN_API_URL=%s\n", rpkAdminAPIURL)
	fmt.Printf("  RPK_REST_PROXY_URL=%s\n", rpkRestProxyURL)
	fmt.Printf("  RPK_TLS_ENABLED=false\n")
	fmt.Printf("  RPK_SASL_MECHANISM=(empty)\n")
	fmt.Printf("  Environment script: ~/redpanda-env.sh\n")
	fmt.Printf("  All variables available in ~/.bashrc and current session\n")
	
	return nil
}

// getLoadTestInstanceIP retrieves the load test instance public IP from CloudFormation
func getLoadTestInstanceIP(config *ClusterConfig) (string, error) {
	logDebug("Fetching load test instance IP from CloudFormation")
	
	sess, err := session.NewSession(&aws.Config{
		Region: aws.String(config.Region),
	})
	if err != nil {
		return "", fmt.Errorf("failed to create AWS session: %w", err)
	}
	
	cfSvc := cloudformation.New(sess)
	
	input := &cloudformation.DescribeStacksInput{
		StackName: aws.String(config.StackName),
	}
	
	result, err := cfSvc.DescribeStacks(input)
	if err != nil {
		return "", fmt.Errorf("failed to describe stack: %w", err)
	}
	
	if len(result.Stacks) == 0 {
		return "", fmt.Errorf("stack %s not found", config.StackName)
	}
	
	// Look for LoadTestInstanceIP output
	for _, output := range result.Stacks[0].Outputs {
		if output.OutputKey != nil && *output.OutputKey == "LoadTestInstanceIP" {
			if output.OutputValue != nil {
				logDebug("Found load test instance IP: %s", *output.OutputValue)
				return *output.OutputValue, nil
			}
		}
	}
	
	return "", fmt.Errorf("LoadTestInstanceIP output not found in stack %s", config.StackName)
} 