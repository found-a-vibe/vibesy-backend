# Database Scripts

This directory contains utility scripts for managing the Vibesy PostgreSQL database.

## Scripts

### 🗑️ `reset-database.js`
Empties all tables in the database while preserving the schema structure.

**Usage:**
```bash
# Interactive mode (will ask for confirmation)
node scripts/reset-database.js

# Or using npm script
npm run db:reset
```

**What it does:**
- Truncates all tables: `users`, `events`, `orders`, `tickets`
- Resets auto-increment sequences to start from 1
- Preserves table structure, indexes, constraints, and triggers
- Provides confirmation before executing
- Shows row counts after completion

**⚠️ Warning:** This will permanently delete ALL DATA in your database!

### 📋 `reset-database.sql`
The raw SQL script used by the Node.js reset script.

**Usage:**
```bash
# Direct PostgreSQL execution
psql -d vibesy_db -f scripts/reset-database.sql
```

## Environment Variables

These scripts use the same environment variables as your main application:

- `PG_HOST` - PostgreSQL host (default: localhost)
- `PG_PORT` - PostgreSQL port (default: 5432)
- `PG_DATABASE` - Database name (default: vibesy_db)
- `PG_USER` - Database user (default: vibesy_user)
- `PG_PASSWORD` - Database password (default: vibesy_pass)

## Safety Features

- **Confirmation prompt**: Interactive confirmation before executing
- **Foreign key handling**: Temporarily disables foreign key checks during truncation
- **Order awareness**: Truncates tables in correct dependency order
- **Schema preservation**: Only removes data, keeps all structure
- **Verification**: Shows table counts after completion

## When to Use

- Starting fresh development
- Clearing test data
- Resetting after data corruption
- Before major schema changes (after backup)

## When NOT to Use

- On production databases
- When you need to preserve any data
- Without proper backups in place