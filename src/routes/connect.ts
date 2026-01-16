import { Router, Request, Response } from 'express';
import { 
  createExpressAccount, 
  createAccountLink, 
  isAccountOnboardingComplete,
  createDashboardLink,
  isStripeError,
  handleStripeError 
} from '../stripe';
import { 
  findUserByEmail, 
  createUser,      
  updateUser,
  findUserByStripeConnectId,
} from '../database';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { validateSchema, connectOnboardSchema } from '../middleware/schemaValidation';
import { ApiError } from '../utils/errors';
import { asyncHandler } from '../utils/asyncHandler';

export const connectRoutes: ReturnType<typeof Router> = Router();

// Helper function to create or retrieve existing Stripe Connect account
async function createOrRetrieveStripeAccount(email: string, userId: number): Promise<string> {
  try {
    // This will now find existing account or create new one
    const stripeAccount = await createExpressAccount(email, 'US');
    const accountId = stripeAccount.id;
    
    // Check if this account is already associated with a different user in our DB
    const existingUser = await findUserByStripeConnectId(accountId);
    
    if (existingUser && existingUser.id !== userId) {
      console.warn(`Found existing account ${accountId} associated with different user ${existingUser.id}. Current user: ${userId}`);
      
      // If the existing user has the same email, update the current user to use this account
      if (existingUser.email?.toLowerCase() === email.toLowerCase()) {
        console.log(`Email matches existing user. Updating current user ${userId} to use existing account ${accountId}`);
        await updateUser(userId, { 
          stripe_connect_id: accountId,
          previous_stripe_connect_id: undefined
        });
        
        // Clear the account from the old user record to avoid conflicts
        await updateUser(existingUser.id, { 
          stripe_connect_id: undefined,
          previous_stripe_connect_id: accountId
        });
      } else {
        throw new Error(`Connect account ${accountId} is already associated with a different email address`);
      }
    } else {
      // Update user with Stripe Connect account ID and clear any previous ID
      await updateUser(userId, { 
        stripe_connect_id: accountId,
        previous_stripe_connect_id: undefined
      });
    }
    
    console.log(`Successfully associated Stripe Connect account: ${accountId} with user: ${userId}`);
    return accountId;
  } catch (error) {
    console.error('Error creating/retrieving Stripe Connect account:', error);
    throw error;
  }
}

