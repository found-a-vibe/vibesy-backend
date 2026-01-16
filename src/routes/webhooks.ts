import { Router, Request, Response } from 'express';
import express from 'express';
import { 
  verifyWebhookSignature,
  isSupportedWebhookEvent,
  SupportedWebhookEvent
} from '../stripe';
import { 
  updateOrderStatus,
  createTickets,
  createTicketsForExternalEvent,
  getDatabase
} from '../database';

export const webhookRoutes: ReturnType<typeof Router> = Router();

// Raw body parser for webhook signature verification
webhookRoutes.use('/stripe', express.raw({ type: 'application/json' }));

// POST /webhooks/stripe
// Handle Stripe webhook events
webhookRoutes.post('/stripe', async (req: Request, res: Response) => {
  const signature = req.headers['stripe-signature'] as string;

  if (!signature) {
    console.error('Missing Stripe signature header');
    return res.status(400).json({ error: 'Missing Stripe signature' });
  }

  try {
    // Verify webhook signature and parse event
    const event = verifyWebhookSignature(req.body.toString(), signature);
    
    console.log(`📧 Received webhook: ${event.type} (${event.id})`);

    // Check if we handle this event type
    if (!isSupportedWebhookEvent(event.type)) {
      console.log(`⚠️ Unhandled webhook event type: ${event.type}`);
      return res.status(200).json({ received: true, handled: false });
    }

    // Handle the event
    await handleWebhookEvent(event.type, event);

    return res.status(200).json({ received: true, handled: true });

  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(400).json({ error: 'Webhook processing failed' });
  }
});

// Handle different webhook event types
async function handleWebhookEvent(eventType: SupportedWebhookEvent, event: any) {
  switch (eventType) {
    case 'payment_intent.succeeded':
      await handlePaymentSucceeded(event);
      break;

    case 'payment_intent.payment_failed':
      await handlePaymentFailed(event);
      break;

    case 'payment_intent.requires_action':
      await handlePaymentRequiresAction(event);
      break;

    case 'account.updated':
      await handleAccountUpdated(event);
      break;

    default:
      console.log(`No handler for event type: ${eventType}`);
  }
}

