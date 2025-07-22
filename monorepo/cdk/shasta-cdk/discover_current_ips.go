package main

import (
	"fmt"
	"log"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// Note: IP addresses are now read from CDK stack outputs instead of hardcoded values

type DiscoveredNode struct {
	PublicIP      string
	PrivateIP     string
	SSHOpen       bool
	RedPandaOpen  bool
	NodeID        int
	IsLoadTest    bool
}

func main() {
	fmt.Println("🔍 IP Address Discovery Tool")
	fmt.Println("============================")
	
	// Get configuration from CDK stack - no fallbacks
	config, err := GetStackConfigWithoutFallback("us-east-1", "RedPandaClusterStack")
	if err != nil {
		log.Fatalf("❌ Failed to read CDK stack configuration: %v\n"+
			"Please ensure:\n"+
			"  - AWS credentials are configured (aws configure or IAM role)\n"+
			"  - CDK stack 'RedPandaClusterStack' is deployed\n"+
			"  - AWS CLI is installed and accessible", err)
	}
	
	fmt.Printf("📡 Using CDK stack configuration - found %d nodes\n", len(config.ClusterPublicIPs))
	fmt.Println("Checking current IP addresses to see which are active...")
	
	var activeNodes []DiscoveredNode
	
	// Check each RedPanda node from CDK outputs
	for i, publicIP := range config.ClusterPublicIPs {
		fmt.Printf("\n🔍 Testing Node %d: %s...", i, publicIP)
		
		node := DiscoveredNode{
			PublicIP:  publicIP,
			PrivateIP: config.ClusterPrivateIPs[i],
			NodeID:    i,
		}
		
		// Check if SSH port is open
		if checkPort(publicIP, 22, 5*time.Second) {
			node.SSHOpen = true
			fmt.Printf(" SSH:✅")
			
			// Check if RedPanda port is accessible (via SSH tunnel or directly)
			if checkRedPandaViaSSH(publicIP) {
				node.RedPandaOpen = true
				fmt.Printf(" RedPanda:✅")
			} else {
				fmt.Printf(" RedPanda:❌")
			}
		} else {
			fmt.Printf(" SSH:❌")
		}
		
		if node.SSHOpen {
			activeNodes = append(activeNodes, node)
		}
	}
	
	// Check load test instance
	fmt.Printf("\n🔍 Testing Load Test Instance: %s...", config.LoadTestIP)
	loadTestNode := DiscoveredNode{
		PublicIP:   config.LoadTestIP,
		IsLoadTest: true,
	}
	
	if checkPort(config.LoadTestIP, 22, 5*time.Second) {
		loadTestNode.SSHOpen = true
		fmt.Printf(" SSH:✅ (LoadTest)")
		activeNodes = append(activeNodes, loadTestNode)
	} else {
		fmt.Printf(" SSH:❌")
	}
	
	// Print summary
	fmt.Println("\n" + strings.Repeat("=", 50))
	fmt.Println("           DISCOVERY RESULTS")
	fmt.Println(strings.Repeat("=", 50))
	
	redpandaNodes := []DiscoveredNode{}
	var foundLoadTestNode *DiscoveredNode
	
	for _, node := range activeNodes {
		if node.IsLoadTest {
			foundLoadTestNode = &node
			fmt.Printf("🧪 Load Test Instance: %s (SSH: %v)\n", node.PublicIP, node.SSHOpen)
		} else {
			redpandaNodes = append(redpandaNodes, node)
			status := "❌"
			if node.RedPandaOpen {
				status = "✅"
			}
			fmt.Printf("📦 Node %d: %s (private: %s) RedPanda: %s\n", 
				node.NodeID, node.PublicIP, node.PrivateIP, status)
		}
	}
	
	fmt.Println(strings.Repeat("=", 50))
	
	// Generate updated configuration
	if len(redpandaNodes) > 0 {
		fmt.Printf("\n💡 SUGGESTED CONFIGURATION UPDATE:\n")
		fmt.Printf("Replace hard-coded IPs in your Go files with:\n\n")
		
		fmt.Printf("// RedPanda Nodes\n")
		for _, node := range redpandaNodes {
			fmt.Printf("{ID: %d, PublicIP: \"%s\", PrivateIP: \"%s\"},\n", 
				node.NodeID, node.PublicIP, node.PrivateIP)
		}
		
		if foundLoadTestNode != nil {
			fmt.Printf("\n// Load Test Instance\n")
			fmt.Printf("LoadTestIP: \"%s\"\n", foundLoadTestNode.PublicIP)
		}
		
		// Generate bootstrap servers
		var bootstrapServers []string
		for _, node := range redpandaNodes {
			if node.RedPandaOpen {
				bootstrapServers = append(bootstrapServers, node.PrivateIP+":9092")
			}
		}
		if len(bootstrapServers) > 0 {
			fmt.Printf("\n// Bootstrap Servers\n")
			fmt.Printf("BootstrapServers: \"%s\"\n", strings.Join(bootstrapServers, ","))
		}
	} else {
		fmt.Printf("\n⚠️  No active RedPanda nodes found!\n")
		fmt.Printf("This likely means:\n")
		fmt.Printf("1. Instances are stopped/terminated\n") 
		fmt.Printf("2. IP addresses have changed\n")
		fmt.Printf("3. Security groups are blocking access\n")
		fmt.Printf("\nConsider redeploying the CDK stack.\n")
	}
}

// checkPort tests if a TCP port is open on the given host
func checkPort(host string, port int, timeout time.Duration) bool {
	conn, err := net.DialTimeout("tcp", host+":"+strconv.Itoa(port), timeout)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

// checkRedPandaViaSSH tries to check if RedPanda is running via SSH
func checkRedPandaViaSSH(host string) bool {
	// Try to SSH and check for RedPanda container
	key, err := os.ReadFile("/data/.ssh/john.davis.pem")
	if err != nil {
		return false
	}

	signer, err := ssh.ParsePrivateKey(key)
	if err != nil {
		return false
	}

	config := &ssh.ClientConfig{
		User: "ec2-user",
		Auth: []ssh.AuthMethod{ssh.PublicKeys(signer)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout: 5 * time.Second,
	}

	client, err := ssh.Dial("tcp", host+":22", config)
	if err != nil {
		return false
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return false
	}
	defer session.Close()

	// Check if any RedPanda container is running
	output, err := session.CombinedOutput("sudo docker ps --filter name=redpanda --format '{{.Names}}' | head -1")
	if err != nil {
		return false
	}

	return strings.Contains(string(output), "redpanda")
} 