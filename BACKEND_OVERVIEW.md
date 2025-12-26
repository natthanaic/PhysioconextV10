# Backend Architecture Overview

This document summarizes the current Express backend layout so future work can stay aligned with the existing design.

## Application entry points
- **`server.js`** initializes environment configuration, security middleware (Helmet with CSP, CORS, compression, logging), MySQL connection pooling, session storage, and rate limiting before attaching the Express app instance. It also ensures runtime directories are created and wires Socket.IO support through `initializeSocketIO`.【F:server.js†L1-L111】【F:server.js†L112-L213】
- **`app.js`** houses the primary Express application setup—parsing, static asset handling, view engine configuration, and route mounting. A lightweight request logger is included to trace non-static requests.【F:app.js†L1-L56】【F:app.js†L57-L106】

## Routing layout
Routes are grouped by feature area and mounted in `app.js`:
- Core auth and identity flows: `/api/auth` (`auth.js`), two-factor (`2fa.js`), and Google OAuth (`google-oauth.js`).【F:app.js†L66-L76】
- Clinical domain modules: patients (`patients.js`), PN cases (`pn-cases.js` via both `/api/pn` and `/api`), appointments (`appointments.js`), and specialized content (`specialized.js`).【F:app.js†L74-L88】
- Administrative and marketing extensions: admin utilities (`admin.js`), expenses (`/api/expenses`), optional broadcast campaigns (`/api/broadcast`), and public-facing APIs (`/api/public`).【F:app.js†L74-L95】
- Integrations and assistants: Thai national card lookup (`/api/thai_card`), webhooks (`/webhook`), AI assistants (`/api/shinoai`, `/api/shinoai-rag`), and chat endpoints (`/api/chat`).【F:app.js†L68-L93】
- Documents and UI views are served at the root level through `documents.js` and `views.js`.【F:app.js†L94-L100】

## Real-time messaging
- **`socket-server.js`** configures Socket.IO with cross-domain support, tracks active users across domains, persists conversations to MySQL, and exposes events for authentication, messaging, read receipts, typing indicators, and presence notifications.【F:socket-server.js†L1-L140】【F:socket-server.js†L141-L214】

## Finance and reporting
- **`routes/expenses.js`** provides admin-only expense tracking, summary reporting, and CSV export built atop the shared MySQL connection available on `req.app.locals.db`. Filters support category, year, and month for ledger queries.【F:routes/expenses.js†L1-L70】【F:routes/expenses.js†L71-L145】

## Database artifacts
- **`database/broadcast_schema.sql`** and **`database/BROADCAST_SETUP.md`** supply schema and setup guidance for the optional broadcast/marketing feature set so database migrations stay aligned with the messaging module.【F:database/BROADCAST_SETUP.md†L1-L40】【F:database/broadcast_schema.sql†L1-L48】

## Design conventions
- **Session and security defaults** live in `server.js`; additions should honor the existing Helmet/CORS/rate-limit patterns before introducing new middleware.【F:server.js†L34-L111】
- **Route organization** follows feature-based modules mounted from `app.js`; new features should be added as discrete files under `routes/` and registered with clear mount paths to avoid conflicts with existing catch-all routes.【F:app.js†L57-L106】
