-- Script to empty all tables in the Vibesy database
-- This will remove all data but keep the table structure and constraints

-- Disable foreign key checks temporarily to avoid constraint issues
SET session_replication_role = replica;

-- Truncate all tables in the correct order (respecting foreign key dependencies)
-- Start with dependent tables first, then parent tables

-- Tickets table (depends on orders and events)
TRUNCATE TABLE tickets RESTART IDENTITY CASCADE;

-- Orders table (depends on users and events)
TRUNCATE TABLE orders RESTART IDENTITY CASCADE;

-- Events table (depends on users)
TRUNCATE TABLE events RESTART IDENTITY CASCADE;

-- Users table (base table)
TRUNCATE TABLE users RESTART IDENTITY CASCADE;

-- Re-enable foreign key checks
SET session_replication_role = DEFAULT;

-- Optional: Reset sequences to start from 1
SELECT setval(pg_get_serial_sequence('users', 'id'), 1, false);
SELECT setval(pg_get_serial_sequence('events', 'id'), 1, false);
SELECT setval(pg_get_serial_sequence('orders', 'id'), 1, false);
SELECT setval(pg_get_serial_sequence('tickets', 'id'), 1, false);

-- Display confirmation
SELECT 
    'users' as table_name, 
    COUNT(*) as row_count 
FROM users
UNION ALL
SELECT 
    'events' as table_name, 
    COUNT(*) as row_count 
FROM events
UNION ALL
SELECT 
    'orders' as table_name, 
    COUNT(*) as row_count 
FROM orders
UNION ALL
SELECT 
    'tickets' as table_name, 
    COUNT(*) as row_count 
FROM tickets;