// POST /connect/onboard-link
// Create or return existing Connect account onboarding link
connectRoutes.post('/onboard-link', requireAuth, validateSchema(connectOnboardSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { email, first_name, last_name, refresh_url, return_url } = req.body;

  // SECURITY: Verify authenticated user email matches request email
  if (!req.user?.email || email.toLowerCase() !== req.user.email.toLowerCase()) {
    throw new ApiError(403, 'Forbidden', 'Email must match authenticated user');
  }

  const refreshUrl = refresh_url || `${process.env.APP_URL}/connect/refresh`;

  console.log(`Creating Connect onboarding for: ${email}`);

  // Find or create user
  let user = await findUserByEmail(email);
  
  if (!user) {
    // Create new user as host
    user = await createUser({
      email,
      role: 'host',
      first_name,
      last_name,
      firebase_uid: req.user?.uid
    });
    console.log(`Created new host user: ${user.id}`);
  } else if (user.role !== 'host') {
    // Update role to host if needed
    user = await updateUser(user.id, { role: 'host' });
  }

    let stripeAccountId = user.stripe_connect_id;

    // Handle Stripe Connect account creation or reconnection
    if (!stripeAccountId) {
      console.log(`No current Stripe Connect ID found for ${email}`);
      
      // Check if user has a previous Connect account that was disconnected
      const previousAccountId = (user as any).previous_stripe_connect_id;
      
      if (previousAccountId) {
        console.log(`Found previous Stripe Connect account ID: ${previousAccountId}. Checking if it's still valid...`);
        
        try {
          const { stripe } = require('../stripe');
          
          // Try to retrieve the previous account to see if it still exists
          const previousAccount = await stripe.accounts.retrieve(previousAccountId);
          
          if (previousAccount && previousAccount.email?.toLowerCase() === email.toLowerCase()) {
            console.log(`Previous Stripe Connect account is still valid. Reconnecting: ${previousAccountId}`);
            stripeAccountId = previousAccountId;
            
            // Reconnect the existing account and clear the previous_stripe_connect_id
            user = await updateUser(user.id, { 
              stripe_connect_id: stripeAccountId,
              previous_stripe_connect_id: undefined
            });
            
            console.log(`Successfully reconnected existing Stripe Connect account: ${stripeAccountId}`);
          } else {
            console.log(`Previous account exists but email doesn't match. Creating new account.`);
            try {
              stripeAccountId = await createOrRetrieveStripeAccount(email, user.id);
            } catch (createError) {
              console.error('Failed to create new Stripe Connect account:', createError);
              if (isStripeError(createError)) {
                const { message, statusCode } = handleStripeError(createError);
                return res.status(statusCode).json({ error: { message } });
              }
              return res.status(500).json({ error: { message: 'Failed to create Connect account' } });
            }
          }
        } catch (error) {
          console.log(`Previous Stripe Connect account (${previousAccountId}) no longer exists or is invalid. Creating new account.`);
          try {
            stripeAccountId = await createOrRetrieveStripeAccount(email, user.id);
          } catch (createError) {
            console.error('Failed to create new Stripe Connect account:', createError);
            if (isStripeError(createError)) {
              const { message, statusCode } = handleStripeError(createError);
              return res.status(statusCode).json({ error: { message } });
            }
            return res.status(500).json({ error: { message: 'Failed to create Connect account' } });
          }
        }
      } else {
        console.log(`No previous Stripe Connect account found for ${email}. Creating new account.`);
        try {
          stripeAccountId = await createOrRetrieveStripeAccount(email, user.id);
        } catch (createError) {
          console.error('Failed to create new Stripe Connect account:', createError);
          if (isStripeError(createError)) {
            const { message, statusCode } = handleStripeError(createError);
            return res.status(statusCode).json({ error: { message } });
          }
          return res.status(500).json({ error: { message: 'Failed to create Connect account' } });
        }
      }
    } else {
      console.log(`Using existing Stripe Connect account: ${stripeAccountId}`);
    }

    // Check if onboarding is already complete
    const onboardingComplete = await isAccountOnboardingComplete(stripeAccountId!);
    
    if (onboardingComplete) {
      // Update user record if needed
      if (!user.connect_onboarding_complete) {
        await updateUser(user.id, { connect_onboarding_complete: true });
      }
      
      return res.json({
        success: true,
        onboarding_complete: true,
        account_id: stripeAccountId,
        message: 'Account onboarding already complete'
      });
    }

    // Create account link for onboarding
    try {
      // Add account ID to return URL for the app to use
      const returnUrlWithAccount = `${return_url}?account_id=${stripeAccountId}`;
      
      const accountLink = await createAccountLink(
        stripeAccountId!,
        returnUrlWithAccount,
        refreshUrl
      );

      res.json({
        success: true,
        url: accountLink.url,
        account_id: stripeAccountId,
        expires_at: accountLink.expires_at,
        onboarding_complete: false
      });

      console.log(`Generated onboarding link for account: ${stripeAccountId}`);
      return; // Ensure a return after sending response

    } catch (error) {
      console.error('Error creating account link:', error);
      
      if (isStripeError(error)) {
        const { message, statusCode } = handleStripeError(error);
        throw new ApiError(statusCode, 'Stripe Error', message);
      }
      
      throw new ApiError(500, 'Internal Server Error', 'Failed to create onboarding link');
    }
}));

