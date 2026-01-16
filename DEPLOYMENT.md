# Vibesy Backend - Render Deployment Guide

## Root Cause of Initial Crash

**Error**: `TypeError: Cannot read properties of undefined (reading 'prototype')` at `buffer-equal-constant-time/index.js`

**Root Causes**:
1. **Node.js version incompatibility**: The `buffer-equal-constant-time` package (a transitive dependency via `firebase-admin` → `jsonwebtoken` → `jws` → `jwa`) uses deprecated `SlowBuffer` APIs that were removed in Node.js 22+
2. **Missing PORT environment variable**: Render uses `PORT` env var, but the app only checked `SERVER_PORT`
3. **Potential dev tool usage in production**: Risk of using `ts-node-dev` in production instead of compiled JavaScript

## Fixes Applied

### 1. Node.js Version Pinned to 20.x LTS
- **package.json**: `"node": "20.x"`
- **.nvmrc**: `20.18.2`
- **.npmrc**: `use-node-version=20.18.2`

Node 20.x is the current LTS and is compatible with all dependencies including the legacy `buffer-equal-constant-time` package.

### 2. Port Binding Fixed for Render
Updated `src/server.ts` to check `process.env.PORT` first (Render's convention), then fallback to `SERVER_PORT`:

```typescript
const port = parseInt(process.env.PORT || process.env.SERVER_PORT || '4242');
```

Server binds to `0.0.0.0` (already correct) to accept external connections.

### 3. Production Build Verified
- **Dev mode**: Uses `ts-node-dev` (dev dependency only)
- **Production mode**: Uses compiled JavaScript from `dist/`
- Build command: `pnpm install && pnpm run build`
- Start command: `pnpm start` (runs `node dist/index.js`)

### 4. Enhanced Startup Logging
Added logs showing:
- Node.js version
- Port being listened on
- Host (0.0.0.0)
- Environment

Example output:
```
Starting Vibesy Backend... {"nodeVersion":"v20.18.2","platform":"linux","environment":"production"}
✓ Vibesy API server running {"nodeVersion":"v20.18.2","port":10000,"host":"0.0.0.0",...}
```

## Render Configuration

### Option A: Using render.yaml (Infrastructure as Code)
The `render.yaml` file is included in the repo:

```yaml
services:
  - type: web
    name: vibesy-backend
    runtime: node
    buildCommand: pnpm install && pnpm run build
    startCommand: pnpm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: NODE_VERSION
        value: 20.18.2
```

### Option B: Manual Dashboard Configuration
If not using `render.yaml`, configure in Render dashboard:

**Build Command**:
```bash
pnpm install && pnpm run build
```

**Start Command**:
```bash
pnpm start
```

**Environment Variables**:
- `NODE_VERSION` = `20.18.2`
- `NODE_ENV` = `production`
- Plus all your app-specific vars (DATABASE_URL, STRIPE_SECRET_KEY, etc.)

## Verification Steps

### 1. Check Node Version in Logs
Look for startup log line:
```
Starting Vibesy Backend... {"nodeVersion":"v20.18.2",...}
```

### 2. Health Check
```bash
curl https://your-app.onrender.com/health
```

Expected response:
```json
{"status":"ok","timestamp":"2026-01-16T...","environment":"production"}
```

### 3. Readiness Check
```bash
curl https://your-app.onrender.com/ready
```

Expected response:
```json
{"status":"ready","timestamp":"...","checks":{"postgres":{"status":"ok"},"redis":{"status":"ok"}}}
```

### 4. Port Binding
Check logs for:
```
✓ Vibesy API server running {"nodeVersion":"v20.18.2","port":10000,"host":"0.0.0.0",...}
```

Port should match Render's assigned PORT (typically 10000).

## Dependency Safety Verification

All critical dependencies are compatible with Node 20.x:

- **firebase-admin** 12.6.0 ✓
- **jsonwebtoken** (transitive) ✓
- **jws/jwa** (transitive) ✓
- **buffer-equal-constant-time** (transitive) ✓ (works with Node 20.x)
- **stripe** 17.3.0 ✓
- **express** 4.21.1 ✓
- **pg** 8.12.0 ✓

No major version upgrades required.

## Scripts Summary

```json
{
  "dev": "ts-node-dev --respawn --transpile-only src/index.ts",    // ✓ Dev only
  "build": "tsc",                                                    // ✓ Production build
  "start": "node dist/index.js",                                     // ✓ Production runtime
  "start:prod": "NODE_ENV=production node dist/index.js"            // ✓ Explicit prod mode
}
```

**Confirmation**: ✓ ts-node-dev is in `devDependencies` only and NOT used in production.

## Troubleshooting

### If you still see the buffer-equal-constant-time error:
1. Check Render logs for actual Node version used
2. Verify `.nvmrc` is in the repo root
3. Rebuild from scratch in Render (clear build cache)
4. Ensure `NODE_VERSION=20.18.2` is set in environment variables

### If server doesn't bind to port:
1. Check Render logs for port number in startup message
2. Verify `process.env.PORT` is available (Render sets this automatically)
3. Check for port conflicts or firewall issues

### If build fails:
1. Ensure `pnpm-lock.yaml` is committed to the repo
2. Check build logs for TypeScript compilation errors
3. Try running `pnpm install && pnpm run build` locally first

## Local Development

To match production environment locally:

```bash
# Use Node 20.x (via nvm)
nvm use

# Install dependencies
pnpm install

# Run in dev mode
pnpm dev

# Test production build
pnpm run build
pnpm start:prod  # Requires .env file with all vars
```

## Summary

✅ Node.js pinned to 20.x LTS (eliminates buffer-equal-constant-time crash)  
✅ PORT environment variable properly handled (Render compatibility)  
✅ Production uses compiled JavaScript, not ts-node-dev  
✅ Enhanced logging shows Node version and port at startup  
✅ All dependencies verified compatible with Node 20.x  
✅ Deployment configuration documented (render.yaml + manual steps)  

The backend is now production-ready for Render deployment.
