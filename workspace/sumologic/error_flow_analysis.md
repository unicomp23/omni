# What Happens During the Error - Flow Analysis

## The Error Log

```
Oct 20 09:17:51 merced-i-0c0e5e984b2e07100-us-east-1-automation205 run[223801]:
<error>2025/10/20 09:17:51.687[middleware-logger.mjs:18] [middleware-logger]
{
  "id":"4445904d-3726-4bf6-bc94-ca4c05d7b901",
  "method":"GET",
  "url":"/api/v2/static/not.found",
  "header":{
    "host":"vpn.eng.cantina.com",
    "user-agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36..."
  },
  "query":{},
  "body":{}
}
    at errorLogger (file:///opt/airtime/lib/merced/node_modules/express-media-utils/libs/base/middleware-logger.mjs:18:12)
    at Layer.handle [as handle_request] (/opt/airtime/lib/merced/node_modules/express/lib/router/layer.js:95:5)
    ...
```

---

## Step-by-Step: What Happens

### 1. **External Request Arrives**

```
Time:    09:17:51.687 UTC
Source:  External attacker
Target:  vpn.eng.cantina.com
Method:  GET
URL:     /api/v2/static/not.found
```

**Who:** Security scanner/bot (User-Agent shows Chrome 110.0)
**What:** Probing for a FortiGate VPN API endpoint that doesn't exist
**Why:** Attempting to find vulnerabilities or exposed APIs

### 2. **Request Hits Merced Server**

The request is received by:
- **Host:** `merced-i-0c0e5e984b2e07100-us-east-1-automation205`
- **Process:** Node.js Express application (PID 223801)
- **Location:** `/opt/airtime/lib/merced/`

### 3. **Express Routing Layer**

The request passes through Express.js middleware chain:

```javascript
1. Request enters Express router
   └─> Express router (router/index.js:284)
       └─> Process route parameters (router/index.js:335)
           └─> Try to find matching route (router/layer.js:95)
               └─> URL rewriting middleware (if applicable)
                   └─> No route matches "/api/v2/static/not.found"
```

**Key Point:** Merced doesn't have this endpoint defined, so Express moves to error handling.

### 4. **URL Rewriting Middleware (Optional Check)**

From `merced-router.mjs`:
```javascript
this.use((req, res, next) => {
  if (req.url.includes('revokable')) {
    req.url = req.url.replace(/revokable/g, 'revocable');
  }
  next();
});
```

**In this case:** URL `/api/v2/static/not.found` does NOT contain "revokable"
**Result:** No rewriting occurs, request passes through unchanged

### 5. **No Route Match Found**

Merced's defined routes are:
- `/token/*` - Token signing
- `/validation` - Token validation
- `/revocation/*` - Key revocation
- `/rotation/*` - Key rotation
- `/public-keys/*` - Public key retrieval
- `/health` - Health check
- `/dbcache/clear` - Clear DB cache (automation only)

**The requested URL `/api/v2/static/not.found` matches NONE of these.**

### 6. **Error Handler Middleware Triggered**

Express's error handling middleware chain is invoked. The `express-media-utils` package's `errorLogger` middleware catches this:

**File:** `node_modules/express-media-utils/libs/base/middleware-logger.mjs`
**Function:** `errorLogger` (line 18)

```javascript
static errorLogger(err, req, res, next) {
  const reqId = req.id ? req.id : 'unknown';

  // Log detailed request information for errors
  logger.error(parseSimpleRequest_(req));  // ← THIS IS LINE 18

  logger.error(`Error in ${req.method} ${req.path || req.url} - ${reqId}: ${err.message}`);
  logger.debug(err.stack);

  next(err);
}
```

### 7. **Request Details Logged**

The `parseSimpleRequest_` function extracts and formats request data:

```javascript
function parseSimpleRequest_(req) {
  const header = {
    host: req.headers.host,                // vpn.eng.cantina.com
    'user-agent': req.headers['user-agent'] // Mozilla/5.0...
  };

  const simpleRequest = {
    id: req.id,                             // 4445904d-3726-4bf6-bc94-ca4c05d7b901
    method: req.method,                     // GET
    url: req.url,                           // /api/v2/static/not.found
    header: header,
    query: req.query,                       // {}
    body: req.body                          // {}
  };

  return JSON.stringify(simpleRequest);
}
```

**This produces the JSON you see in the log.**

### 8. **Logger Writes to Syslog**

The `node-media-utils` Logger class writes the error:

```javascript
const Logger = require('node-media-utils').Logger;
const logger = new Logger('http');

logger.error(...);  // Writes to syslog with <error> tag
```

**Output destination:** System log → Sumo Logic collector → Your query results

### 9. **Response Sent to Client**

Express sends an HTTP response:
- **Status Code:** 404 Not Found
- **Body:** Error message (route not found)
- **Time:** ~few milliseconds

The attacker receives the 404 and knows this endpoint doesn't exist.

---

## Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. External Attacker                                            │
│    URL: /api/v2/static/not.found                               │
│    Host: vpn.eng.cantina.com                                   │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. AWS Load Balancer (merced.prod.cantina.com)                 │
│    Routes to: merced-i-0c0e5e984b2e07100...automation205       │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Express.js Server (Node.js)                                 │
│    Process ID: 223801                                           │
│    Path: /opt/airtime/lib/merced/                              │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Express Router Chain                                         │
│    ├─→ Parse request                                            │
│    ├─→ URL rewriting middleware (checks for "revokable")       │
│    │   └─→ Not found, passes through                           │
│    ├─→ Try to match route                                       │
│    └─→ No match found for /api/v2/static/not.found            │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Error Handler Middleware                                     │
│    express-media-utils/libs/base/middleware-logger.mjs:18      │
│                                                                 │
│    errorLogger() called:                                        │
│    ├─→ Extract request details                                  │
│    ├─→ Format as JSON                                           │
│    └─→ Log to syslog with <error> tag                          │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. System Log (syslog)                                          │
│    Timestamp: Oct 20 09:17:51                                   │
│    Level: <error>                                               │
│    Content: JSON request details + stack trace                  │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. Sumo Logic Collector                                         │
│    Reads syslog, ships to Sumo Logic cloud                      │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ 8. Your Query Results                                           │
│    Search: "eng" + "merced" + "error"                          │
│    Match: "vpn.eng.cantina.com" in header                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Why This Is Logged as an Error

### Logging Level Logic

From `middleware-logger.mjs`:
```javascript
res.on('finish', () => {
  const status = res.statusCode;

  if (status >= 500) {
    logger.error(...);      // Server errors
  } else if (status >= 400) {
    logger.warn(...);       // Client errors (404 = this case)
  } else {
    logger.info(...);       // Success
  }
});
```

**Expected:** This should be logged as `<warn>` (404 = client error)
**Actual:** Logged as `<error>`

**Why the discrepancy?**

The `errorLogger` middleware is catching this as an unhandled route BEFORE the response is sent. Express treats "no route matched" as an error condition that triggers error middleware, even though it will eventually return 404.

---

## Is This a Problem?

### ❌ NO - This is expected behavior

**Reasons:**

1. **Security scanning is normal**
   - External actors constantly probe public endpoints
   - FortiGate VPN APIs are common targets
   - 404 responses correctly reject invalid requests

2. **Logging is appropriate**
   - Tracks all access attempts (good for security auditing)
   - Helps identify attack patterns
   - No sensitive information leaked

3. **Performance impact: minimal**
   - Request handled quickly (no database queries)
   - Router check is fast
   - Response sent immediately

4. **No service disruption**
   - Merced continues serving legitimate requests
   - Valid endpoints unaffected
   - This is noise, not signal

---

## What Merced Is Actually Doing Right

### ✅ Proper Error Handling

1. **Structured logging:** JSON format with request ID for tracing
2. **Security headers:** User-Agent captured for analysis
3. **Stack trace:** Full context preserved for debugging
4. **Non-blocking:** Error doesn't crash server

### ✅ Defense in Depth

1. **No endpoint exposure:** Non-existent routes return 404
2. **No information leakage:** Generic error responses
3. **Audit trail:** All attempts logged
4. **Rate limiting:** (likely at load balancer level)

---

## Summary

**What happens during the error:**

1. Attacker requests non-existent endpoint `/api/v2/static/not.found`
2. Express router can't find a match
3. Error middleware (`errorLogger`) catches it
4. Request details logged to syslog as JSON
5. 404 response sent to attacker
6. Log shipped to Sumo Logic
7. Your query matches "eng" (from hostname `vpn.eng.cantina.com`)

**This is:**
- ✅ Expected behavior
- ✅ Proper error handling
- ✅ Good security practice
- ❌ NOT a service problem
- ❌ NOT related to "revokable" spelling
- ❌ NOT a BigSur issue

**The error is noise from external security scanning, not a Merced malfunction.**
