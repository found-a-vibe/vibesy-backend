-- Migration: Support external UUID events
-- This migration adds support for orders from external events (like Firestore UUID events)
-- that don't exist in the local PostgreSQL events table

-- Add external_event_id field to orders table (if it doesn't exist)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='external_event_id') THEN
        ALTER TABLE orders ADD COLUMN external_event_id VARCHAR(255);
    END IF;
END $$;

-- Add external_event_title field for display purposes (if it doesn't exist)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='external_event_title') THEN
        ALTER TABLE orders ADD COLUMN external_event_title VARCHAR(255);
    END IF;
END $$;

-- Make event_id nullable (for external events) if it's currently NOT NULL
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='event_id' AND is_nullable='NO') THEN
        ALTER TABLE orders ALTER COLUMN event_id DROP NOT NULL;
    END IF;
END $$;

-- Drop the existing foreign key constraint on event_id if it exists
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='orders_event_id_fkey' AND table_name='orders') THEN
        ALTER TABLE orders DROP CONSTRAINT orders_event_id_fkey;
    END IF;
END $$;

-- Add a new foreign key constraint that only applies when event_id is not NULL
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='orders_event_id_fkey' AND table_name='orders') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_event_id_fkey 
            FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Add similar changes to tickets table
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='external_event_id') THEN
        ALTER TABLE tickets ADD COLUMN external_event_id VARCHAR(255);
    END IF;
END $$;

DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='event_id' AND is_nullable='NO') THEN
        ALTER TABLE tickets ALTER COLUMN event_id DROP NOT NULL;
    END IF;
END $$;

DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='tickets_event_id_fkey' AND table_name='tickets') THEN
        ALTER TABLE tickets DROP CONSTRAINT tickets_event_id_fkey;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='tickets_event_id_fkey' AND table_name='tickets') THEN
        ALTER TABLE tickets ADD CONSTRAINT tickets_event_id_fkey 
            FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Add indexes for the new external event fields
CREATE INDEX IF NOT EXISTS idx_orders_external_event ON orders(external_event_id);
CREATE INDEX IF NOT EXISTS idx_tickets_external_event ON tickets(external_event_id);

-- Add a check constraint to ensure either event_id or external_event_id is provided
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='orders_event_check' AND table_name='orders') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_event_check 
            CHECK ((event_id IS NOT NULL AND external_event_id IS NULL) OR 
                   (event_id IS NULL AND external_event_id IS NOT NULL));
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='tickets_event_check' AND table_name='tickets') THEN
        ALTER TABLE tickets ADD CONSTRAINT tickets_event_check 
            CHECK ((event_id IS NOT NULL AND external_event_id IS NULL) OR 
                   (event_id IS NULL AND external_event_id IS NOT NULL));
    END IF;
END $$;
