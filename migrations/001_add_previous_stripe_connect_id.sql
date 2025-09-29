-- Migration: Add previous_stripe_connect_id column to users table
-- This allows us to track previously disconnected Stripe accounts for reconnection

ALTER TABLE users ADD COLUMN IF NOT EXISTS previous_stripe_connect_id VARCHAR(100);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_users_previous_stripe_connect ON users(previous_stripe_connect_id);