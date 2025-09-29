-- Vibesy Ticketing Database Schema
-- PostgreSQL version

-- Users table - handles both hosts and buyers
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    role VARCHAR(20) NOT NULL DEFAULT 'buyer', -- 'buyer', 'host', 'admin'
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(20),
    stripe_customer_id VARCHAR(100), -- For buyers
    stripe_connect_id VARCHAR(100), -- For hosts (Stripe Express accounts)
    previous_stripe_connect_id VARCHAR(100), -- Store previous Connect ID when disconnected
    connect_onboarding_complete BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Events table - physical events created by hosts
CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    host_id INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    venue VARCHAR(255) NOT NULL,
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(50),
    zip_code VARCHAR(20),
    country VARCHAR(2) DEFAULT 'US',
    starts_at TIMESTAMP NOT NULL,
    ends_at TIMESTAMP,
    price_cents INTEGER NOT NULL, -- Price in cents (e.g., 2500 = $25.00)
    currency VARCHAR(3) DEFAULT 'usd',
    capacity INTEGER DEFAULT 100,
    tickets_sold INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'paused', 'cancelled', 'completed'
    image_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Orders table - ticket purchase orders
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    buyer_id INTEGER NOT NULL,
    event_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    amount_cents INTEGER NOT NULL, -- Total amount charged to buyer
    platform_fee_cents INTEGER NOT NULL, -- Platform fee (deducted from host)
    host_amount_cents INTEGER NOT NULL, -- Amount that goes to host
    currency VARCHAR(3) DEFAULT 'usd',
    stripe_payment_intent_id VARCHAR(100) UNIQUE,
    stripe_transfer_id VARCHAR(100), -- Transfer to host's Connect account
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'completed', 'failed', 'refunded'
    buyer_email VARCHAR(255),
    buyer_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- Tickets table - individual tickets for verification
CREATE TABLE IF NOT EXISTS tickets (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL,
    event_id INTEGER NOT NULL,
    qr_token VARCHAR(255) NOT NULL UNIQUE, -- Unique token for QR code
    ticket_number VARCHAR(50), -- Human-readable ticket number (e.g., "VBS-001-001")
    holder_name VARCHAR(255),
    holder_email VARCHAR(255),
    status VARCHAR(20) DEFAULT 'valid', -- 'valid', 'used', 'cancelled', 'refunded'
    scanned_at TIMESTAMP NULL,
    scanned_by_user_id INTEGER NULL, -- Who scanned the ticket
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (scanned_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_stripe_connect ON users(stripe_connect_id);
CREATE INDEX IF NOT EXISTS idx_events_host ON events(host_id);
CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events(starts_at);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_event ON orders(event_id);
CREATE INDEX IF NOT EXISTS idx_orders_stripe_pi ON orders(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_tickets_order ON tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_tickets_event ON tickets(event_id);
CREATE INDEX IF NOT EXISTS idx_tickets_qr_token ON tickets(qr_token);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);

-- Function to update updated_at timestamp (PostgreSQL)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to update updated_at timestamps (PostgreSQL)
-- Drop triggers if they exist and recreate them
DROP TRIGGER IF EXISTS update_users_timestamp ON users;
CREATE TRIGGER update_users_timestamp 
    BEFORE UPDATE ON users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_events_timestamp ON events;
CREATE TRIGGER update_events_timestamp 
    BEFORE UPDATE ON events 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_orders_timestamp ON orders;
CREATE TRIGGER update_orders_timestamp 
    BEFORE UPDATE ON orders 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_tickets_timestamp ON tickets;
CREATE TRIGGER update_tickets_timestamp 
    BEFORE UPDATE ON tickets 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
