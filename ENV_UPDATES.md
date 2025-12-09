# Environment Variables Update Summary

## Changes Made to `.env.example`

Updated `.env.example` to match the production environment and remove unused variables.

---

## ✅ **Variables Kept (Currently Used)**

### Server Configuration
- `SERVER_PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production)
- `APP_URL` - Application URL for redirects

### Database (PostgreSQL)
- `PG_HOST` - PostgreSQL hostname
- `PG_PORT` - PostgreSQL port
- `PG_DATABASE` - Database name
- `PG_USER` - Database username
- `PG_PASSWORD` - Database password
- `DATABASE_URL` - (Optional) Full connection string

### Redis
- `REDIS_URL` - Redis connection URL for OTP storage

### Stripe
- `STRIPE_SECRET_KEY` - Stripe secret key
- `STRIPE_PUBLISHABLE_KEY` - Stripe publishable key
- `STRIPE_WEBHOOK_SECRET` - Webhook signature verification
- `RETURN_URL_SCHEME` - Stripe Connect return URL
- `REFRESH_URL` - Stripe Connect refresh URL

### Firebase
- `GOOGLE_APPLICATION_CREDENTIALS` - Path to service account JSON
- `FIREBASE_STORAGE_BUCKET` - (Optional) Storage bucket name

### SendGrid
- `SENDGRID_API_KEY` - SendGrid API key
- `FROM_EMAIL` - Sender email (used by code)
- `SENDGRID_FROM_EMAIL` - Sender email (checked by validation)

### SerpAPI
- `SERPAPI_KEY` - SerpAPI key (optional)

### Platform Configuration
- `PLATFORM_FEE_BASIS_POINTS` - Platform fee (300 = 3%)
- `ENABLE_EVENT_SYNC` - Background job toggle

---

## ❌ **Variables Removed (Not Used)**

### Previously in .env.example but not used in code:
- `FRONTEND_URL` - Not used anywhere in the codebase
- `FIREBASE_SERVICE_ACCOUNT_PATH` - Replaced by `GOOGLE_APPLICATION_CREDENTIALS`
- `FIREBASE_PROJECT_ID` - Not used (Firebase SDK detects from credentials)
- `FIREBASE_DATABASE_URL` - Not used (no Realtime Database usage)
- `SENDGRID_FROM_NAME` - Not used in code (optional display name)
- `REDIS_PASSWORD` - Not checked by validation, embedded in REDIS_URL if needed

---

## 🔧 **Key Differences from Production**

Your production `.env` file has these variables that differ from the example:

### Variable Name Differences:
1. **SENDGRID_VERIFIED_SENDERS_EMAIL** (production) vs **FROM_EMAIL** (code)
   - **Solution**: Set both `FROM_EMAIL` and `SENDGRID_FROM_EMAIL` for compatibility
   - Code uses: `process.env.FROM_EMAIL`
   - Validation checks: `process.env.SENDGRID_FROM_EMAIL`

2. **RETURN_URL** (validation) vs **RETURN_URL_SCHEME** (production)
   - **Production uses**: `RETURN_URL_SCHEME`
   - **Validation expects**: `RETURN_URL`
   - **Recommendation**: Update validation or use `RETURN_URL` instead

### Production-Specific Values:
- `DATABASE_URL` - Your production uses full connection string format
- `APP_URL=https://one-time-password-service.onrender.com`
- `PG_HOST=dpg-d36dmggd13ps738874m0-a` (Render PostgreSQL)

---

## ⚠️ **Validation Issues to Fix**

The `validateEnv.ts` file checks for these variables that don't match production:

### Issue 1: RETURN_URL vs RETURN_URL_SCHEME
**Current validation checks**: `RETURN_URL`  
**Production uses**: `RETURN_URL_SCHEME`

**Fix needed in `src/utils/validateEnv.ts`**:
```typescript
// Change line 38 from:
'RETURN_URL': 'Stripe Connect return URL',

// To:
'RETURN_URL_SCHEME': 'Stripe Connect return URL',
```

### Issue 2: FIREBASE_SERVICE_ACCOUNT_PATH
**Current validation checks**: `FIREBASE_SERVICE_ACCOUNT_PATH`  
**Production uses**: `GOOGLE_APPLICATION_CREDENTIALS`

**Fix needed in `src/utils/validateEnv.ts`**:
```typescript
// Change line 30 from:
'FIREBASE_SERVICE_ACCOUNT_PATH': 'Firebase service account JSON path',

// To (or remove if GOOGLE_APPLICATION_CREDENTIALS is sufficient):
'GOOGLE_APPLICATION_CREDENTIALS': 'Firebase service account JSON path',
```

### Issue 3: SENDGRID_FROM_EMAIL
**Current validation checks**: `SENDGRID_FROM_EMAIL`  
**Code uses**: `FROM_EMAIL`  
**Production has**: `SENDGRID_VERIFIED_SENDERS_EMAIL`

**Recommendation**: Standardize on one variable name across validation and code.

---

## 🎯 **Recommended Actions**

1. **Update `src/utils/validateEnv.ts`** to match production variable names:
   - Replace `RETURN_URL` with `RETURN_URL_SCHEME`
   - Replace `FIREBASE_SERVICE_ACCOUNT_PATH` with `GOOGLE_APPLICATION_CREDENTIALS`
   - Align email sender variable naming

2. **Update production `.env`** to include both email variables for compatibility:
   ```bash
   FROM_EMAIL=foundavibellc@gmail.com
   SENDGRID_FROM_EMAIL=foundavibellc@gmail.com
   ```

3. **Remove unused variables** from production `.env` (if present):
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_DATABASE_URL`
   - `FRONTEND_URL`

4. **Consider standardizing** the email service to use one consistent variable name throughout the codebase.

---

## 📋 **Production Checklist**

Before deploying, ensure your production environment has:

- [ ] `SERVER_PORT=3000`
- [ ] `NODE_ENV=production`
- [ ] `APP_URL=https://one-time-password-service.onrender.com`
- [ ] `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, `PG_PASSWORD` (or `DATABASE_URL`)
- [ ] `REDIS_URL` with credentials if needed
- [ ] `STRIPE_SECRET_KEY` (production key, starts with `sk_live_`)
- [ ] `STRIPE_PUBLISHABLE_KEY` (production key, starts with `pk_live_`)
- [ ] `STRIPE_WEBHOOK_SECRET` (production webhook secret)
- [ ] `RETURN_URL_SCHEME` and `REFRESH_URL` pointing to production domain
- [ ] `GOOGLE_APPLICATION_CREDENTIALS` path to service account
- [ ] `SENDGRID_API_KEY` (production key)
- [ ] `FROM_EMAIL` and `SENDGRID_FROM_EMAIL` (verified sender)
- [ ] `PLATFORM_FEE_BASIS_POINTS=300`
- [ ] `ENABLE_EVENT_SYNC=true`

---

## 📝 **Notes**

- The `.env.example` file now matches the production environment structure
- Unused variables have been removed to reduce confusion
- Comments added to explain production vs development differences
- Both `FROM_EMAIL` and `SENDGRID_FROM_EMAIL` included for compatibility
- Optional variables are commented out with examples
