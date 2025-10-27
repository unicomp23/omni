# Production Data Setup

## Status: IN PROGRESS

### Issue Found
The initial downloads were pulling from **automation/test environment**, not production.

### Evidence
```
Automation hostname: bixby-i-004b85f03ec913420-us-east-1-automation703
Production hostname: bixby-i-08da0f6597d722eed-us-east-1-prod-us-east-1
```

## Production Query Updates

### Bixby (UPDATED)
```javascript
// OLD (automation + production mixed)
query: '_view="media_bixby" AND latencyMs'

// NEW (production only)
query: '_view="media_bixby" AND env=prod AND latencyMs'
```

**Key Fields in Production Bixby Logs:**
- `env=prod`
- `Collector: bixby-i-*-prod-us-east-1`
- `Index: media_bixby`

### Master/Tecate (PENDING)
```javascript
// OLD
query: '"RegisterStream RECEIVED" AND receiveTimeMs'

// NEW (need to confirm production filter)
query: '??? AND env=prod AND "RegisterStream RECEIVED" AND receiveTimeMs'
```

**Need to determine:**
- What index/view contains Master production logs?
- Does it use the same `env=prod` filter?
- What's the Source Category or Collector pattern?

## Action Plan

- [x] Identify issue (automation vs production)
- [x] Stop automation downloads
- [x] Update Bixby query with env=prod filter
- [ ] Get sample Master production log entry
- [ ] Update Master query with production filter
- [ ] Decide what to do with automation data
- [ ] Start production downloads

## Existing Automation Data

**Location:**
- `latency.study/bixby_logs/` - 1,942 chunks (Sept 7-27, automation)
- `latency.study/master_logs/` - 2,012 chunks (Sept 7-27, automation)

**Options:**
1. Delete (don't need automation data)
2. Move to `automation_backup/` (keep for reference)
3. Leave in place (will be overwritten by production downloads)

## Testing Production Query

Before starting full download, test the production query:

```bash
# In SumoLogic, run this query for a small time window:
_view="media_bixby" AND env=prod AND latencyMs
| timeslice 15m
| count by _timeslice

# Verify you see data and it's from production hosts (not automation*)
```

## Sample Log Entries

### Bixby Production
```
Sep 26 18:50:02 bixby-i-08da0f6597d722eed-us-east-1 bixby_server:
[2025-09-26 18:50:02.984323] [info] [TecateClientSession_Master]
{10.2.47.248:58760 <-> 52.21.137.240:3501} [0x00007f66caff8700]
NotifyStream COMPLETE latencyId=4a36b94e-ce49-4208-8cce-21a9ba40593c
latencyMs=1 endTimeMs=1758912602984 type=response_received

Fields:
  Collector: bixby-i-08da0f6597d722eed-us-east-1-prod-us-east-1
  env: prod
  region: us-east-1
  Source Category: OS/Linux/System
```

### Master/Tecate Production
```
[PENDING - need sample entry]
```

---

*Last updated: 2025-10-24*
