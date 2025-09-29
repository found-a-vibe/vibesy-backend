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
  getDatabase
} from '../database';

export const webhookRoutes = Router();

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

    res.status(200).json({ received: true, handled: true });

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
    // Update order status to completed
    const order = await updateOrderStatus(paymentIntentId, 'completed', paymentIntent.latest_charge);

    if (!order) {
      console.error(`Order not found for payment intent: ${paymentIntentId}`);
      return;
    }

    console.log(`📝 Updated order ${order.id} to completed status`);

    // Generate tickets
    const holderInfo = {
      name: order.buyer_name || undefined,
      email: order.buyer_email || undefined
    };

    const tickets = await createTickets(
      order.id,
      order.event_id,
      order.quantity,
      holderInfo
    );

    console.log(`🎫 Generated ${tickets.length} tickets for order ${order.id}`);

    // Update event tickets_sold count
    const db = getDatabase();
    await db.query(
      'UPDATE events SET tickets_sold = tickets_sold + $1 WHERE id = $2',
      [order.quantity, order.event_id]
    );

    // TODO: Send confirmation email with tickets to buyer
    // TODO: Send notification to host about sale
    
    console.log(`✅ Successfully processed payment for order ${order.id}`);

    // Log ticket QR tokens for verification (remove in production)
    tickets.forEach((ticket, index) => {
      console.log(`🎫 Ticket ${index + 1}: ${ticket.ticket_number} - QR: ${ticket.qr_token.substring(0, 8)}...`);
    });

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

// Health check for webhooks
webhookRoutes.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    webhook_endpoint: '/webhooks/stripe',
    timestamp: new Date().toISOString()
  });
});