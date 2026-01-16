import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { adminService } from './services/adminService';
import redisRepository from './repositories/redisRepository';

// Export Firebase Firestore instance
export const firestore = adminService.firestore();

export interface DatabaseConnection {
  query(sql: string, params?: any[]): Promise<any>;
  connect(): Promise<any>;
  close(): Promise<void>;
}

class PostgreSQLConnection implements DatabaseConnection {
  private pool: Pool;

  constructor() {
    // Use DATABASE_URL if available (common in production), otherwise use individual variables
    const config = process.env.DATABASE_URL ? {
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000, // Increased to 10 seconds for cloud databases
    } : {
      host: process.env.PG_HOST || 'localhost',
      port: parseInt(process.env.PG_PORT || '5432'),
      database: process.env.PG_DATABASE || 'vibesy_db',
      user: process.env.PG_USER || 'vibesy_user',
      password: process.env.PG_PASSWORD || 'vibesy_pass',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };
    
    this.pool = new Pool(config);

    // Handle pool errors
    this.pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });
  }

  async query(sql: string, params: any[] = []): Promise<any> {
    const client = await this.pool.connect();
    try {
      return await client.query(sql, params);
    } finally {
      client.release();
    }
  }

  async connect(): Promise<any> {
    return await this.pool.connect();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

let dbConnection: DatabaseConnection | null = null;

export async function initializeDatabase(): Promise<DatabaseConnection> {
  if (dbConnection) {
    return dbConnection;
  }

  console.log(`Connecting to PostgreSQL database...`);
  
  dbConnection = new PostgreSQLConnection();
  
  try {
    // Test the connection
    await dbConnection.query('SELECT NOW()');
    console.log('Database connection established successfully');

    // Initialize schema
    const schemaPath = join(__dirname, '../schema.sql');
    const schema = readFileSync(schemaPath, 'utf8');
    
    // Execute the schema (PostgreSQL can handle multiple statements)
    await dbConnection.query(schema);
    console.log('Database schema initialized successfully');
    
    // Run migrations
    await runMigrations(dbConnection);
    console.log('Database migrations completed successfully');

  } catch (err) {
    console.error('Error connecting to database:', err);
    throw err;
  }

  return dbConnection;
}

// Create migrations tracking table
async function createMigrationsTable(db: DatabaseConnection): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

// Check if migration has been executed
async function isMigrationExecuted(db: DatabaseConnection, filename: string): Promise<boolean> {
  const result = await db.query(
    'SELECT 1 FROM schema_migrations WHERE filename = $1', 
    [filename]
  );
  return result.rows.length > 0;
}

// Mark migration as executed
async function markMigrationExecuted(db: DatabaseConnection, filename: string): Promise<void> {
  await db.query(
    'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING', 
    [filename]
  );
}

// Run database migrations with proper tracking
async function runMigrations(db: DatabaseConnection): Promise<void> {
  try {
    // Create migrations tracking table
    await createMigrationsTable(db);
    
    const migrationsPath = join(__dirname, '../migrations');
    let migrationFiles: string[] = [];
    
    try {
      migrationFiles = readdirSync(migrationsPath)
        .filter(file => file.endsWith('.sql'))
        .sort(); // Run migrations in alphabetical order
    } catch (err) {
      // Migrations directory doesn't exist or is empty
      console.log('No migrations directory found or no migration files');
      return;
    }
    
    if (migrationFiles.length === 0) {
      console.log('No migration files found');
      return;
    }
    
    console.log(`Found ${migrationFiles.length} migration file(s)`);
    
    let executedCount = 0;
    let skippedCount = 0;
    
    for (const file of migrationFiles) {
      // Check if migration has already been executed
      if (await isMigrationExecuted(db, file)) {
        console.log(`Skipping migration (already executed): ${file}`);
        skippedCount++;
        continue;
      }
      
      const migrationPath = join(migrationsPath, file);
      const migration = readFileSync(migrationPath, 'utf8');
      
      console.log(`Running migration: ${file}`);
      
      try {
        await db.query(migration);
        await markMigrationExecuted(db, file);
        console.log(`Completed migration: ${file}`);
        executedCount++;
      } catch (error) {
        console.error(`Failed to execute migration ${file}:`, error);
        
        // For constraint/index conflicts, mark as executed and continue
        if (error instanceof Error && 
            (error.message.includes('already exists') || 
             error.message.includes('duplicate'))) {
          console.log(`Marking migration as completed despite conflict: ${file}`);
          await markMigrationExecuted(db, file);
          skippedCount++;
        } else {
          throw error;
        }
      }
    }
    
    console.log(`Migration summary: ${executedCount} executed, ${skippedCount} skipped`);
    
  } catch (err) {
    console.error('Error running migrations:', err);
    throw err;
  }
}

export function getDatabase(): DatabaseConnection {
  if (!dbConnection) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return dbConnection;
}

/**
 * Close all database connections (PostgreSQL and Redis)
 * Should be called during graceful shutdown
 */
export async function closeDatabase(): Promise<void> {
  console.log('Closing database connections...');
  
  try {
    // Close PostgreSQL connection pool
    if (dbConnection) {
      await dbConnection.close();
      console.log('PostgreSQL connection closed');
      dbConnection = null;
    }
  } catch (error) {
    console.error('Error closing PostgreSQL connection:', error);
  }
  
  try {
    // Close Redis connection
    await redisRepository.disconnect();
    console.log('Redis connection closed');
  } catch (error) {
    console.error('Error closing Redis connection:', error);
  }
}

// Utility functions for common database operations
export async function findUserByEmail(email: string): Promise<User | null> {
  const db = getDatabase();
  const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  return result.rows[0] || null;
}

export async function findUserByStripeCustomerId(customerId: string): Promise<User | null> {
  const db = getDatabase();
  const result = await db.query('SELECT * FROM users WHERE stripe_customer_id = $1', [customerId]);
  return result.rows[0] || null;
}

export async function findUserByStripeConnectId(connectId: string): Promise<User | null> {
  const db = getDatabase();
  const result = await db.query('SELECT * FROM users WHERE stripe_connect_id = $1', [connectId]);
  return result.rows[0] || null;
}

export async function findUsersByEmailCaseInsensitive(email: string): Promise<User[]> {
  const db = getDatabase();
  const result = await db.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  return result.rows;
}

export async function findUsersWithStripeConnectId(connectId: string): Promise<User[]> {
  const db = getDatabase();
  const result = await db.query('SELECT * FROM users WHERE stripe_connect_id = $1', [connectId]);
  return result.rows;
}

export async function findUserById(id: number): Promise<User | null> {
  const db = getDatabase();
  const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function createUser(userData: Partial<User>): Promise<User> {
  const db = getDatabase();
  const {
    email,
    role = 'buyer',
    first_name,
    last_name,
    phone,
    stripe_customer_id,
    stripe_connect_id
  } = userData;

  const result = await db.query(
    `INSERT INTO users (email, role, first_name, last_name, phone, stripe_customer_id, stripe_connect_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [email, role, first_name, last_name, phone, stripe_customer_id, stripe_connect_id]
  );

  return result.rows[0];
}

export async function updateUser(id: number, updates: Partial<User>): Promise<User> {
  const db = getDatabase();
  
  // Filter out undefined values (but allow null values) and id field
  const validUpdates = Object.entries(updates)
    .filter(([key, value]) => key !== 'id' && value !== undefined)
    .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});
  
  const fields = Object.keys(validUpdates);
  
  if (fields.length === 0) {
    // No valid updates, just return the current user
    const existingUser = await findUserById(id);
    if (!existingUser) {
      throw new Error(`User with id ${id} not found`);
    }
    return existingUser;
  }
  
  const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');

  const result = await db.query(
    `UPDATE users SET ${setClause} WHERE id = $1 RETURNING *`,
    [id, ...fields.map(field => (validUpdates as any)[field])]
  );

  if (result.rows.length === 0) {
    throw new Error(`User with id ${id} not found`);
  }

  return result.rows[0];
}

export async function findEventById(id: number): Promise<Event | null> {
  const db = getDatabase();
  const result = await db.query('SELECT * FROM events WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function createOrder(orderData: Partial<Order>): Promise<Order> {
  const db = getDatabase();
  const {
    buyer_id,
    event_id,
    quantity,
    amount_cents,
    platform_fee_cents,
    host_amount_cents,
    currency = 'usd',
    stripe_payment_intent_id,
    buyer_email,
    buyer_name
  } = orderData;

  const result = await db.query(
    `INSERT INTO orders (buyer_id, event_id, quantity, amount_cents, platform_fee_cents, 
                        host_amount_cents, currency, stripe_payment_intent_id, buyer_email, buyer_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [buyer_id, event_id, quantity, amount_cents, platform_fee_cents, host_amount_cents, 
     currency, stripe_payment_intent_id, buyer_email, buyer_name]
  );

  return result.rows[0];
}

export async function updateOrderStatus(paymentIntentId: string, status: string, transferId?: string): Promise<Order | null> {
  const db = getDatabase();
  const result = await db.query(
    `UPDATE orders 
     SET status = $1, stripe_transfer_id = $2, updated_at = CURRENT_TIMESTAMP 
     WHERE stripe_payment_intent_id = $3 
     RETURNING *`,
    [status, transferId, paymentIntentId]
  );

  return result.rows[0] || null;
}

export async function createTickets(orderId: string, eventId: number, quantity: number, holderInfo: { name?: string, email?: string }): Promise<Ticket[]> {
  const db = getDatabase();
  const tickets: Ticket[] = [];

  for (let i = 0; i < quantity; i++) {
    const qrToken = randomBytes(32).toString('hex');
    const ticketNumber = `VBS-${eventId.toString().padStart(3, '0')}-${(i + 1).toString().padStart(3, '0')}`;

    const result = await db.query(
      `INSERT INTO tickets (order_id, event_id, qr_token, ticket_number, holder_name, holder_email)
       VALUES ($1::BIGINT, $2, $3, $4, $5, $6)
       RETURNING *`,
      [orderId, eventId, qrToken, ticketNumber, holderInfo.name, holderInfo.email]
    );

    tickets.push(result.rows[0]);
  }

  return tickets;
}

export async function createTicketsForExternalEvent(orderId: string, externalEventId: string, quantity: number, holderInfo: { name?: string, email?: string }): Promise<Ticket[]> {
  const db = getDatabase();
  const tickets: Ticket[] = [];

  for (let i = 0; i < quantity; i++) {
    const qrToken = `${orderId}-${i + 1}-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    const ticketNumber = `VBS-${orderId.toString().padStart(6, '0')}-${(i + 1).toString().padStart(3, '0')}`;

    const result = await db.query(
      `INSERT INTO tickets (order_id, external_event_id, qr_token, ticket_number, holder_name, holder_email)
       VALUES ($1::BIGINT, $2, $3, $4, $5, $6)
       RETURNING *`,
      [orderId, externalEventId, qrToken, ticketNumber, holderInfo.name, holderInfo.email]
    );

    tickets.push(result.rows[0]);
  }

  return tickets;
}

export async function findTicketByQRToken(qrToken: string): Promise<(Ticket & { event: Event }) | null> {
  const db = getDatabase();
  const result = await db.query(
    `SELECT t.*, e.title as event_title, e.venue, e.starts_at, e.host_id
     FROM tickets t
     JOIN events e ON t.event_id = e.id
     WHERE t.qr_token = $1`,
    [qrToken]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    ...row,
    event: {
      id: row.event_id,
      title: row.event_title,
      venue: row.venue,
      starts_at: row.starts_at,
      host_id: row.host_id
    }
  } as Ticket & { event: Event };
}

export async function updateTicketStatus(qrToken: string, status: string, scannedByUserId?: number): Promise<Ticket | null> {
  const db = getDatabase();
  const result = await db.query(
    `UPDATE tickets 
     SET status = $1, scanned_at = CASE WHEN $1 = 'used' THEN CURRENT_TIMESTAMP ELSE scanned_at END,
         scanned_by_user_id = $2, updated_at = CURRENT_TIMESTAMP
     WHERE qr_token = $3 
     RETURNING *`,
    [status, scannedByUserId, qrToken]
  );

  return result.rows[0] || null;
}

// Database models/interfaces
export interface User {
  id: number;
  email: string;
  role: 'buyer' | 'host' | 'admin';
  first_name?: string;
  last_name?: string;
  phone?: string;
  firebase_uid?: string;
  stripe_customer_id?: string;
  stripe_connect_id?: string;
  previous_stripe_connect_id?: string;
  connect_onboarding_complete: boolean;
  created_at: string;
  updated_at: string;
}

export interface Event {
  id: number;
  host_id: number;
  title: string;
  description?: string;
  venue: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  country: string;
  starts_at: string;
  ends_at?: string;
  price_cents: number;
  currency: string;
  capacity: number;
  tickets_sold: number;
  status: 'active' | 'paused' | 'cancelled' | 'completed';
  image_url?: string;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  buyer_id: number;
  event_id?: number; // Optional for external events
  external_event_id?: string; // For UUID events from Firestore
  external_event_title?: string; // Display title for external events
  quantity: number;
  amount_cents: number;
  platform_fee_cents: number;
  host_amount_cents: number;
  currency: string;
  stripe_payment_intent_id?: string;
  stripe_transfer_id?: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  buyer_email?: string;
  buyer_name?: string;
  created_at: string;
  updated_at: string;
}

export interface Ticket {
  id: number;
  order_id: string;
  event_id?: number; // Optional for external events
  external_event_id?: string; // For UUID events from Firestore
  qr_token: string;
  ticket_number?: string;
  holder_name?: string;
  holder_email?: string;
  status: 'valid' | 'used' | 'cancelled' | 'refunded';
  scanned_at?: string;
  scanned_by_user_id?: number;
  created_at: string;
  updated_at: string;
}
