# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

Vibesy Backend is a modern event ticketing platform API built with TypeScript, Express, PostgreSQL, Redis, and Stripe Connect. It handles event management, ticket sales, QR code generation, OTP-based authentication, and payment processing with automated payouts to event hosts.

## Tech Stack

- **Runtime**: Node.js 18+, TypeScript 5.6
- **Framework**: Express.js
- **Database**: PostgreSQL 12+ (primary data store)
- **Cache/OTP Storage**: Redis 6+
- **Payment Processing**: Stripe Connect (Express accounts for hosts)
- **Authentication**: Firebase Admin SDK
- **Email**: SendGrid
- **Background Jobs**: node-cron
- **Package Manager**: pnpm (preferred) or npm

## Development Commands

### Setup & Installation
```bash
pnpm install                # Install dependencies
cp .env.example .env       # Create environment file (then edit)
```

### Running the Application
```bash
pnpm dev                   # Development server with hot reload (ts-node-dev)
pnpm build                 # Compile TypeScript to dist/
pnpm start                 # Run production build
pnpm start:prod            # Run with NODE_ENV=production
```

### Database Management
```bash
pnpm run db:reset          # Drop and recreate database (scripts/reset-database.js)
# Note: Schema (schema.sql) and migrations (migrations/*.sql) run automatically on startup
```

### Docker Services
```bash
docker-compose up -d       # Start PostgreSQL container
docker-compose down        # Stop services
```

### Other Commands
```bash
pnpm run clean             # Remove dist/ directory
pnpm run build:clean       # Clean then build
pnpm lint                  # (Not configured yet)
pnpm test                  # (Not configured yet)
```

## Architecture

### Layered Architecture
The codebase follows a clean, layered architecture:

```
src/
├── index.ts              # Entry point
├── server.ts             # Express app config, routes, middleware registration
├── database.ts           # PostgreSQL connection pool, migration runner, database utilities
├── stripe.ts             # Stripe client, payment/Connect account utilities
├── routes/               # API route handlers (thin layer, delegates to services)
├── services/             # Business logic (email, notifications, OTP, events, admin)
├── repositories/         # Data access layer (not heavily used, most queries in database.ts)
├── middleware/           # Express middleware (auth, validation, logging, errors)
├── jobs/                 # Background job schedulers (event sync, etc.)
├── utils/                # Utility functions (errors, templates, async handlers)
├── templates/            # Email templates
└── types/                # TypeScript type definitions
```

### Database Architecture

**Schema Initialization**: The application automatically runs `schema.sql` on startup to create/update core tables (`users`, `events`, `orders`, `tickets`).

**Migration System**: Custom migration tracking via `schema_migrations` table. Migrations in `migrations/*.sql` are run alphabetically, tracked, and skipped if already executed. Migrations are idempotent using `DO $$ ... END $$` blocks.

**Core Tables**:
- `users`: Tracks buyers and hosts; stores Stripe Customer ID (buyers) and Stripe Connect ID (hosts)
- `events`: Physical events created by hosts (stored locally in PostgreSQL)
- `orders`: Ticket purchases with Stripe PaymentIntent tracking; supports both local events (`event_id`) and external Firestore events (`external_event_id`)
- `tickets`: Individual QR-coded tickets for event entry

**Key Pattern**: `orders` and `tickets` support both local events (PostgreSQL `event_id`) and external events (Firestore UUID `external_event_id`) via constraint checks ensuring one or the other is set.

### Payment Flow (Stripe Connect)

1. **Host Onboarding**: Hosts create Stripe Express accounts via `/connect/*` endpoints
2. **Ticket Purchase**: Buyers purchase tickets via `/payments/create-payment-intent`
   - Creates PaymentIntent with `transfer_data.destination` set to host's Connect account
   - Platform fee deducted via `application_fee_amount`
3. **Payment Completion**: Stripe webhook (`payment_intent.succeeded`) confirms payment and creates order/tickets
4. **Automatic Payouts**: Stripe automatically transfers funds (minus platform fee) to host's bank account

**Important**: Webhooks require raw body for signature verification, so webhook routes are registered BEFORE `express.json()` middleware in `server.ts`.

### Background Jobs

Jobs are managed by `jobScheduler` (singleton in `src/jobs/jobScheduler.ts`):
- **Event Sync Job**: Periodically syncs events from external sources
- Jobs can be enabled/disabled via environment variables (e.g., `ENABLE_EVENT_SYNC=false`)
- Manual job execution: `POST /system/jobs/:jobName/run`
- Job status: `GET /system/jobs`

### API Routes

Route files in `src/routes/` are imported and mounted in `server.ts`:

