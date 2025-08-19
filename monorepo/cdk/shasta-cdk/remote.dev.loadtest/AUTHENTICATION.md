# Authentication Configuration

## Environment Variables

The load test now supports environment variables for all authentication credentials. **No more hardcoded passwords!**

### Required Variables

| Variable | Description | Default (if not set) |
|----------|-------------|---------------------|
| `REDPANDA_BROKERS` | Comma-separated broker list | PrivateLink endpoint |
| `REDPANDA_USER` | SASL username (producer & consumer) | `superuser` |
| `REDPANDA_PASS` | SASL password (producer & consumer) | `secretpassword` |

### Setup Methods

#### Method 1: Use Environment File (Recommended)
```bash
# Use the existing configured file
source redpanda.privatelink.env
./run_with_privatelink.sh
```

#### Method 2: Set Variables Manually
```bash
export REDPANDA_BROKERS="your-broker:30292"
export REDPANDA_USER="your-username"
export REDPANDA_PASS="your-password"
./run_loadtest_only.sh
```

#### Method 3: Inline Variables
```bash
REDPANDA_USER=myuser REDPANDA_PASS=mypass go run main.go
```

### Security Notes

- **Never commit credentials to git**
- The `redpanda.privatelink.env` file contains real credentials
- Use different credentials for producers vs consumers if possible
- Environment variables override any defaults

### Files Updated

- ✅ **`main.go`** - Now uses environment variables for all authentication
- ✅ **`redpanda.privatelink.env`** - Contains current working credentials  
- ✅ **`redpanda.env.template`** - Template for new setups
- ✅ **`run_with_privatelink.sh`** - Enhanced script with credential status

### Migration from Hardcoded

**Before** (hardcoded):
```go
User: "superuser",
Pass: "secretpassword",
```

**After** (environment-based):
```go  
user, pass := getCredentials()  // Gets REDPANDA_USER, REDPANDA_PASS
User: user,
Pass: pass,
```

**Key Simplification**: Both producer and consumer now use the **same credentials** from `REDPANDA_USER` and `REDPANDA_PASS`.

All existing functionality remains the same - just now properly configurable!
