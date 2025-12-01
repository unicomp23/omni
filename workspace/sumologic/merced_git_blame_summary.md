# Merced Git Blame Analysis - Error Context

**Error Log:**
```
Oct 20 09:17:51 merced-i-0c0e5e984b2e07100-us-east-1-automation205 run[223801]:
<error>2025/10/20 09:17:51.687[middleware-logger.mjs:18] [middleware-logger]
{"id":"4445904d-3726-4bf6-bc94-ca4c05d7b901","method":"GET","url":"/api/v2/static/not.found",
"header":{"host":"vpn.eng.cantina.com","user-agent":"Mozilla/5.0..."}}
```

**Repository:** `airtimemedia/merced`
**Default Branch:** `develop`
**Description:** Token service for the Airtime Media Platform

---

## Key File: `merced/libs/routers/merced-router.mjs`

### URL Rewriting Middleware

The file contains a URL rewriting middleware that handles the `revokable` → `revocable` spelling correction:

```javascript
// Add URL rewriting middleware
this.use((req, res, next) => {
  // Replace 'revokable' with 'revocable' in the URL
  // req.url = req.url.replace(/revokable/g, 'revocable');
  if (req.url.includes('revokable')) {
    req.url = req.url.replace(/revokable/g, 'revocable');
  }

  // You can add more string replacements here if needed
  // For example:
  // req.url = req.url.replace('/old-path', '/new-path');

  next();
});
```

**Purpose:** This middleware rewrites URLs to correct the misspelling "revokable" → "revocable" for backward compatibility.

---

## Git Blame / Commit History

### Most Recent Significant Commits

#### 1. **TAHOE-56: Export public key for revocable token**
- **Commit:** `77c91d8`
- **Author:** Art Asano <art@airtime.com>
- **Date:** 2025-05-13 (May 13, 2025)
- **Message:** "TAHOE-56 exports public key for revocable token"

#### 2. **YOS-197: Public key acquisition does not require auth token**
- **Commit:** `cf2056d`
- **Author:** artasano (Art Asano)
- **Date:** 2024-09-04 (September 4, 2024)
- **PR:** #41
- **Message:** "YOS-197 public key acquisition does not require auth token"
- **Changes:**
  - Public key endpoints no longer require authentication
  - Removed auth token requirement for `/public-keys/*` endpoints

#### 3. **YOS-193: URL Rewriter for revokable → revocable** ⭐ KEY COMMIT
- **Commit:** `e70a2bf`
- **Author:** John Davis <john.davis@aircore.io>
- **Date:** 2024-08-15 (August 15, 2024)
- **PR:** #37
- **GitHub User:** @unicomp23 (John Davis)
- **Message:** "Feature/yos 193 incorrect endpoint in merced used by yosemite"

**Details:**
- **Problem:** Yosemite was using incorrect endpoint spelling "revokable" instead of "revocable"
- **Solution:** Added URL rewriting middleware to automatically convert "revokable" → "revocable"
- **Implementation:**
  - Middleware in `merced-router.mjs` that rewrites URLs before routing
  - Allows backward compatibility for clients using old endpoint names
  - Includes automation tests for deprecated endpoints

**Commit History:**
```
* url rewriter
* automation, log urls
* change callback style
* lint-fix
* url rewrite
* old automation tests for routes containing 'revokable'
* fix automation test
* cleanup, lastStats, beforeEach
* remove logging, url rewriter
```

---

## Related Changes

### Earlier Foundation Commits

#### 4. **YOS-116: Lint fixes**
- **Author:** Art Asano
- **Date:** 2022-11-16

#### 5. **YOS-71: Inquire public key**
- **Author:** Art Asano
- **Date:** 2022-07-26
- Initial public key inquiry functionality

#### 6. **YOS-39: Non-revokable class rotation**
- **Author:** Art Asano
- **Date:** 2022-06-09
- Implemented token class rotation

#### 7. **YOS-25: Revoke keys**
- **Author:** Art Asano
- **Date:** 2022-05-17
- Key revocation functionality

#### 8. **YOS-5: Token validation**
- **Author:** Art Asano
- **Date:** 2022-05-13
- Core token validation logic

#### 9. **YOS-6: Initial implementation**
- **Author:** Art Asano
- **Date:** 2022-05-09 - 2022-05-12
- Security token validation, stats logging
- Automation clear DB and cache
- Signing token functionality

---

## Error Context Analysis

### The Error You Showed

**URL:** `/api/v2/static/not.found`
**Host:** `vpn.eng.cantina.com`
**Type:** Security scanning attempt (404 response expected)

**This error is NOT related to:**
- The revokable/revocable spelling issue
- The URL rewriting middleware
- Legitimate Merced functionality

**This error IS:**
- An external security scanning attempt (as analyzed earlier)
- Properly logged by the middleware-logger from `express-media-utils`
- Expected behavior (404 for non-existent endpoints)

---

## Key Contributors

### Art Asano (@art@airtime.com)
- **Primary architect** of Merced token service
- Commits: TAHOE-56, YOS-197, YOS-116, YOS-71, YOS-39, YOS-25, YOS-5, YOS-6
- Responsible for core functionality, public key management, token validation

### John Davis (@unicomp23)
- **Author of URL rewriting middleware**
- Commit: YOS-193 (August 2024)
- Fixed endpoint compatibility issue between Yosemite and Merced
- Implemented revokable → revocable URL rewriting

---

## Timeline of Major Changes

```
2022-05-09  │ YOS-6   │ Art Asano    │ Initial Merced implementation
2022-05-13  │ YOS-5   │ Art Asano    │ Token validation
2022-05-17  │ YOS-25  │ Art Asano    │ Key revocation
2022-06-09  │ YOS-39  │ Art Asano    │ Non-revokable class rotation
2022-07-26  │ YOS-71  │ Art Asano    │ Public key inquiry
2022-11-16  │ YOS-116 │ Art Asano    │ Lint fixes
2024-08-15  │ YOS-193 │ John Davis   │ URL rewriter (revokable → revocable) ⭐
2024-09-04  │ YOS-197 │ Art Asano    │ Remove auth for public keys
2025-05-13  │ TAHOE-56│ Art Asano    │ Export revocable token public key
```

---

## Current Code State

**URL Rewriting:** Active
**Purpose:** Backward compatibility for "revokable" spelling
**Location:** `merced/libs/routers/merced-router.mjs:77-86`
**Author:** John Davis (@unicomp23)
**Since:** August 15, 2024

**Impact on Error Logs:**
- The error you showed (`/api/v2/static/not.found`) is unrelated to this middleware
- URL rewriting only affects paths containing "revokable"
- Security scanning errors are expected and properly handled

---

## Recommendations

1. **URL Rewriting Middleware:** Working as intended, no changes needed
2. **Security Scanning Errors:** These are normal and properly logged
3. **Public Key Endpoints:** Auth removed in YOS-197, working correctly
4. **Backward Compatibility:** Successfully maintained through URL rewriting

---

## Related Issues

- **YOS-193:** Incorrect endpoint in Merced used by Yosemite (Fixed)
- **YOS-197:** Public key acquisition auth requirement (Removed)
- **TAHOE-56:** Public key export for revocable tokens (Implemented)