- `/connect` - Stripe Connect account creation/onboarding
- `/payments` - Payment intent creation for ticket purchases
- `/webhooks` - Stripe webhooks (MUST be registered before JSON middleware)
- `/tickets` - Ticket validation, QR scanning, retrieval
- `/events` - Event CRUD operations
- `/auth` - Firebase authentication integration
- `/notifications` - Push notifications via Firebase Cloud Messaging
- `/otp` - OTP generation and verification (Redis-backed)
- `/stripe/products` - Stripe product management
- `/stripe/payment-intents` - Additional payment intent operations
- `/reservations` - Reservation system
- `/reservation-payments` - Reservation payment handling

### Middleware Layers

1. **CORS**: Configured for localhost development and production domains (including iOS `vibesy://` scheme)
2. **Webhook Routes**: Registered BEFORE JSON parsing (need raw body)
3. **JSON Parsing**: `express.json()` with 10mb limit
4. **Request Logging**: `logRequest` middleware logs all requests
5. **Route Handlers**: Business logic in services layer
6. **Error Logging**: `logError` middleware
7. **Error Handler**: `errorHandler` converts errors to JSON responses
8. **404 Handler**: `notFoundHandler` for unknown routes

### Error Handling

- Custom `ApiError` class in `utils/errors.ts`
- Centralized error handling middleware in `middleware/errorHandler.ts`
- Async route handlers wrapped with `asyncHandler` utility to catch promise rejections

### OTP Flow

1. User requests OTP via `POST /otp/send` with email
2. System generates 6-digit code, stores in Redis with 10-minute expiration
3. Email sent via SendGrid
4. User verifies with `POST /otp/verify` providing email and OTP
5. On success, Firebase auth token returned

### Firebase Integration

Firebase Admin SDK (`src/services/adminService.ts`) provides:
- Authentication (`auth()`)
- Firestore (`firestore()`) - used for external event lookups
- Cloud Storage (`storage()`)
- Cloud Messaging (`messaging()`) - for push notifications

Initialized via Application Default Credentials (expects `GOOGLE_APPLICATION_CREDENTIALS` env var or service account key).

## Common Development Patterns

### Adding a New API Endpoint

1. Create/update route file in `src/routes/`
2. Add business logic to appropriate service in `src/services/`
3. Add database queries to `src/database.ts` or create repository
4. Register route in `src/server.ts`
5. Add validation middleware if needed (see `src/middleware/validation.ts`)

### Adding a Database Migration

1. Create new `.sql` file in `migrations/` with naming pattern `NNN_description.sql`
2. Use idempotent SQL patterns with `DO $$ ... END $$` blocks
3. Migration runs automatically on next server startup
4. Tracked in `schema_migrations` table

### Working with Stripe

- Stripe client exported from `src/stripe.ts`
- Use provided utility functions: `getOrCreateCustomer`, `createExpressAccount`, `createPaymentIntentWithDestination`, etc.
- Always verify webhook signatures using `verifyWebhookSignature`
- Platform fee calculated via `calculatePlatformFee` (basis points from env)

### Type Definitions

Core database models defined in `src/database.ts`:
- `User` - buyer/host user records
- `Event` - local event records
- `Order` - ticket purchase records
- `Ticket` - individual ticket records

All models include `created_at` and `updated_at` timestamps maintained by database triggers.

## Environment Configuration

Required environment variables (see `.env.example`):

**Critical**:
- `DATABASE_URL` or `PG_*` variables - PostgreSQL connection
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` - Stripe integration
- `FIREBASE_SERVICE_ACCOUNT_PATH` or `GOOGLE_APPLICATION_CREDENTIALS` - Firebase Admin SDK
- `SENDGRID_API_KEY` - Email delivery
- `REDIS_URL` - OTP storage

**Optional**:
- `PLATFORM_FEE_BASIS_POINTS` (default: 300 = 3%)
- `SERVER_PORT` (default: 4242)
- `ENABLE_EVENT_SYNC` (default: true)

## Important Notes

### Webhook Signature Verification
Webhook routes must be registered BEFORE `express.json()` middleware because Stripe requires the raw request body for signature verification. This pattern is already implemented in `server.ts`.

### External Events Support
The system supports both local PostgreSQL events and external Firestore UUID events. When creating orders/tickets:
- Use `event_id` for local events
- Use `external_event_id` for Firestore events
- Constraint ensures exactly one is set (never both)

### Stripe Connect Account Reuse
The system checks for existing Stripe Connect accounts by email before creating new ones to prevent duplicate accounts.

### Graceful Shutdown
The server handles `SIGTERM` and `SIGINT` signals to:
1. Stop accepting new connections
2. Stop all background jobs
3. Close database connections
4. Exit cleanly

### Database Connection Pooling
PostgreSQL connection pool (max 20 connections) is managed automatically. Use `getDatabase()` to access the pool, not direct connection creation.

### TypeScript Strict Mode
Project uses strict TypeScript settings including `strict`, `noImplicitAny`, `strictNullChecks`, etc. All code must be strongly typed.