// GET /connect/return
// Handle successful Connect onboarding return
connectRoutes.get('/return', async (req: Request, res: Response) => {
  // Extract account ID from query params if available
  // Stripe doesn't automatically pass account_id, so we might not have it
  // The app will use the user's email to verify completion instead
  const accountId = req.query.account_id as string;
  
  console.log('Return URL query params:', req.query);
  console.log('Account ID from return URL:', accountId);
  
  // Create a success page that redirects to the mobile app
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Vibesy - Setup Complete</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                text-align: center;
                padding: 50px;
                background: #f8f9fa;
            }
            .container {
                max-width: 400px;
                margin: 0 auto;
                background: white;
                padding: 40px;
                border-radius: 12px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            }
            .success { color: #28a745; font-size: 48px; margin-bottom: 20px; }
            h1 { color: #333; margin-bottom: 20px; }
            p { color: #666; margin-bottom: 30px; }
            .btn { 
                background: #007bff; 
                color: white; 
                padding: 12px 24px; 
                border: none; 
                border-radius: 6px; 
                text-decoration: none; 
                display: inline-block;
                font-size: 16px;
            }
        </style>
        <script>
            // Try to open the app after a short delay
            setTimeout(() => {
                window.location.href = 'vibesy://stripe/onboard_complete?success=true${accountId ? `&account_id=${accountId}` : ''}';
            }, 2000);
        </script>
    </head>
    <body>
        <div class="container">
            <div class="success">✅</div>
            <h1>Setup Complete!</h1>
            <p>Your payment setup is now complete. You'll be redirected back to the Vibesy app automatically.</p>
            <a href="vibesy://stripe/onboard_complete?success=true${accountId ? `&account_id=${accountId}` : ''}" class="btn">
                Open Vibesy App
            </a>
        </div>
    </body>
    </html>
  `;
  
  res.send(html);
});

// GET /connect/refresh
// Refresh URL for Connect onboarding (when user needs to restart)
connectRoutes.get('/refresh', async (req: Request, res: Response) => {
  // Create a refresh page that allows restarting onboarding
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Vibesy - Restart Setup</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                text-align: center;
                padding: 50px;
                background: #f8f9fa;
            }
            .container {
                max-width: 400px;
                margin: 0 auto;
                background: white;
                padding: 40px;
                border-radius: 12px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            }
            .warning { color: #ffc107; font-size: 48px; margin-bottom: 20px; }
            h1 { color: #333; margin-bottom: 20px; }
            p { color: #666; margin-bottom: 30px; }
            .btn { 
                background: #007bff; 
                color: white; 
                padding: 12px 24px; 
                border: none; 
                border-radius: 6px; 
                text-decoration: none; 
                display: inline-block;
                font-size: 16px;
            }
        </style>
        <script>
            setTimeout(() => {
                window.location.href = 'vibesy://stripe/onboard_refresh';
            }, 2000);
        </script>
    </head>
    <body>
        <div class="container">
            <div class="warning">⚠️</div>
            <h1>Setup Incomplete</h1>
            <p>Please restart the payment setup process from the Vibesy app.</p>
            <a href="vibesy://stripe/onboard_refresh" class="btn">
                Open Vibesy App
            </a>
        </div>
    </body>
    </html>
  `;
  
  res.send(html);
});

// POST /connect/verify-onboarding
// Verify if a Connect account onboarding is complete
connectRoutes.post('/verify-onboarding', async (req: Request, res: Response) => {
  try {
    const { email, account_id } = req.body;

    let stripeAccountId = account_id;

    // If no account_id provided, look up by email
    if (!stripeAccountId && email) {
      const user = await findUserByEmail(email);
      if (user && user.stripe_connect_id) {
        stripeAccountId = user.stripe_connect_id;
      }
    }

    if (!stripeAccountId) {
      return res.status(400).json({ 
        error: { message: 'account_id or email is required' } 
      });
    }

    // Check onboarding status with Stripe
    const onboardingComplete = await isAccountOnboardingComplete(stripeAccountId);
    
    if (onboardingComplete) {
      // Update user record
      const user = await findUserByStripeConnectId(stripeAccountId);
      if (user && !user.connect_onboarding_complete) {
        await updateUser(user.id, { connect_onboarding_complete: true });
      }
    }

    return res.json({
      success: true,
      account_id: stripeAccountId,
      onboarding_complete: onboardingComplete,
      charges_enabled: onboardingComplete,
      payouts_enabled: onboardingComplete
    });

  } catch (error) {
    console.error('Onboarding verification error:', error);
    
    if (isStripeError(error)) {
      const { message, statusCode } = handleStripeError(error);
      return res.status(statusCode).json({ error: { message } });
    }
    
    return res.status(500).json({ 
      error: { message: 'Internal server error' } 
    });
  }
});

// GET /connect/status/:email
// Get Connect account status for a host
connectRoutes.get('/status/:email', async (req: Request, res: Response) => {
  try {
    const { email } = req.params;
    
    const user = await findUserByEmail(email);
    
    if (!user) {
      return res.status(404).json({ 
        error: { message: 'User not found' } 
      });
    }

    if (!user.stripe_connect_id) {
      return res.json({
        success: true,
        has_connect_account: false,
        onboarding_complete: false
      });
    }

    const onboardingComplete = await isAccountOnboardingComplete(user.stripe_connect_id);

    return res.json({
      success: true,
      has_connect_account: true,
      account_id: user.stripe_connect_id,
      onboarding_complete: onboardingComplete,
      role: user.role
    });

  } catch (error) {
    console.error('Connect status error:', error);
    return res.status(500).json({ 
      error: { message: 'Internal server error' } 
    });
  }
});

// POST /connect/disconnect
// Disconnect Stripe Connect account
connectRoutes.post('/disconnect', requireAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { email } = req.body;
  
  if (!email) {
    throw new ApiError(400, 'Bad Request', 'Email is required');
  }

  // SECURITY: Verify authenticated user email matches request email
  if (!req.user?.email || email.toLowerCase() !== req.user.email.toLowerCase()) {
    throw new ApiError(403, 'Forbidden', 'Email must match authenticated user');
  }
  
  const user = await findUserByEmail(email);
  if (!user) {
    throw new ApiError(404, 'Not Found', 'User not found');
  }
    
    console.log(`Disconnecting Stripe Connect account for user: ${email} (ID: ${user.id})`);
    console.log(`Current user data: role=${user.role}, stripe_connect_id=${user.stripe_connect_id}, onboarding_complete=${user.connect_onboarding_complete}`);
    
    // Store the current Connect ID as previous for potential reconnection
    const previousConnectId = user.stripe_connect_id;
    
    // Update user record to remove Stripe Connect details but store the previous ID
    // Reset role back to 'buyer' (the default) since they're no longer a host
    const updateData = { 
      stripe_connect_id: undefined,
      previous_stripe_connect_id: previousConnectId,
      connect_onboarding_complete: false,
      role: 'buyer' as const
    };
    
    console.log('Updating user with data:', updateData);
    await updateUser(user.id, updateData);
    
  console.log(`Successfully disconnected Stripe Connect account for user: ${email}. Stored previous ID: ${previousConnectId}`);
  
  return res.json({
    success: true,
    message: 'Stripe Connect account disconnected successfully'
  });
}));

