package main

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/cloudformation"
)

// StackConfig represents the complete cluster configuration from CDK outputs
type StackConfig struct {
	BootstrapServers   string
	ClusterPrivateIPs  []string
	ClusterPublicIPs   []string
	LoadTestIP         string
	Region             string
	StackName          string
}

// NodeInfo represents individual node configuration
type NodeInfo struct {
	ID        int
	PublicIP  string
	PrivateIP string
}

// GetStackConfiguration reads configuration from AWS CloudFormation stack
func GetStackConfiguration(region, stackName string) (*StackConfig, error) {
	log.Printf("📡 Reading stack outputs from %s in %s using AWS SDK...", stackName, region)

	// Load AWS configuration
	cfg, err := config.LoadDefaultConfig(context.TODO(),
		config.WithRegion(region),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %v", err)
	}

	// Create CloudFormation client
	client := cloudformation.NewFromConfig(cfg)

	// Describe the stack to get outputs
	input := &cloudformation.DescribeStacksInput{
		StackName: aws.String(stackName),
	}

	result, err := client.DescribeStacks(context.TODO(), input)
	if err != nil {
		return nil, fmt.Errorf("failed to describe stack: %v", err)
	}

	if len(result.Stacks) == 0 {
		return nil, fmt.Errorf("stack %s not found", stackName)
	}

	stack := result.Stacks[0]
	outputs := make(map[string]string)

	// Parse stack outputs
	for _, output := range stack.Outputs {
		if output.OutputKey != nil && output.OutputValue != nil {
			outputs[*output.OutputKey] = *output.OutputValue
		}
	}

	log.Printf("✅ Found %d stack outputs", len(outputs))

	// Build configuration
	stackConfig := &StackConfig{
		Region:    region,
		StackName: stackName,
	}

	// Extract bootstrap servers
	if bootstrapServers, exists := outputs["RedPandaBootstrapBrokers"]; exists {
		stackConfig.BootstrapServers = bootstrapServers
		log.Printf("✅ Bootstrap Servers: %s", bootstrapServers)
	} else {
		return nil, fmt.Errorf("RedPandaBootstrapBrokers output not found")
	}

	// Extract load test instance IP
	if loadTestIP, exists := outputs["LoadTestInstanceIP"]; exists {
		stackConfig.LoadTestIP = loadTestIP
		log.Printf("✅ Load Test Instance: %s", loadTestIP)
	} else {
		return nil, fmt.Errorf("LoadTestInstanceIP output not found")
	}

	// Extract cluster IPs
	if privateIPsStr, exists := outputs["RedPandaClusterIPs"]; exists {
		stackConfig.ClusterPrivateIPs = strings.Split(privateIPsStr, ",")
		for i, ip := range stackConfig.ClusterPrivateIPs {
			stackConfig.ClusterPrivateIPs[i] = strings.TrimSpace(ip)
		}
		log.Printf("✅ Private IPs: %v", stackConfig.ClusterPrivateIPs)
	}

	if publicIPsStr, exists := outputs["RedPandaClusterPublicIPs"]; exists {
		stackConfig.ClusterPublicIPs = strings.Split(publicIPsStr, ",")
		for i, ip := range stackConfig.ClusterPublicIPs {
			stackConfig.ClusterPublicIPs[i] = strings.TrimSpace(ip)
		}
		log.Printf("✅ Public IPs: %v", stackConfig.ClusterPublicIPs)
	}

	return stackConfig, nil
}

// GetNodesInfo converts stack config to node info format
func (sc *StackConfig) GetNodesInfo() []NodeInfo {
	var nodes []NodeInfo
	
	minLen := len(sc.ClusterPublicIPs)
	if len(sc.ClusterPrivateIPs) < minLen {
		minLen = len(sc.ClusterPrivateIPs)
	}

	for i := 0; i < minLen; i++ {
		nodes = append(nodes, NodeInfo{
			ID:        i,
			PublicIP:  sc.ClusterPublicIPs[i],
			PrivateIP: sc.ClusterPrivateIPs[i],
		})
	}

	return nodes
}

// GetStackConfigWithoutFallback reads AWS CDK stack configuration without fallbacks
func GetStackConfigWithoutFallback(region, stackName string) (*StackConfig, error) {
	// Try AWS SDK 
	config, err := GetStackConfiguration(region, stackName)
	if err != nil {
		return nil, fmt.Errorf("failed to read CDK stack configuration: %v\n"+
			"Please ensure:\n"+
			"  - AWS credentials are configured (aws configure or IAM role)\n"+
			"  - CDK stack '%s' is deployed in region '%s'\n"+
			"  - AWS CLI is installed and accessible", err, stackName, region)
	}
	
	return config, nil
} 