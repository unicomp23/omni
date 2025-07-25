# RedPanda Cluster Security Recommendations

## Current Setup (Direct Access)
- RedPanda nodes in public subnets with public IPs
- Direct SSH access from anywhere
- Setup connects directly to public IPs

## Recommended: Bastion Host Architecture

### Benefits
- **Reduced Attack Surface**: RedPanda nodes not directly accessible from internet
- **Centralized Access Control**: Single point for SSH access management
- **Better Auditing**: All SSH access goes through one point
- **Network Segmentation**: Production nodes in private subnets

### Implementation Changes Needed

#### 1. CDK Stack Changes (`lib/redpanda-cluster-stack.ts`)

```typescript
// Move RedPanda nodes to private subnets
const redpandaInstance = new ec2.Instance(this, `RedPandaNode${i}`, {
    vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }, // Changed from public
    instanceType: redpandaInstanceType,
    machineImage,
    securityGroup: redpandaSecurityGroup,
    keyPair: ec2.KeyPair.fromKeyPairName(this, `RedPandaKeyPair${i}`, RedPandaClusterStack.keyName),
    role,
    associatePublicIpAddress: false, // Changed from true
    // ... rest of config
});

// Update security group - remove public SSH access
// Comment out or remove this line:
// redpandaSecurityGroup.addIngressRule(
//     ec2.Peer.anyIpv4(),
//     ec2.Port.tcp(22),
//     'SSH access from anywhere'
// );

// Add SSH access only from load test instance
redpandaSecurityGroup.addIngressRule(
    ec2.Peer.securityGroupId(loadTestSecurityGroup.securityGroupId),
    ec2.Port.tcp(22),
    'SSH access from load test instance only'
);
```

#### 2. Setup Code Changes (`redpanda-setup/main.go`)

```go
// Add SSH tunneling function
func createSSHClientViaBation(targetIP, bastionIP, keyPath string) (*ssh.Client, error) {
    // Connect to bastion first
    bastionClient, err := createSSHClient(bastionIP, keyPath)
    if err != nil {
        return nil, fmt.Errorf("failed to connect to bastion: %w", err)
    }
    
    // Create tunnel through bastion to target
    conn, err := bastionClient.Dial("tcp", net.JoinHostPort(targetIP, "22"))
    if err != nil {
        bastionClient.Close()
        return nil, fmt.Errorf("failed to dial through bastion: %w", err)
    }
    
    // Create SSH connection through tunnel
    key, err := ioutil.ReadFile(keyPath)
    if err != nil {
        conn.Close()
        bastionClient.Close()
        return nil, fmt.Errorf("failed to read private key: %w", err)
    }
    
    signer, err := ssh.ParsePrivateKey(key)
    if err != nil {
        conn.Close()
        bastionClient.Close()
        return nil, fmt.Errorf("failed to parse private key: %w", err)
    }
    
    config := &ssh.ClientConfig{
        User: "ec2-user",
        Auth: []ssh.AuthMethod{ssh.PublicKeys(signer)},
        HostKeyCallback: ssh.InsecureIgnoreHostKey(),
        Timeout: 30 * time.Second,
    }
    
    sshConn, chans, reqs, err := ssh.NewClientConn(conn, targetIP, config)
    if err != nil {
        conn.Close()
        bastionClient.Close()
        return nil, fmt.Errorf("failed to create SSH connection: %w", err)
    }
    
    return ssh.NewClient(sshConn, chans, reqs), nil
}

// Update connection calls
func setupRedPandaNode(config *ClusterConfig, node NodeConfig) error {
    // Get load test instance IP for bastion
    loadTestIP, err := getLoadTestInstanceIP(config)
    if err != nil {
        return fmt.Errorf("failed to get load test IP for bastion: %w", err)
    }
    
    // Connect via bastion
    client, err := createSSHClientViaBation(node.PrivateIP, loadTestIP, config.KeyPath)
    if err != nil {
        return fmt.Errorf("failed to create SSH client via bastion: %w", err)
    }
    defer client.Close()
    
    // ... rest of setup code
}
```

#### 3. Manual Access Commands

```bash
# SSH to RedPanda nodes via bastion
ssh -i /data/.ssh/john.davis.pem -J ec2-user@<load-test-public-ip> ec2-user@<redpanda-private-ip>

# Or with ProxyJump in ~/.ssh/config
Host redpanda-*
    User ec2-user
    IdentityFile /data/.ssh/john.davis.pem
    ProxyJump load-test

Host load-test
    HostName <load-test-public-ip>
    User ec2-user
    IdentityFile /data/.ssh/john.davis.pem
```

## Current vs Recommended Architecture

### Current (Direct Access)
```
Internet → RedPanda Nodes (Public IPs)
       → Load Test Instance (Public IP)
```

### Recommended (Bastion)
```
Internet → Load Test Instance (Public IP) → RedPanda Nodes (Private IPs)
```

## Migration Strategy

1. **Test Environment**: Implement bastion approach in test environment first
2. **Gradual Migration**: Keep current approach for now, plan migration
3. **Blue/Green**: Deploy new stack with bastion, migrate gradually
4. **Emergency Access**: Keep one node with public IP as emergency access

## Decision Factors

**Keep Current Approach If:**
- Development/testing environment
- Need quick debugging access
- Simple setup preferred
- Network already secured by other means

**Use Bastion Approach If:**
- Production environment
- Security compliance required
- Need audit trails
- Multiple operators need access

## Conclusion

Current setup is fine for development, but production should use bastion host approach for better security. 