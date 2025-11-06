# Merced Error Histogram - Last 12 Hours

**Query Time:** 2025-10-20 16:36 UTC
**Time Range:** 2025-10-20 04:36 - 16:36 UTC (12 hours)
**Total Error Events:** 42 unique errors

---

## Error Categories Summary

| Category | Count | % of Total |
|----------|-------|-----------|
| **Boca→Merced Connection Errors** | 25 | 59.5% |
| Security Scan/PHP Probes | 9 | 21.4% |
| Config/Secrets Access Attempts | 4 | 9.5% |
| Public Key Acquisition Failures | 3 | 7.1% |
| Other Middleware Errors | 1 | 2.4% |

---

## 🚨 Priority Issues

### 1. Boca→Merced Connection Failures (25 events - CRITICAL)

**Error Pattern:**
```
[warning] [http::Client] Request send error: Bad file descriptor
Target: merced.prod.cantina.com:443/public-keys/*
```

**Affected Hosts:**
- boca-8: 4 errors
- boca-12: 3 errors
- boca-2: 3 errors
- boca-6: 3 errors
- boca-1: 3 errors
- boca-7: 3 errors
- boca-11: 2 errors
- boca-3, boca-5: 2 errors each
- boca-4, boca-9, boca-10: 1 error each

**Impact:** Multiple Boca hosts unable to retrieve public keys from Merced service for token validation. This indicates **network connectivity issues or Merced endpoint instability**.

**Distribution over Time:**
- 04:00 hour: 8 occurrences
- 06:00 hour: 8 occurrences
- 11:00 hour: 1 occurrence
- 16:00 hour: 8 occurrences

**Pattern:** Recurring connectivity issues throughout the 12-hour period, suggesting **intermittent network problems** rather than a single outage event.

---

### 2. Public Key Acquisition Failures (3 events)

**Error Pattern:**
```
[error] [AuthTokenValidator] Public-key acquisition failed
Target: merced.prod.cantina.com:443/public-keys/*
```

**Affected Hosts:**
- boca-1, boca-6, boca-8 (06:54-06:57 UTC)

**Impact:** Authentication/validation failures during a specific 3-minute window. May be related to the connection errors above.

---

## 📊 Hourly Distribution

```
04:00 UTC: ████████ (8 errors)   - Morning connection issues
05:00 UTC: ██ (2 errors)
06:00 UTC: ████████ (8 errors)   - Second wave of connection issues
11:00 UTC: █ (1 error)
14:00 UTC: ███████████████ (15 errors) - PEAK (mostly security scans)
16:00 UTC: ████████ (8 errors)   - Recent connection issues
```

---

## 🔍 Non-Critical Issues

### Security Scanning Attempts (9 events)

**Time:** ~14:59 UTC
**Target:** merced-i-073534942f6b1d2dc-us-east-1-automation202
**Type:** External probing for PHP files, phpinfo endpoints

**Examples:**
- `/prod/i.php`
- `/prod/phpinfo.php`
- `/prod/server/info.php`
- Various other PHP file probes

**Assessment:** Standard external security scanning. Not related to AWS outage. Service correctly rejected these requests.

---

### Config/Secrets Access Attempts (4 events)

**Time:** ~14:59 UTC
**Target:** merced-i-073534942f6b1d2dc-us-east-1-automation202
**Type:** Attempts to access configuration files

**Examples:**
- `/env.prod.js`
- `/.env.prod.local`
- `/config/secrets/prod/*`

**Assessment:** External probing attempts. Not AWS outage related.

---

## 🎯 Key Findings

### Evidence of AWS/Network Issues:

✅ **Yes** - Multiple indicators:

1. **Widespread Boca→Merced connectivity problems**
   - 25 connection failures across 13 different Boca hosts
   - Recurring pattern: 04:00, 06:00, 16:00 UTC (3 waves)
   - Error: "Bad file descriptor" suggests network socket/connection issues

2. **Public key endpoint failures**
   - 3 authentication failures during 06:54-06:57 UTC window
   - All targeting the same Merced endpoint

3. **Multiple independent hosts affected simultaneously**
   - Not a single-host issue
   - Affects different Boca instances across the fleet

### Root Cause Assessment:

**Most Likely:** Network connectivity issues between Boca and Merced services, possibly:
- AWS network degradation
- Load balancer issues
- DNS resolution problems
- Security group/network ACL changes

**Less Likely:** Full AWS outage (ELB logs show continued operation)

---

## 📈 Recommendations

1. **Immediate:**
   - Investigate network path between Boca hosts and merced.prod.cantina.com
   - Check AWS VPC flow logs for connection resets
   - Verify Merced ALB/ELB health and configuration
   - Review security group changes around 04:00, 06:00, 16:00 UTC

2. **Monitoring:**
   - Set up alerts for "Bad file descriptor" errors from Boca→Merced
   - Monitor public-key endpoint availability
   - Track connection success rate between services

3. **Long-term:**
   - Implement retry logic with exponential backoff for public key fetches
   - Consider caching public keys with TTL
   - Add circuit breaker pattern for Boca→Merced communication

---

## Files Generated

- `merced_histogram_records.json` - Raw aggregated data
- `query_merced_histogram.sh` - Reproducible query script
