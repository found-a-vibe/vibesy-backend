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

-- Now add the unique constraint
ALTER TABLE users 
ADD CONSTRAINT unique_stripe_connect_id 
UNIQUE (stripe_connect_id);

-- Add partial index for better performance on Connect ID lookups
CREATE INDEX IF NOT EXISTS idx_users_stripe_connect_id 
ON users (stripe_connect_id) 
WHERE stripe_connect_id IS NOT NULL;

-- Add index for case-insensitive email lookups
CREATE INDEX IF NOT EXISTS idx_users_email_lower 
ON users (LOWER(email));