// Handle successful payment
async function handlePaymentSucceeded(event: any) {
  const paymentIntent = event.data.object;
  const paymentIntentId = paymentIntent.id;

  console.log(`💳 Payment succeeded: ${paymentIntentId}`);

  try {
    // RACE CONDITION FIX: Use transaction to prevent duplicate ticket creation
    const db = getDatabase();
    const client = await db.connect();
    
    try {
      await client.query('BEGIN');

      // Lock the order row to prevent concurrent ticket creation
      const orderResult = await client.query(
        'SELECT * FROM orders WHERE stripe_payment_intent_id = $1 FOR UPDATE',
        [paymentIntentId]
      );

      if (orderResult.rows.length === 0) {
        await client.query('ROLLBACK');
        console.error(`Order not found for payment intent: ${paymentIntentId}`);
        return;
      }

      const order = orderResult.rows[0];

      // Update order status to completed if not already
      if (order.status !== 'completed') {
        await client.query(
          'UPDATE orders SET status = $1, stripe_charge_id = $2, updated_at = NOW() WHERE id = $3',
          ['completed', paymentIntent.latest_charge, order.id]
        );
        console.log(`📝 Updated order ${order.id} to completed status`);
      }

      // Check if tickets already exist for this order to avoid duplicates
      const existingTicketsResult = await client.query(
        'SELECT COUNT(*) as count FROM tickets WHERE order_id = $1',
        [order.id]
      );
      
      const existingTicketCount = parseInt(existingTicketsResult.rows[0].count);
      
      if (existingTicketCount > 0) {
        console.log(`🎫 Order ${order.id} already has ${existingTicketCount} tickets, skipping ticket creation`);
        await client.query('COMMIT');
        return;
      }

      console.log(`🎫 Creating tickets for order ${order.id} (no existing tickets found)`);
      
      // Generate tickets only if none exist
      const holderInfo = {
        name: order.buyer_name || undefined,
        email: order.buyer_email || undefined
      };

      // Handle both internal events (event_id) and external events (external_event_id)
      let tickets;
      if (order.event_id) {
        // Traditional internal event
        tickets = await createTickets(
          order.id,
          order.event_id,
          order.quantity,
          holderInfo
        );
        
        // Note: tickets_sold already updated in payment intent creation with transaction
        // No need to update again here to avoid double-counting
      } else if (order.external_event_id) {
        // External UUID event - create tickets differently
        tickets = await createTicketsForExternalEvent(
          order.id,
          order.external_event_id,
          order.quantity,
          holderInfo
        );
      } else {
        await client.query('ROLLBACK');
        console.error(`Order ${order.id} has neither event_id nor external_event_id`);
        return;
      }

      await client.query('COMMIT');

      console.log(`🎫 Generated ${tickets.length} tickets for order ${order.id}`);

      // Log ticket creation (sensitive QR tokens removed from logs)
      console.log(`🎫 Generated ${tickets.length} tickets with numbers: ${tickets.map(t => t.ticket_number).join(', ')}`);
      
      // TODO: Send confirmation email with tickets to buyer
      // TODO: Send notification to host about sale
      
      console.log(`✅ Successfully processed payment for order ${order.id}`);
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Error processing successful payment:', error);
    // TODO: Implement retry logic or alert system for failed ticket generation
  }
}

// Handle failed payment
async function handlePaymentFailed(event: any) {
  const paymentIntent = event.data.object;
  const paymentIntentId = paymentIntent.id;

  console.log(`❌ Payment failed: ${paymentIntentId}`);

  try {
    // Update order status to failed
    const order = await updateOrderStatus(paymentIntentId, 'failed');

    if (order) {
      console.log(`📝 Updated order ${order.id} to failed status`);
      
      // TODO: Send failure notification to buyer
      // TODO: Log failure reason for analysis
      
      const failureReason = paymentIntent.last_payment_error?.message || 'Unknown error';
      console.log(`💔 Payment failure reason: ${failureReason}`);
    }

  } catch (error) {
    console.error('Error processing failed payment:', error);
  }
}

// Handle payment requiring action (3D Secure, etc.)
async function handlePaymentRequiresAction(event: any) {
  const paymentIntent = event.data.object;
  const paymentIntentId = paymentIntent.id;

  console.log(`⚠️ Payment requires action: ${paymentIntentId}`);

  // PaymentSheet will handle this automatically on the client side
  // We just log it for monitoring purposes
  
  try {
    const db = getDatabase();
    const result = await db.query(
      'SELECT id FROM orders WHERE stripe_payment_intent_id = $1',
      [paymentIntentId]
    );

    if (result.rows.length > 0) {
      const orderId = result.rows[0].id;
      console.log(`🔐 Order ${orderId} payment requires additional authentication`);
    }

  } catch (error) {
    console.error('Error handling payment requires action:', error);
  }
}

// Handle Connect account updates
async function handleAccountUpdated(event: any) {
  const account = event.data.object;
  const accountId = account.id;

  console.log(`🏦 Connect account updated: ${accountId}`);

  try {
    // Check if onboarding is now complete
    const chargesEnabled = account.charges_enabled;
    const payoutsEnabled = account.payouts_enabled;
    const detailsSubmitted = account.details_submitted;

    const onboardingComplete = chargesEnabled && payoutsEnabled && detailsSubmitted;

    // Update user record if onboarding is complete
    if (onboardingComplete) {
      const db = getDatabase();
      const result = await db.query(
        'UPDATE users SET connect_onboarding_complete = true WHERE stripe_connect_id = $1 RETURNING id, email',
        [accountId]
      );

      if (result.rows.length > 0) {
        const user = result.rows[0];
        console.log(`✅ Host ${user.email} (ID: ${user.id}) onboarding completed`);
        
        // TODO: Send welcome email to host
        // TODO: Enable host to create events
      }
    } else {
      console.log(`⏳ Account ${accountId} onboarding still in progress`);
      console.log(`   Charges enabled: ${chargesEnabled}`);
      console.log(`   Payouts enabled: ${payoutsEnabled}`);
      console.log(`   Details submitted: ${detailsSubmitted}`);
    }

  } catch (error) {
    console.error('Error handling account update:', error);
  }
}

// Test endpoint - REMOVED for security. Use Stripe CLI for testing:
// stripe listen --forward-to localhost:4242/webhooks/stripe

// Health check for webhooks
webhookRoutes.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    webhook_endpoint: '/webhooks/stripe',
    timestamp: new Date().toISOString()
  });
});
