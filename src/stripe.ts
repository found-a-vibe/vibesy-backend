import Stripe from 'stripe';

// Initialize Stripe with secret key
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia',
  typescript: true,
});

// Get platform fee in cents based on amount and basis points
export function calculatePlatformFee(amountCents: number): number {
  const basisPoints = parseInt(process.env.PLATFORM_FEE_BASIS_POINTS || '300'); // Default 3%
  return Math.round((amountCents * basisPoints) / 10000);
}

// Create or retrieve Stripe Customer for a user
export async function getOrCreateCustomer(email: string, name?: string): Promise<Stripe.Customer> {
  // First, try to find existing customer by email
  const existingCustomers = await stripe.customers.list({
    email: email,
    limit: 1,
  });

  if (existingCustomers.data.length > 0) {
    return existingCustomers.data[0];
  }

  // Create new customer
  return await stripe.customers.create({
    email: email,
    name: name,
    metadata: {
      created_by: 'vibesy_app'
    }
  });
}

// Find existing Stripe Express Connect account by email
export async function findExistingExpressAccount(email: string): Promise<Stripe.Account | null> {
  try {
    // Search for existing accounts with the same email
    const accounts = await stripe.accounts.list({
      limit: 10, // Search through recent accounts
    });
    
    // Filter for accounts with matching email (case-insensitive)
    const existingAccount = accounts.data.find(account => 
      account.email && account.email.toLowerCase() === email.toLowerCase() &&
      account.type === 'express' &&
      account.metadata?.created_by === 'vibesy_app'
    );
    
    return existingAccount || null;
  } catch (error) {
    console.error('Error searching for existing Connect accounts:', error);
    return null;
  }
}

// Create or retrieve existing Stripe Express Connect account for host
export async function createExpressAccount(email: string, country: string = 'US'): Promise<Stripe.Account> {
  // First, check if an account already exists for this email
  const existingAccount = await findExistingExpressAccount(email);
  
  if (existingAccount) {
    console.log(`Found existing Stripe Connect account for ${email}: ${existingAccount.id}`);
    return existingAccount;
  }
  
  // Create new account if none exists
  console.log(`Creating new Stripe Connect account for ${email}`);
  return await stripe.accounts.create({
    type: 'express',
    country: country,
    email: email,
    capabilities: {
      transfers: { requested: true },
    },
    business_type: 'individual',
    metadata: {
      created_by: 'vibesy_app'
    }
  });
}

// Create account link for Express onboarding
export async function createAccountLink(accountId: string, returnUrl: string, refreshUrl: string): Promise<Stripe.AccountLink> {
  return await stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  });
}

// Check if Connect account onboarding is complete
export async function isAccountOnboardingComplete(accountId: string): Promise<boolean> {
  try {
    const account = await stripe.accounts.retrieve(accountId);
    return account.details_submitted && account.charges_enabled && account.payouts_enabled;
  } catch (error) {
    console.error('Error checking account onboarding status:', error);
    return false;
  }
}

// Create login link for Connect dashboard access
export async function createDashboardLink(accountId: string): Promise<Stripe.LoginLink> {
  return await stripe.accounts.createLoginLink(accountId);
}

// Create PaymentIntent with destination charge for Connect
export async function createPaymentIntentWithDestination(params: {
  amount: number;
  currency: string;
  destinationAccountId: string;
  platformFeeAmount: number;
  customerId?: string;
  metadata?: Record<string, string>;
}): Promise<Stripe.PaymentIntent> {
  const {
    amount,
    currency,
    destinationAccountId,
    platformFeeAmount,
    customerId,
    metadata = {}
  } = params;

  const paymentIntentParams: Stripe.PaymentIntentCreateParams = {
    amount: amount,
    currency: currency,
    automatic_payment_methods: {
      enabled: true,
    },
    transfer_data: {
      destination: destinationAccountId,
    },
    application_fee_amount: platformFeeAmount,
    metadata: {
      ...metadata,
      platform: 'vibesy',
    }
  };

  if (customerId) {
    paymentIntentParams.customer = customerId;
  }

  return await stripe.paymentIntents.create(paymentIntentParams);
}

// Create ephemeral key for customer (needed for PaymentSheet)
export async function createEphemeralKey(customerId: string): Promise<Stripe.EphemeralKey> {
  return await stripe.ephemeralKeys.create(
    { customer: customerId },
    { apiVersion: '2024-09-30.acacia' }
  );
}

// Verify webhook signature
export function verifyWebhookSignature(payload: string, signature: string): Stripe.Event {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;
  
  try {
    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (error) {
    console.error('Webhook signature verification failed:', error);
    throw new Error('Invalid webhook signature');
  }
}

// Handle refunds (for cancellations)
export async function refundPayment(paymentIntentId: string, amount?: number): Promise<Stripe.Refund> {
  const refundParams: Stripe.RefundCreateParams = {
    payment_intent: paymentIntentId,
  };

  if (amount) {
    refundParams.amount = amount;
  }

  return await stripe.refunds.create(refundParams);
}

// Get Connect account balance
export async function getConnectAccountBalance(accountId: string): Promise<Stripe.Balance> {
  return await stripe.balance.retrieve({
    stripeAccount: accountId,
  });
}

// Create manual payout (if needed)
export async function createPayout(accountId: string, amount: number, currency: string = 'usd'): Promise<Stripe.Payout> {
  return await stripe.payouts.create({
    amount: amount,
    currency: currency,
  }, {
    stripeAccount: accountId,
  });
}

// Utility to format currency amounts
export function formatCurrency(amountCents: number, currency: string = 'usd'): string {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  });
  
  return formatter.format(amountCents / 100);
}

// Validate webhook event types we care about
export const SUPPORTED_WEBHOOK_EVENTS = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'account.updated',
  'payment_intent.requires_action',
] as const;

export type SupportedWebhookEvent = typeof SUPPORTED_WEBHOOK_EVENTS[number];

export function isSupportedWebhookEvent(eventType: string): eventType is SupportedWebhookEvent {
  return SUPPORTED_WEBHOOK_EVENTS.includes(eventType as SupportedWebhookEvent);
}

// Error handling utilities
export function isStripeError(error: any): error is Stripe.errors.StripeError {
  return error && error.type && error.type.startsWith('Stripe');
}

export function handleStripeError(error: Stripe.errors.StripeError): { message: string; code?: string; statusCode: number } {
  switch (error.type) {
    case 'StripeCardError':
      return {
        message: error.message || 'Your card was declined.',
        code: error.code,
        statusCode: 400
      };
    case 'StripeRateLimitError':
      return {
        message: 'Too many requests made to the API too quickly',
        statusCode: 429
      };
    case 'StripeInvalidRequestError':
      return {
        message: error.message || 'Invalid request parameters',
        statusCode: 400
      };
    case 'StripeAPIError':
      return {
        message: 'An error occurred with our API',
        statusCode: 500
      };
    case 'StripeConnectionError':
      return {
        message: 'Connection error with Stripe',
        statusCode: 500
      };
    case 'StripeAuthenticationError':
      return {
        message: 'Authentication with Stripe API failed',
        statusCode: 401
      };
    default:
      return {
        message: 'An unexpected error occurred',
        statusCode: 500
      };
  }
}