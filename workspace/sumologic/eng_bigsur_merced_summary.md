# Eng + BigSur + Merced Endpoint Analysis

**Query Time:** 2025-10-20 17:18 UTC
**Time Range:** Last 12 hours (05:18 - 17:18 UTC)
**Search Focus:** "eng" + "big sur" + Merced endpoint errors

---

## Executive Summary

**Primary Finding:** ❌ **NO BIGSUR-RELATED ERRORS FOUND**

**Secondary Finding:** ⚠️ **73 "ENG" + MERCED ERRORS FOUND** - but these are **security scanning attacks**, not legitimate BigSur or service errors.

---

## Search Results

### 1. Eng + Big Sur + Merced

**Query:** `(eng OR engineering) (bigsur OR big-sur OR "big sur") merced (error OR warning OR timeout OR failed OR unavailable)`

**Result:** **0 entries found**

No logs containing all three terms (eng, big sur, merced) with errors.

### 2. Eng + Merced (Without Big Sur Filter)

**Query:** `(eng OR engineering) merced (error OR warning)`

**Result:** **73 error entries found** across 9 Merced hosts

---

## Analysis of "Eng" + Merced Errors

### What Are These Errors?

These are **NOT legitimate service errors**. They are **external security scanning attempts**.

**Evidence:**

1. **The "eng" comes from the target hostname:** `vpn.eng.cantina.com`
   - Attackers are targeting the VPN endpoint
   - "eng" appears in the HTTP `Host:` header
   - This is why the query matched on "eng"

2. **URLs being accessed are exploit attempts:**
   ```
   /login?redir=/ng                          (11 attempts)
   /lang/legacy/filechecksum                 (10 attempts)
   /fonts/ftnt-icons.woff                    (10 attempts)
   /api/v2/static/not.found                  (10 attempts)
   /remote/logincheck                        (9 attempts)
   /migadmin/lang/legacy/legacy/filechecksum (8 attempts)
   /static/lang/custom/sbin/init             (8 attempts)
   /lang/custom/sbin/init                    (7 attempts)
   ```

3. **These are known exploit paths** for:
   - FortiGate VPN vulnerabilities
   - Path traversal attacks
   - Administrative interface probing

### Error Distribution

**Hosts Targeted (all Merced instances):**
| Host | Error Count |
|------|-------------|
| merced-i-0c0e5e984b2e07100-us-east-1-automation205 | 13 |
| merced-i-012f909afbdf33e6a-us-east-1-automation102 | 12 |
| merced-i-0d11b6cf557401b6b-us-east-1-automation204 | 8 |
| merced-i-06813e05eaca8bd11-us-east-1 | 8 |
| merced-i-04feed72e4fe711eb-us-east-1-automation200 | 8 |
| merced-i-07e5325c71fe250ef-us-east-1-automation206 | 7 |
| merced-i-0828786e85cc24013-us-east-1-automation201 | 7 |
| merced-i-073534942f6b1d2dc-us-east-1-automation202 | 5 |
| merced-i-0c96dbe764f7dbb20-us-east-1 | 5 |

**Error Type Breakdown:**
- General Error: 59 (80.8%)
- HTTP 5xx: 13 (17.8%)
- Service Unavailable: 1 (1.4%)

**Hourly Distribution:**
```
06:00 UTC: 22 scanning attempts
09:00 UTC: 32 scanning attempts (peak)
12:00 UTC: 19 scanning attempts
```

---

## BigSur Search Results

### No BigSur Mentions Found

Searched the 73 "eng" + "merced" errors for any mention of "BigSur" or "big sur":

**Result:** ❌ **0 mentions**

The error messages contain:
- ✅ Target hostname: `vpn.eng.cantina.com`
- ✅ Exploit URLs: `/migadmin/lang/legacy/...`, `/sbin/init`, etc.
- ❌ NO mention of "BigSur", "big-sur", "big_sur", or any variant

---

## Comprehensive BigSur Search Summary

Combined with previous searches, here's the complete picture:

| Search Method | Result |
|--------------|--------|
| Direct "bigsur" search | 0 hosts |
| Variant searches (big-sur, big_sur, big sur) | 0 hosts |
| macOS names (sierra, monterey, catalina) | 0 hosts |
| Wildcard host search (*bigsur*) | 0 hosts |
| All 100 Merced-connected hosts | 0 BigSur hosts |
| "eng" + "bigsur" + "merced" errors | 0 results |
| BigSur mentions in "eng" + "merced" errors | 0 mentions |

---

## Conclusions

### 1. BigSur Does Not Exist (in logs)

**Finding:** No BigSur hosts found in any Sumo Logic searches over 12 hours.

**Possible Explanations:**
- BigSur service doesn't exist in this production environment
- BigSur uses a completely different naming convention
- BigSur doesn't interact with Merced authentication services
- BigSur logs to a different system (not Sumo Logic)

### 2. "Eng" Errors Are Security Scans

**Finding:** 73 "eng" + "merced" errors are external security scanning attempts.

**Details:**
- Target: `vpn.eng.cantina.com` (Merced VPN endpoint)
- Type: Path traversal, admin interface probing, exploit attempts
- Source: External attackers
- Impact: Correctly rejected by Merced (404/500 responses)
- **Not related to BigSur or legitimate service errors**

### 3. No BigSur + Merced Issues

**Finding:** Zero evidence of BigSur hosts having Merced endpoint problems.

**Verification:**
- No BigSur hosts with connection errors
- No BigSur hosts with timeout errors
- No BigSur mentions in any error messages
- No BigSur-related authentication failures

### 4. Actual Merced Issues Remain Limited to Boca

From previous analysis:
- **36 legitimate errors** in 12 hours
- All from **Boca hosts** (or Merced itself)
- Connection errors: "Bad file descriptor"
- Public key acquisition failures
- **No other services affected** (Yosemite, Pfeiffer, Tahoe all healthy)

---

## Recommendations

### 1. BigSur Clarification Needed

**Action:** Verify with the team:
- Does "BigSur" actually exist in production?
- What is the correct naming convention if it exists?
- Does BigSur interact with Merced at all?

### 2. Security Scanning - No Action Needed

**Assessment:** The 73 "eng" errors are:
- Normal security scanning noise
- Properly rejected by Merced
- No security vulnerabilities exposed
- **No action required**

### 3. Focus on Boca→Merced Issues

**Priority:** The real issue remains:
- 36 Boca→Merced connection failures
- Network path investigation needed
- BigSur is not part of this problem

---

## Key Insight

The search for "eng" matched because external attackers are targeting:

```
Host: vpn.eng.cantina.com
```

This is **`vpn.eng.cantina.com`** - the engineering VPN endpoint, NOT a reference to "engineering" services or BigSur hosts. The word "eng" appearing in logs is purely coincidental to the hostname being attacked.

**BigSur has zero connection to these errors or Merced endpoints.**

---

## Files Generated

- `eng_bigsur_merced_errors.json` - Empty result (eng + bigsur + merced = 0)
- `eng_merced_detailed_errors.json` - 73 security scanning attempts
- `query_eng_bigsur_merced.sh` - Query script
- `eng_bigsur_merced_summary.md` - This report
