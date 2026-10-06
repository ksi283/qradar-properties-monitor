# QRadar Properties Monitor

A TypeScript/Node.js service that connects to an **IBM QRadar SIEM**, syncs all custom event/flow properties, detects changes in real time, and exposes a live web dashboard and REST API.

---

## Features

| Feature | Details |
|---|---|
| **Auth** | SEC token *or* HTTP Basic auth |
| **SSL** | Configurable — skip verify for self-signed certs |
| **Sync** | Cron-driven polling (default every 60 s) |
| **Change detection** | CREATED / UPDATED / DELETED alerts with field-level diff |
| **REST API** | Full CRUD for properties and expressions |
| **Live stream** | Server-Sent Events push alerts to the browser instantly |
| **Dashboard** | Dark-mode SPA — filterable table, alert feed, KPI cards |

---

## Quick Start

### 1 — Install dependencies

```bash
npm install
```

### 2 — Configure connection

```bash
cp .env.example .env
# Edit .env — set QRADAR_HOST and QRADAR_TOKEN (or USERNAME/PASSWORD)
```

### 3 — Start (development)

```bash
npm run dev
```

### 3 — Start (production build)

```bash
npm run build
npm start
```

Open **http://localhost:3000** in your browser.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `QRADAR_HOST` | ✅ | — | QRadar console URL, e.g. `https://192.168.1.10` |
| `QRADAR_TOKEN` | ⚠️ one of | — | Authorized Service token (SEC header) |
| `QRADAR_USERNAME` | ⚠️ one of | — | Basic auth username |
| `QRADAR_PASSWORD` | ⚠️ one of | — | Basic auth password |
| `QRADAR_VERIFY_SSL` | | `true` | Set `false` for self-signed certs |
| `QRADAR_API_VERSION` | | `21.0` | QRadar REST API version |
| `SYNC_CRON` | | `*/1 * * * *` | Cron schedule for polling |
| `PORT` | | `3000` | HTTP server port |
| `ALERT_MAX_HISTORY` | | `500` | Max alerts kept in memory |
| `LOG_LEVEL` | | `info` | `debug` / `info` / `warn` / `error` |

---

## REST API Reference

### Status

```
GET /api/status
```
Returns sync state, property count, alert count, last error.

---

### Properties

```
GET    /api/properties             # list (query: ?search= ?enabled= ?type=)
GET    /api/properties/:id         # single property (live from QRadar)
POST   /api/properties             # create
PUT    /api/properties/:id         # update (partial)
DELETE /api/properties/:id         # delete
```

#### Create body example

```json
{
  "name": "HTTP_Method",
  "property_type": "STRING",
  "description": "Extracts HTTP verb from web server logs",
  "enabled": true,
  "use_for_rule_engine": true
}
```

---

### Expressions

```
POST   /api/properties/:id/expressions     # add regex expression to a property
PUT    /api/expressions/:exprId            # update expression
DELETE /api/expressions/:exprId            # delete expression
```

#### Add expression body

```json
{
  "regex": "Method=([A-Z]+)",
  "capture_group": 1,
  "log_source_type_id": 12   
}
```

---

### Alerts

```
GET /api/alerts                    # list (query: ?limit= ?kind=CREATED|UPDATED|DELETED)
GET /api/alerts/stream             # Server-Sent Events stream
```

#### Alert object shape

```json
{
  "id": "uuid",
  "kind": "UPDATED",
  "timestamp": 1720000000000,
  "propertyId": 42,
  "propertyName": "HTTP_Method",
  "previous": { ... },
  "current":  { ... },
  "diff": [
    { "field": "enabled", "from": true, "to": false },
    { "field": "expressions[7]", "from": { "regex": "old" }, "to": { "regex": "new" } }
  ]
}
```

---

### Sync

```
POST /api/sync    # trigger immediate sync
```

---

## QRadar Authorization

In QRadar, create an **Authorized Service** with the following capabilities:

- **Admin** → *Custom Event Properties*  
- **Log Activity** → *User Defined Event Properties*

Then copy the token to `QRADAR_TOKEN` in your `.env`.

---

## Project Structure

```
src/
  index.ts            Entry point — wires everything up
  config.ts           Env loading and validation
  logger.ts           Winston logger
  types.ts            Shared TypeScript types
  qradar-client.ts    QRadar REST API wrapper (auth, CRUD, expressions)
  sync-engine.ts      Cron polling, snapshot diffing, alert dispatch
  diff.ts             Field-level property diff logic
  alert-store.ts      In-memory alert ring-buffer + EventEmitter
  api/
    routes.ts         Express router (REST + SSE)
    server.ts         Express app builder
public/
  index.html          Live dashboard SPA
logs/
  monitor.log         Rolling log file
```
