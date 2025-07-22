package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os/exec"
	"strings"
)

// CDKStackOutputs represents the structure of CDK stack outputs
type CDKStackOutputs struct {
	BootstrapBrokers    string   `json:"RedPandaBootstrapBrokers"`
	ClusterPrivateIPs   string   `json:"RedPandaClusterIPs"`  
	ClusterPublicIPs    string   `json:"RedPandaClusterPublicIPs"`
	LoadTestInstanceIP  string   `json:"LoadTestInstanceIP"`
}

// NodeConfig represents a RedPanda node configuration
type NodeConfig struct {
	ID        int
	PublicIP  string
	PrivateIP string
}

// ClusterConfig represents the complete cluster configuration
type ClusterConfig struct {
	Nodes              []NodeConfig
	BootstrapServers   string
	LoadTestIP         string
	Region             string
	StackName          string
}

// ReadCDKStackOutputs reads configuration from deployed CDK stack
func ReadCDKStackOutputs(region, stackName string) (*ClusterConfig, error) {
	log.Printf("📋 Reading CDK stack outputs from %s in %s...", stackName, region)
	
	// Run AWS CLI to get stack outputs
	cmd := exec.Command("aws", "cloudformation", "describe-stacks", 
		"--region", region,
		"--stack-name", stackName,
		"--query", "Stacks[0].Outputs",
		"--output", "json")
	
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to get CDK stack outputs: %v", err)
	}
	
	// Parse the JSON output
	var rawOutputs []map[string]interface{}
	if err := json.Unmarshal(output, &rawOutputs); err != nil {
		return nil, fmt.Errorf("failed to parse stack outputs: %v", err)
	}
	
	// Convert to our expected format
	outputs := make(map[string]string)
	for _, item := range rawOutputs {
		if key, ok := item["OutputKey"].(string); ok {
			if value, ok := item["OutputValue"].(string); ok {
				outputs[key] = value
			}
		}
	}
	
	// Extract required values
	config := &ClusterConfig{
		Region:    region,
		StackName: stackName,
	}
	
	// Get bootstrap servers
	if bootstrapServers, exists := outputs["RedPandaBootstrapBrokers"]; exists {
		config.BootstrapServers = bootstrapServers
		log.Printf("✅ Bootstrap Servers: %s", bootstrapServers)
	} else {
		return nil, fmt.Errorf("RedPandaBootstrapBrokers output not found")
	}
	
	// Get load test instance IP
	if loadTestIP, exists := outputs["LoadTestInstanceIP"]; exists {
		config.LoadTestIP = loadTestIP
		log.Printf("✅ Load Test Instance: %s", loadTestIP)
	} else {
		return nil, fmt.Errorf("LoadTestInstanceIP output not found")
	}
	
	// Get public IPs and private IPs
	publicIPsStr, hasPublic := outputs["RedPandaClusterPublicIPs"]
	privateIPsStr, hasPrivate := outputs["RedPandaClusterIPs"]
	
	if !hasPublic || !hasPrivate {
		return nil, fmt.Errorf("cluster IP outputs not found")
	}
	
	publicIPs := strings.Split(publicIPsStr, ",")
	privateIPs := strings.Split(privateIPsStr, ",")
	
	if len(publicIPs) != len(privateIPs) {
		return nil, fmt.Errorf("mismatch between public and private IP counts")
	}
	
	// Build node configurations
	for i := 0; i < len(publicIPs); i++ {
		config.Nodes = append(config.Nodes, NodeConfig{
			ID:        i,
			PublicIP:  strings.TrimSpace(publicIPs[i]),
			PrivateIP: strings.TrimSpace(privateIPs[i]),
		})
	}
	
	log.Printf("✅ Found %d RedPanda nodes", len(config.Nodes))
	for _, node := range config.Nodes {
		log.Printf("   Node %d: %s (private: %s)", node.ID, node.PublicIP, node.PrivateIP)
	}
	
	return config, nil
}

// GetClusterConfig reads from CDK stack - no fallbacks
func GetClusterConfig(region, stackName string) (*ClusterConfig, error) {
	// Try to read from CDK stack
	config, err := ReadCDKStackOutputs(region, stackName)
	if err != nil {
		return nil, fmt.Errorf("failed to read CDK stack outputs: %v\n"+
			"Please ensure:\n"+
			"  - AWS credentials are configured (aws configure or IAM role)\n"+
			"  - CDK stack '%s' is deployed\n"+
			"  - AWS CLI is installed and accessible", err, stackName)
	}
	
	return config, nil
}

// Example usage function
func main() {
	fmt.Println("🔍 CDK Configuration Reader")
	fmt.Println("===========================")
	
	config, err := GetClusterConfig("us-east-1", "RedPandaClusterStack")
	if err != nil {
		log.Fatalf("❌ Failed to read cluster configuration: %v", err)
	}
	
	fmt.Printf("\n📋 Cluster Configuration:\n")
	fmt.Printf("   Bootstrap Servers: %s\n", config.BootstrapServers)
	fmt.Printf("   Load Test Instance: %s\n", config.LoadTestIP)
	fmt.Printf("   Region: %s\n", config.Region)
	fmt.Printf("   Stack: %s\n", config.StackName)
	
	fmt.Printf("\n🖥️  RedPanda Nodes:\n")
	for _, node := range config.Nodes {
		fmt.Printf("   Node %d: %s (private: %s)\n", node.ID, node.PublicIP, node.PrivateIP)
	}
	
	fmt.Printf("\n💡 Usage in other Go programs:\n")
	fmt.Printf("   config, err := GetClusterConfig(\"us-east-1\", \"RedPandaClusterStack\")\n")
	fmt.Printf("   if err != nil { log.Fatal(err) }\n")
	fmt.Printf("   bootstrapServers := config.BootstrapServers\n")
	fmt.Printf("   loadTestIP := config.LoadTestIP\n")
} 