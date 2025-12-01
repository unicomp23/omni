# Merced Production - AWS Outage Indicators Analysis

**Query Time:** 2025-10-20 16:25 UTC
**Time Range:** Last 6 hours (2025-10-20 10:25 - 16:25 UTC)
**Total Entries:** 100

## Executive Summary

Analysis of Sumo Logic data reveals **potential connectivity issues** between Boca hosts and the Merced production service, along with normal operational logs from the Merced ELB.

## Key Findings

### 1. Boca → Merced Connection Issues ⚠️
- **7 connection errors** detected from multiple Boca hosts
- **Error Type:** "Request send error: Bad file descriptor"
- **Affected Hosts:** boca-2, boca-3, boca-5, boca-7, boca-10, boca-11, boca-12
- **Target:** `merced.prod.cantina.com:443/public-keys/*`
- **Time:** Around 16:11-16:12 UTC (most recent)

**Impact:** Multiple Boca hosts unable to fetch public keys from Merced service, suggesting possible network connectivity issues or service disruption.

### 2. Merced Application Errors
- **14 error entries** from `merced-i-073534942f6b1d2dc-us-east-1-automation202`
- **Time:** Around 14:59 UTC
- **Types:**
  - Attempted access to non-existent config files (`.env.prod.js`, `.env.prod.local`)
  - Security scanning attempts (phpinfo.php, various .php files)
  - These appear to be external scanning/probing rather than AWS outage

### 3. Normal ELB Activity
- **79 ELB log entries** showing normal traffic patterns
- Successful token validation and public key requests
- Health check endpoints responding normally
- HTTP 200/201 responses indicating service availability

## Error Type Breakdown

| Error Category | Count | Percentage |
|---------------|-------|-----------|
| AWS-related (keyword match) | 73 | 73% |
| Other Errors | 14 | 14% |
| Connection/File Errors | 7 | 7% |
| HTTP 5xx Errors | 6 | 6% |

## Top Affected Hosts

| Host | Entry Count |
|------|-------------|
| Sumo Cloud (ELB) | 79 |
| merced-i-073534942f6b1d2dc-us-east-1-automation202 | 14 |
| boca-{2,3,5,7,10,11,12} | 7 (total) |

## Assessment

**Possible AWS Outage Indicators:**
1. ✅ **Connection failures** between Boca and Merced (7 instances)
   - Suggests network connectivity issues or Merced endpoint unavailability
   - Multiple hosts affected simultaneously around 16:11-16:12 UTC

2. ❌ **No widespread service outage** evident
   - ELB logs show continued successful requests
   - Health endpoints responding
   - Token validation working normally

**Conclusion:** The data shows **localized connectivity issues** between Boca hosts and Merced's public-key endpoint around 16:11-16:12 UTC, but not a full AWS outage. The Merced service itself appears operational based on ELB logs showing successful requests throughout the period.

## Recommendations

1. Investigate Boca → Merced network path around 16:11-16:12 UTC
2. Check if Boca hosts recovered or if issue persists
3. Review Merced public-key endpoint availability
4. Consider expanding query to 24 hours for broader pattern analysis

## Files Generated

- `merced_results.json` - Full query results (100 entries)
- `query_merced_simple.sh` - Query script for reproduction
