# SSH Connection Methods Comparison

## Quick Summary

**YES!** VS Code SSH can absolutely run over SSM, and it's actually the more secure and modern approach.

## Two Connection Methods Available

### 1. Traditional SSH via Bastion Host
- **Setup**: `vscode_ssh_setup.md`
- **Get IPs**: `./get_instance_ips.sh`
- **Connection**: SSH → Bastion → Producer

### 2. SSH over SSM (Recommended)
- **Setup**: `ssh_over_ssm_setup.md`
- **Get IDs**: `./get_instance_ids_ssm.sh`
- **Connection**: SSH → AWS SSM → Producer

## Quick Start Guide

### Option A: SSH over SSM (Recommended)
1. Install Session Manager plugin
2. Run `./get_instance_ids_ssm.sh`
3. Add SSH config using instance IDs
4. Connect: `ssh shasta-producer-0`

### Option B: Traditional Bastion
1. Run `./get_instance_ips.sh`
2. Add SSH config using IPs
3. Connect: `ssh shasta-producer-0`

## Key Differences

| Aspect | Bastion Host | SSH over SSM |
|--------|--------------|--------------|
| **Security** | Good | Excellent |
| **Setup Complexity** | Medium | Medium |
| **Cost** | Extra EC2 instance | No extra cost |
| **Maintenance** | Requires updates | Managed by AWS |
| **Audit Trail** | SSH logs only | Full CloudTrail |
| **Network Access** | Requires public subnet | Works anywhere |
| **Key Management** | SSH keys | AWS credentials |

## Which Should You Choose?

### Use SSH over SSM when:
- ✅ You want maximum security
- ✅ You prefer AWS-managed infrastructure
- ✅ You need comprehensive audit trails
- ✅ You want to minimize costs
- ✅ You're working with compliance requirements

### Use Bastion Host when:
- ✅ You need traditional SSH workflows
- ✅ You have existing SSH-based tooling
- ✅ Your team is more familiar with SSH
- ✅ You need to support legacy systems

## Your CDK Stack Supports Both

Your infrastructure already includes:
- **Bastion host** in public subnet
- **SSM agent** on all instances
- **VPC endpoints** for SSM
- **IAM roles** with SSM permissions

You can use either approach or both simultaneously!

## Migration Path

1. **Start with SSM** for new development
2. **Keep bastion** for existing workflows
3. **Gradually migrate** teams to SSM
4. **Decommission bastion** when ready

## VS Code Configuration

Both methods work identically in VS Code:
1. Configure SSH in `~/.ssh/config`
2. Use Remote-SSH extension
3. Connect to `shasta-producer-0`

The only difference is the underlying transport mechanism! 