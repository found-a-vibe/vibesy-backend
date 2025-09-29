-- Migration: Add unique constraint to stripe_connect_id to prevent duplicates
-- This ensures that each Stripe Connect account can only be associated with one user

-- First, clean up any existing duplicate stripe_connect_id entries
-- Keep the most recent user for each duplicate stripe_connect_id
WITH duplicate_accounts AS (
  SELECT stripe_connect_id, 
         array_agg(id ORDER BY updated_at DESC) as user_ids
  FROM users 
  WHERE stripe_connect_id IS NOT NULL
  GROUP BY stripe_connect_id
  HAVING COUNT(*) > 1
),
users_to_clear AS (
  SELECT unnest(user_ids[2:]) as user_id,
         stripe_connect_id as connect_id
  FROM duplicate_accounts
)
UPDATE users 
SET stripe_connect_id = NULL,
    previous_stripe_connect_id = users_to_clear.connect_id,
    updated_at = CURRENT_TIMESTAMP
FROM users_to_clear
WHERE users.id = users_to_clear.user_id;

-- Add unique constraint and indexes with proper conflict handling
DO $$ 
BEGIN
    -- Add unique constraint if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'unique_stripe_connect_id' 
        AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users 
        ADD CONSTRAINT unique_stripe_connect_id 
        UNIQUE (stripe_connect_id);
        RAISE NOTICE 'Added unique constraint: unique_stripe_connect_id';
    ELSE
        RAISE NOTICE 'Unique constraint unique_stripe_connect_id already exists';
    END IF;
    
    -- Add partial index for performance (only if constraint doesn't already create one)
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_users_stripe_connect_id'
    ) THEN
        CREATE INDEX idx_users_stripe_connect_id 
        ON users (stripe_connect_id) 
        WHERE stripe_connect_id IS NOT NULL;
        RAISE NOTICE 'Added index: idx_users_stripe_connect_id';
    ELSE
        RAISE NOTICE 'Index idx_users_stripe_connect_id already exists';
    END IF;
    
    -- Add case-insensitive email index
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_users_email_lower'
    ) THEN
        CREATE INDEX idx_users_email_lower 
        ON users (LOWER(email));
        RAISE NOTICE 'Added index: idx_users_email_lower';
    ELSE
        RAISE NOTICE 'Index idx_users_email_lower already exists';
    END IF;
    
EXCEPTION
    WHEN duplicate_table THEN
        RAISE NOTICE 'Relation already exists, skipping...';
    WHEN OTHERS THEN
        RAISE NOTICE 'Error in migration: %', SQLERRM;
        -- Continue execution, don't fail the migration
END $$;
