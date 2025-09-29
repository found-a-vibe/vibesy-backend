#!/usr/bin/env ts-node

/**
 * Utility script to audit and clean up duplicate Stripe Connect accounts
 * Run this script to identify and resolve duplicate Connect accounts
 */

// Load environment variables first
import { config } from 'dotenv';
if (process.env.NODE_ENV !== 'production') {
  config();
}

import { stripe } from '../stripe';
import { initializeDatabase, findUsersWithStripeConnectId, User } from '../database';

interface DuplicateAccountInfo {
  email: string;
  stripeAccountId: string;
  databaseUsers: User[];
  stripeAccount: any;
}

export async function auditConnectAccounts(): Promise<DuplicateAccountInfo[]> {
  console.log('🔍 Starting Stripe Connect account audit...\n');
  
  const duplicates: DuplicateAccountInfo[] = [];
  const emailMap = new Map<string, string[]>();
  
  try {
    // Fetch all Connect accounts from Stripe
    let hasMore = true;
    let startingAfter: string | undefined;
    let totalAccounts = 0;
    
    while (hasMore) {
      const accounts = await stripe.accounts.list({
        limit: 100,
        starting_after: startingAfter,
      });
      
      for (const account of accounts.data) {
        if (account.type === 'express' && account.email && account.metadata?.created_by === 'vibesy_app') {
          totalAccounts++;
          const email = account.email.toLowerCase();
          
          if (!emailMap.has(email)) {
            emailMap.set(email, []);
          }
          emailMap.get(email)!.push(account.id);
        }
      }
      
      hasMore = accounts.has_more;
      if (hasMore && accounts.data.length > 0) {
        startingAfter = accounts.data[accounts.data.length - 1].id;
      }
    }
    
    console.log(`Found ${totalAccounts} Vibesy Connect accounts in Stripe`);
    
    // Check for email duplicates
    const emailDuplicates = Array.from(emailMap.entries()).filter(([email, accountIds]) => accountIds.length > 1);
    
    if (emailDuplicates.length === 0) {
      console.log('✅ No email duplicates found in Stripe Connect accounts');
    } else {
      console.log(`⚠️  Found ${emailDuplicates.length} emails with multiple Connect accounts:\n`);
      
      for (const [email, accountIds] of emailDuplicates) {
        console.log(`📧 ${email}: ${accountIds.length} accounts`);
        accountIds.forEach((id, index) => console.log(`   ${index + 1}. ${id}`));
        
        // Check database associations
        const databaseUsers: User[] = [];
        for (const accountId of accountIds) {
          const users = await findUsersWithStripeConnectId(accountId);
          databaseUsers.push(...users);
        }
        
        // Get the first account details for reference
        const stripeAccount = await stripe.accounts.retrieve(accountIds[0]);
        
        duplicates.push({
          email,
          stripeAccountId: accountIds[0], // We'll use the first one as primary
          databaseUsers,
          stripeAccount
        });
        
        console.log(`   Database users associated: ${databaseUsers.length}`);
        console.log();
      }
    }
    
    return duplicates;
    
  } catch (error) {
    console.error('❌ Error during audit:', error);
    throw error;
  }
}

export async function generateCleanupReport(): Promise<void> {
  try {
    const duplicates = await auditConnectAccounts();
    
    if (duplicates.length === 0) {
      console.log('🎉 No duplicates found! Your Stripe Connect accounts are clean.');
      return;
    }
    
    console.log('📊 CLEANUP RECOMMENDATIONS:\n');
    console.log('=' + '='.repeat(50));
    
    for (const duplicate of duplicates) {
      console.log(`\n📧 Email: ${duplicate.email}`);
      console.log(`🎯 Primary Account: ${duplicate.stripeAccountId}`);
      console.log(`👥 Database Users: ${duplicate.databaseUsers.length}`);
      
      if (duplicate.databaseUsers.length === 0) {
        console.log('⚠️  No database users associated - these may be orphaned accounts');
      } else if (duplicate.databaseUsers.length === 1) {
        console.log(`✅ Single database user (${duplicate.databaseUsers[0].id}) - should consolidate to primary account`);
      } else {
        console.log(`⚠️  Multiple database users - manual review needed:`);
        duplicate.databaseUsers.forEach(user => {
          console.log(`    User ${user.id}: ${user.email} (${user.role})`);
        });
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('Next steps:');
    console.log('1. Review the duplicates above');
    console.log('2. Run the database migration to add unique constraints');
    console.log('3. The new logic will automatically prevent future duplicates');
    console.log('4. Manually consolidate any remaining duplicates if needed');
    
  } catch (error) {
    console.error('❌ Error generating report:', error);
  }
}

// Run audit if this file is executed directly
if (require.main === module) {
  (async () => {
    try {
      console.log('Initializing database connection...');
      await initializeDatabase();
      await generateCleanupReport();
    } catch (error) {
      console.error('Script failed:', error);
      process.exit(1);
    }
  })();
}
