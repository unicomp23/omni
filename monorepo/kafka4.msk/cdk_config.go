package main

import (
	"log"
	"os"
)

// CDKConfig holds CDK environment variables
type CDKConfig struct {
	BootstrapBrokers     string
	MemoryDBEndpoint     string
	CodecommitRepoSSH    string
	CodecommitRepoHTTPS  string
	SNSTopicARN          string
	CodecommitStreamName string
	MulticastStreamName  string
	ECRRepoURI           string
}

// LoadCDKConfig loads CDK environment variables
func LoadCDKConfig() *CDKConfig {
	config := &CDKConfig{
		BootstrapBrokers:     os.Getenv("BOOTSTRAP_BROKERS"),
		MemoryDBEndpoint:     os.Getenv("MEMORY_DB_ENDPOINT_ADDRESS"),
		CodecommitRepoSSH:    os.Getenv("CODECOMMIT_REPO_SSH"),
		CodecommitRepoHTTPS:  os.Getenv("CODECOMMIT_REPO_HTTPS"),
		SNSTopicARN:          os.Getenv("SNS_TOPIC_ARN"),
		CodecommitStreamName: os.Getenv("CODECOMMIT_STREAM_NAME"),
		MulticastStreamName:  os.Getenv("MULTICAST_STREAM_NAME"),
		ECRRepoURI:           os.Getenv("SHASTA_CDK_ECR_REPO_URI"),
	}

	return config
}

// LogCDKConfig logs CDK configuration for debugging
func LogCDKConfig(config *CDKConfig, component string) {
	log.Printf("%s CDK Configuration:", component)
	if config.BootstrapBrokers != "" {
		log.Printf("  BOOTSTRAP_BROKERS: %s", config.BootstrapBrokers)
	}
	if config.MemoryDBEndpoint != "" {
		log.Printf("  MEMORY_DB_ENDPOINT_ADDRESS: %s", config.MemoryDBEndpoint)
	}
	if config.SNSTopicARN != "" {
		log.Printf("  SNS_TOPIC_ARN: %s", config.SNSTopicARN)
	}
	if config.CodecommitRepoHTTPS != "" {
		log.Printf("  CODECOMMIT_REPO_HTTPS: %s", config.CodecommitRepoHTTPS)
	}
	if config.CodecommitStreamName != "" {
		log.Printf("  CODECOMMIT_STREAM_NAME: %s", config.CodecommitStreamName)
	}
	if config.MulticastStreamName != "" {
		log.Printf("  MULTICAST_STREAM_NAME: %s", config.MulticastStreamName)
	}
	if config.ECRRepoURI != "" {
		log.Printf("  SHASTA_CDK_ECR_REPO_URI: %s", config.ECRRepoURI)
	}
}

// GetMemoryDBEndpoint returns the MemoryDB endpoint if configured
func (c *CDKConfig) GetMemoryDBEndpoint() string {
	if c != nil {
		return c.MemoryDBEndpoint
	}
	return ""
}

// GetSNSTopicARN returns the SNS topic ARN if configured
func (c *CDKConfig) GetSNSTopicARN() string {
	if c != nil {
		return c.SNSTopicARN
	}
	return ""
}

// GetBootstrapBrokers returns the bootstrap brokers if configured
func (c *CDKConfig) GetBootstrapBrokers() string {
	if c != nil {
		return c.BootstrapBrokers
	}
	return ""
}

// HasCDKConfig returns true if any CDK environment variables are set
func (c *CDKConfig) HasCDKConfig() bool {
	return c != nil && (c.BootstrapBrokers != "" || c.MemoryDBEndpoint != "" ||
		c.SNSTopicARN != "" || c.CodecommitRepoHTTPS != "" || c.ECRRepoURI != "")
}
