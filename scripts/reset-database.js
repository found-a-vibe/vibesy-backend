#!/usr/bin/env node

/**
 * Database Reset Script
 * Empties all tables in the PostgreSQL database while preserving schema
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DATABASE || 'vibesy_db',
  user: process.env.PG_USER || 'vibesy_user',
  password: process.env.PG_PASSWORD || 'vibesy_pass',
});

async function resetDatabase() {
  console.log('🗑️  Starting database reset...\n');
  
  try {
    // Read the SQL reset script
    const resetSQL = fs.readFileSync(path.join(__dirname, 'reset-database.sql'), 'utf8');
    
    // Execute the reset script
    console.log('📋 Executing database reset script...');
    const result = await pool.query(resetSQL);
    
    // Show the confirmation results (row counts)
    if (result && result.length > 0) {
      const lastResult = result[result.length - 1];
      if (lastResult.rows) {
        console.log('\n✅ Database reset complete! Current table counts:');
        console.log('==================================================');
        lastResult.rows.forEach(row => {
          console.log(`📊 ${row.table_name}: ${row.row_count} rows`);
        });
      }
    }
    
    console.log('\n🎉 All tables have been emptied successfully!');
    console.log('📝 Note: Table structure, indexes, and constraints are preserved');
    
  } catch (error) {
    console.error('❌ Error resetting database:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

async function confirmReset() {
  return new Promise((resolve) => {
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    readline.question('⚠️  This will DELETE ALL DATA in your PostgreSQL database. Are you sure? (yes/no): ', (answer) => {
      readline.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

async function main() {
  try {
    console.log('🔥 Vibesy Database Reset Tool');
    console.log('=============================\n');
    
    // Show database connection info
    console.log('📡 Database connection:');
    console.log(`   Host: ${process.env.PG_HOST || 'localhost'}`);
    console.log(`   Database: ${process.env.PG_DATABASE || 'vibesy_db'}`);
    console.log(`   User: ${process.env.PG_USER || 'vibesy_user'}\n`);
    
    // Confirm the action
    const confirmed = await confirmReset();
    
    if (!confirmed) {
      console.log('❌ Database reset cancelled.');
      return;
    }
    
    await resetDatabase();
    
  } catch (error) {
    console.error('💥 Script failed:', error);
    process.exit(1);
  }
}

// Run the script if called directly
if (require.main === module) {
  main();
}

module.exports = { resetDatabase };