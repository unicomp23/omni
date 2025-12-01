# BigSur Hosts Search - Merced Endpoint Errors

**Query Time:** 2025-10-20 16:54 UTC
**Time Range:** Last 12 hours (04:54 - 16:54 UTC)
**Search Scope:** Production logs

---

## Executive Summary

**Result:** ❌ **NO BIGSUR HOSTS FOUND**

After extensive searching with multiple naming patterns and variations, **no BigSur hosts were found in the Sumo Logic logs** for the past 12 hours.

---

## Search Methods Used

### 1. Direct BigSur Searches
Searched for multiple naming variations:
- `bigsur`
- `big-sur`
- `big_sur`
- `"big sur"`

**Result:** 0 hosts found

### 2. macOS Version Name Searches
Searched for other macOS-style names:
- `sierra`
- `monterey`
- `catalina`

**Result:** 0 hosts found

### 3. Wildcard Host Searches
Searched for any host matching:
- `_sourceHost=*bigsur*`
- `_sourceHost=*big-sur*`

**Result:** 0 hosts found

### 4. Comprehensive Host Discovery
Retrieved all 100 hosts with Merced-related activity to find any potential BigSur hosts.

**Result:** 25 unique hosts found, categorized as:

---

## Hosts Found With Merced Activity

### Category Breakdown

| Category | Count | Hosts |
|----------|-------|-------|
| **Boca hosts** | 12 | boca-1 through boca-12 |
| **Merced hosts** | 4 | merced-i-* automation instances |
| **Other hosts** | 9 | Yosemite, Pfeiffer, Tahoe, Lambda, etc. |

### Other Hosts (Non-Boca, Non-Merced)

| Host | Log Count | Has Errors? |
|------|-----------|-------------|
| Sumo Cloud | 99,204 | N/A (aggregator) |
| yosemite-i-0c81f939c4098fa0b-us-east-1 | 2,604 | ✅ No |
| yosemite-i-06eed8ba44312531a-us-east-1 | 2,598 | ✅ No |
| pfeiffer-i-0de311a66d7745f6e-us-east-1 | 1,269 | ✅ No |
| hosts500 | 300 | ✅ No |
| tahoe-i-0925c1da634653983-us-east-1 | 2 | ✅ No |
| /final-order/palpatine | 4 | N/A |
| /aws/lambda/final-order-prd-* | 6 | N/A |

**Key Finding:** No BigSur hosts identified in any category.

---

## Hosts WITH Merced Errors (Last 12 Hours)

Based on comprehensive error search, only these hosts had Merced-related errors:

| Host Type | Host Name | Error Count |
|-----------|-----------|-------------|
| Merced | merced-i-073534942f6b1d2dc-us-east-1-automation202 | 14 |
| Boca | boca-6, boca-12, boca-8, boca-1 | 3 each |
| Boca | boca-11, boca-2, boca-7 | 2 each |
| Boca | boca-5, boca-4, boca-10, boca-3 | 1 each |

**Total:** 36 errors across 12 hosts (all Boca or Merced)

---

## Error Verification for Other Hosts

Explicitly checked Yosemite, Pfeiffer, and Tahoe hosts for Merced endpoint errors:

**Query:** `(yosemite OR pfeiffer OR tahoe) prod merced (error OR warning OR timeout OR failed OR unavailable)`

**Result:** ✅ **0 errors found**

These hosts have Merced activity but **no errors** in the last 12 hours.

---

## Conclusions

1. **No BigSur Hosts Exist in Logs**
   - Extensive searches found no hosts with "BigSur" or variations in their names
   - BigSur either doesn't exist in this environment or uses a completely different naming convention

2. **Only Boca Hosts Have Merced Errors**
   - All 36 Merced-related errors came from Boca hosts (or Merced itself)
   - Connection issues: "Bad file descriptor" errors
   - Public key acquisition failures

3. **Other Production Hosts Are Healthy**
   - Yosemite hosts (5,202 logs) - No errors
   - Pfeiffer hosts (1,269 logs) - No errors
   - Tahoe hosts (2 logs) - No errors

4. **Isolated Issue**
   - The Merced connectivity problems are **specific to Boca hosts**
   - Not a widespread AWS or Merced service outage
   - Network path issue between Boca and Merced

---

## Possible Explanations

### Why No BigSur Hosts?

1. **BigSur doesn't exist in this environment**
   - This might not be a service name used in production

2. **BigSur uses different naming**
   - Could be named something else entirely
   - May not be logged to Sumo Logic

3. **BigSur doesn't interact with Merced**
   - If BigSur exists, it may not use Merced authentication services

4. **BigSur is a different type of resource**
   - Could be a database, cache, or other non-host resource
   - May not generate traditional logs

---

## Recommendations

1. **Clarify BigSur's existence**
   - Verify with team if "BigSur" is actually used in production
   - Get correct naming convention if it exists

2. **Focus on Boca→Merced issues**
   - Since BigSur has no errors (or doesn't exist), focus remains on Boca
   - The 36 Boca→Merced connection errors are the primary concern

3. **No action needed for other hosts**
   - Yosemite, Pfeiffer, and Tahoe are operating normally with Merced
   - No AWS outage affecting these services

---

## Files Generated

- `bigsur_merced_errors.json` - Empty result set
- `query_bigsur_merced_errors.sh` - Original BigSur search script
- `query_bigsur_variants.sh` - Multiple naming pattern searches
- `bigsur_search_summary.md` - This report