// POST /connect/dashboard-link
// Create login link for Stripe Connect dashboard
connectRoutes.post('/dashboard-link', requireAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { email, account_id } = req.body;
  
  if (!email && !account_id) {
    throw new ApiError(400, 'Bad Request', 'Email or account_id is required');
  }

  // SECURITY: Verify authenticated user email matches request email (if provided)
  if (email && req.user?.email && email.toLowerCase() !== req.user.email.toLowerCase()) {
    throw new ApiError(403, 'Forbidden', 'Email must match authenticated user');
  }
  
  let stripeAccountId = account_id;
  
  // If no account_id provided, look up by email
  if (!stripeAccountId && email) {
    const user = await findUserByEmail(email);
    if (!user) {
      throw new ApiError(404, 'Not Found', 'User not found');
    }
    
    if (!user.stripe_connect_id) {
      throw new ApiError(400, 'Bad Request', 'User does not have a Connect account');
    }
    
    stripeAccountId = user.stripe_connect_id;
  }
    
  // Verify the account exists and onboarding is complete
  const onboardingComplete = await isAccountOnboardingComplete(stripeAccountId!);
  
  if (!onboardingComplete) {
    throw new ApiError(400, 'Bad Request', 'Connect account onboarding is not complete');
  }
  
  console.log(`Creating dashboard link for account: ${stripeAccountId}`);
  
  // Create the dashboard login link
  const loginLink = await createDashboardLink(stripeAccountId);
  
  return res.json({
    success: true,
    url: loginLink.url,
    created: loginLink.created
  });
}));
