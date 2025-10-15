# YOS-266: Proposed Fixes for Rare/Mysterious Build Failures

## Issue Summary
The Merced build is experiencing intermittent failures where `npm test` crashes with no log output, and the automation test report XML is not created. The logs show warnings about circular dependencies and AWS SDK v2 deprecation.

## Root Cause Analysis

### 1. **Silent Process Crashes**
The mocha test runner appears to be crashing without proper error reporting. The current `run_regression_tests.sh` script lacks error handling and doesn't capture stderr output.

### 2. **Circular Dependency Warning**
```
Warning: Accessing non-existent property 'padLevels' of module exports inside circular dependency
```
This warning indicates a module loading issue that could cause initialization failures.

### 3. **AWS SDK v2 Deprecation**
The project uses `dynamodb@1.3.0` which depends on AWS SDK v2. This old version may have compatibility issues with newer Node.js versions.

### 4. **Mixed CJS/ESM Modules**
The codebase mixes CommonJS (`require`) with ES modules (`import`), which can cause timing issues during initialization.

## Proposed Solutions

### Solution 1: Enhanced Test Runner Script (IMMEDIATE FIX)
**File**: `/root/repo/dev/omni/workspace/yos-266/merced/automation-test/bin/run_regression_tests_enhanced.sh`

Key improvements:
- Comprehensive error handling with trap handlers
- Detailed logging with timestamps
- Timeout protection (10 minutes default)
- Stderr capture to separate log file
- Fallback XML generation on failure
- Memory monitoring
- Better exit code handling

**Implementation**:
```bash
# Update package.json to use the enhanced script
npm config set MERCED_REGRESSIONS:test "bin/run_regression_tests_enhanced.sh"
```

### Solution 2: Enhanced Application Entry Point (DIAGNOSTIC)
**File**: `/root/repo/dev/omni/workspace/yos-266/merced/merced/libs/run-safe.js`

Key improvements:
- Process crash handlers for uncaughtException and unhandledRejection
- Detailed initialization logging
- Memory usage monitoring
- Circular dependency tracking
- Graceful shutdown handling

**Implementation**:
```bash
# For testing, update package.json
"start": "node -v; node libs/run-safe.js"
```

### Solution 3: Jenkins Pipeline Improvements
Update the Jenkins pipeline to:
1. Add pre-test memory checks
2. Archive stderr logs
3. Add retry logic for intermittent failures

```groovy
// In automation-test.sh, add:
export NODE_OPTIONS="--trace-warnings --max-old-space-size=4096"

// Add retry wrapper in Jenkinsfile:
retry(2) {
    sh "./automation-test.sh"
}
```

### Solution 4: Dependency Updates (LONG-TERM)
1. **Migrate from AWS SDK v2 to v3**:
   - Replace `dynamodb@1.3.0` with `@aws-sdk/client-dynamodb`
   - Update related code to use v3 API

2. **Fix module loading issues**:
   - Investigate `node-media-utils` for the padLevels circular dependency
   - Consider updating to newer versions

3. **Standardize module format**:
   - Convert to consistent ES modules
   - Or use proper async initialization for mixed modules

## Testing Strategy

### 1. Local Testing
```bash
# Test the enhanced script locally
cd /root/repo/dev/omni/workspace/yos-266/merced/automation-test
chmod +x bin/run_regression_tests_enhanced.sh
npm config set MERCED_REGRESSIONS:test "bin/run_regression_tests_enhanced.sh"
npm test
```

### 2. Memory Stress Testing
```bash
# Run with reduced memory to reproduce potential OOM issues
NODE_OPTIONS="--max-old-space-size=512" npm test
```

### 3. Jenkins Testing
Deploy to a test Jenkins environment and run multiple builds to verify stability.

## Monitoring & Alerts

### Add CloudWatch Metrics
1. Monitor test execution duration
2. Track memory usage patterns
3. Alert on test timeouts

### Log Analysis
1. Aggregate stderr outputs to identify patterns
2. Track frequency of specific warnings/errors
3. Correlate failures with system metrics

## Rollback Plan
If issues persist after implementing fixes:
1. Revert to original `run_regression_tests.sh`
2. Keep enhanced logging for diagnostics
3. Run tests with increased verbosity

## Next Steps
1. **Immediate**: Deploy enhanced test runner script for better error visibility
2. **Short-term**: Add Jenkins retry logic and monitoring
3. **Long-term**: Update dependencies and fix module loading issues

## Files Modified/Created
1. `/root/repo/dev/omni/workspace/yos-266/merced/automation-test/bin/run_regression_tests_enhanced.sh` - Enhanced test runner with better error handling
2. `/root/repo/dev/omni/workspace/yos-266/merced/merced/libs/run-safe.js` - Diagnostic version of application entry point
3. This document - Comprehensive analysis and fix proposals

## Additional Recommendations

### Environment Variables for Debugging
Set these in Jenkins when issues occur:
```bash
export NODE_OPTIONS="--trace-warnings --trace-uncaught --max-old-space-size=4096"
export DEBUG="*"  # Enable all debug output
export NODE_ENV="test"
```

### Health Check Endpoint
Consider adding a health check that verifies:
- All dependencies are loaded
- Database connections are established
- Memory usage is within limits

This would help identify issues before running tests.

## Contact
For questions or issues with these fixes, refer to the YOS-266 Jira ticket.