import { Router, Response } from 'express';
import { 
  stripe,
  calculatePlatformFee,
  createPaymentIntentWithDestination,
  getOrCreateCustomer,
  createEphemeralKey,
  isStripeError,
  handleStripeError 
} from '../stripe';
import { 
  findUserByEmail,
  findUserById,
  createUser,
  updateUser,
  findEventById,
  createOrder,
  findUserByStripeConnectId,
  getDatabase
} from '../database';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { validateSchema, paymentIntentSchema, customerCreateSchema } from '../middleware/schemaValidation';
import { ApiError } from '../utils/errors';
import { asyncHandler } from '../utils/asyncHandler';

export const paymentRoutes: ReturnType<typeof Router> = Router();

// POST /payments/intent
// Create PaymentIntent for ticket purchase with destination charges
paymentRoutes.post('/intent', requireAuth, validateSchema(paymentIntentSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const {
    event_id,
    quantity = 1,
    buyer_email,
    buyer_name,
    currency = 'usd'
  } = req.body;

  // SECURITY: Verify authenticated user email matches buyer email
  if (req.user?.email && buyer_email !== req.user.email) {
    throw new ApiError(403, 'Forbidden', 'Buyer email must match authenticated user');
  }

  console.log(`Creating payment intent for event ${event_id}, quantity: ${quantity}`);

  // Get event details
  const event = await findEventById(event_id);
  if (!event) {
    throw new ApiError(404, 'Not Found', 'Event not found');
  }

  // Check if event is active and has capacity
  if (event.status !== 'active') {
    throw new ApiError(400, 'Bad Request', 'Event is not available for purchase');
  }

  // Get host information
  const hostUser = await findUserById(event.host_id);
  if (!hostUser) {
    throw new ApiError(500, 'Internal Server Error', 'Event host not found');
  }

  if (!hostUser.stripe_connect_id || !hostUser.connect_onboarding_complete) {
    throw new ApiError(400, 'Bad Request', 'Host payment setup incomplete');
  }

  // Calculate amounts
  const ticketPriceCents = event.price_cents;
  const totalAmountCents = ticketPriceCents * quantity;
  const platformFeeCents = calculatePlatformFee(totalAmountCents);
  const hostAmountCents = totalAmountCents - platformFeeCents;

  console.log(`Payment calculation: Total: ${totalAmountCents}¢, Platform Fee: ${platformFeeCents}¢, Host: ${hostAmountCents}¢`);

  // Find or create buyer
  let buyer = await findUserByEmail(buyer_email);
  if (!buyer) {
    const [firstName, ...lastNameParts] = (buyer_name || '').split(' ');
    buyer = await createUser({
      email: buyer_email,
      role: 'buyer',
      first_name: firstName || undefined,
      last_name: lastNameParts.join(' ') || undefined,
      firebase_uid: req.user?.uid
    });
    console.log(`Created new buyer user: ${buyer.id}`);
  }

  // Create or get Stripe customer
  let stripeCustomer;
  if (buyer.stripe_customer_id) {
    try {
      // Verify customer exists in Stripe
      stripeCustomer = await getOrCreateCustomer(buyer_email, buyer_name);
      if (stripeCustomer.id !== buyer.stripe_customer_id) {
        // Update if different customer returned
        await updateUser(buyer.id, { stripe_customer_id: stripeCustomer.id });
      }
    } catch (error) {
      console.log('Existing customer not found, creating new one');
      stripeCustomer = await getOrCreateCustomer(buyer_email, buyer_name);
      await updateUser(buyer.id, { stripe_customer_id: stripeCustomer.id });
    }
  } else {
    stripeCustomer = await getOrCreateCustomer(buyer_email, buyer_name);
    await updateUser(buyer.id, { stripe_customer_id: stripeCustomer.id });
  }

  // Create PaymentIntent with destination charge
  const paymentIntent = await createPaymentIntentWithDestination({
    amount: totalAmountCents,
    currency: currency,
    destinationAccountId: hostUser.stripe_connect_id,
    platformFeeAmount: platformFeeCents,
    customerId: stripeCustomer.id,
    metadata: {
      event_id: event_id.toString(),
      event_title: event.title,
      buyer_email: buyer_email,
      buyer_name: buyer_name || '',
      quantity: quantity.toString(),
      ticket_price_cents: ticketPriceCents.toString(),
      platform_fee_cents: platformFeeCents.toString(),
      host_amount_cents: hostAmountCents.toString()
    }
  });

  // RACE CONDITION FIX: Create order and update capacity in transaction
  const db = getDatabase();
  const client = await db.connect();
  let order;
  try {
    await client.query('BEGIN');
    
    // Lock event row and check capacity
    const eventResult = await client.query(
      'SELECT tickets_sold, capacity FROM events WHERE id = $1 FOR UPDATE',
      [event_id]
    );
    
    const currentEvent = eventResult.rows[0];
    if (currentEvent.tickets_sold + quantity > currentEvent.capacity) {
      await client.query('ROLLBACK');
      throw new ApiError(400, 'Bad Request', 'Not enough tickets available');
    }

    // Create order record
    const orderResult = await client.query(`
      INSERT INTO orders (
        buyer_id, event_id, quantity, amount_cents, platform_fee_cents, 
        host_amount_cents, currency, stripe_payment_intent_id, 
        buyer_email, buyer_name, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
      RETURNING *
    `, [
      buyer.id, event_id, quantity, totalAmountCents, platformFeeCents,
      hostAmountCents, currency, paymentIntent.id, buyer_email, buyer_name
    ]);
    order = orderResult.rows[0];

    // Update tickets_sold
    await client.query(
      'UPDATE events SET tickets_sold = tickets_sold + $1 WHERE id = $2',
      [quantity, event_id]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  // Create ephemeral key for PaymentSheet
  const ephemeralKey = await createEphemeralKey(stripeCustomer.id);

  // Return configuration for PaymentSheet
  res.json({
    success: true,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    paymentIntentClientSecret: paymentIntent.client_secret,
    ephemeralKey: ephemeralKey.secret,
    customer: stripeCustomer.id,
    order_id: order.id,
    event: {
      id: event.id,
      title: event.title,
      venue: event.venue,
      starts_at: event.starts_at,
      price_cents: ticketPriceCents
    },
    order_summary: {
      quantity: quantity,
      ticket_price_cents: ticketPriceCents,
      total_amount_cents: totalAmountCents,
      platform_fee_cents: platformFeeCents,
      currency: currency
    }
  });

  console.log(`Created PaymentIntent: ${paymentIntent.id} for order: ${order.id}`);
}));

// GET /payments/config
// Get publishable key and other config for PaymentSheet
paymentRoutes.get('/config', (req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    currency: 'usd',
    country: 'US'
  });
});

// POST /payments/customer
// Create or retrieve Stripe customer (for standalone customer creation)
paymentRoutes.post('/customer', requireAuth, validateSchema(customerCreateSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { email, name } = req.body;

  // SECURITY: Verify authenticated user email matches request email
  if (req.user?.email && email !== req.user.email) {
    throw new ApiError(403, 'Forbidden', 'Email must match authenticated user');
  }

  const customer = await getOrCreateCustomer(email, name);
  
  // Find or create user record
  let user = await findUserByEmail(email);
  if (!user) {
    const [firstName, ...lastNameParts] = (name || '').split(' ');
    user = await createUser({
      email,
      role: 'buyer',
      first_name: firstName || undefined,
      last_name: lastNameParts.join(' ') || undefined,
      stripe_customer_id: customer.id,
      firebase_uid: req.user?.uid
    });
  } else if (!user.stripe_customer_id) {
    await updateUser(user.id, { stripe_customer_id: customer.id });
  }

  res.json({
    success: true,
    customer: {
      id: customer.id,
      email: customer.email,
      name: customer.name
    }
  });
}));

// GET /payments/order/:order_id
// Get order details
paymentRoutes.get('/order/:order_id', requireAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { order_id } = req.params;
  
  const db = getDatabase();
  const result = await db.query(`
    SELECT o.*, e.title as event_title, e.venue, e.starts_at, e.address
    FROM orders o
    JOIN events e ON o.event_id = e.id
    WHERE o.id = $1
  `, [order_id]);

  if (result.rows.length === 0) {
    throw new ApiError(404, 'Not Found', 'Order not found');
  }

  const order = result.rows[0];

  // SECURITY: Verify user owns this order
  const buyer = await findUserByEmail(order.buyer_email);
  if (!buyer || (req.user?.uid !== buyer.firebase_uid && req.user?.email !== buyer.email)) {
    throw new ApiError(403, 'Forbidden', 'Cannot access another user\'s order');
  }

  res.json({
    success: true,
    order: {
      id: order.id,
      status: order.status,
      quantity: order.quantity,
      amount_cents: order.amount_cents,
      platform_fee_cents: order.platform_fee_cents,
      currency: order.currency,
      buyer_email: order.buyer_email,
      buyer_name: order.buyer_name,
      created_at: order.created_at,
      event: {
        title: order.event_title,
        venue: order.venue,
        starts_at: order.starts_at,
        address: order.address
      }
    }
  });
}));

// GET /payments/invoice/:payment_intent_id
// Get invoice details for a payment intent
paymentRoutes.get('/invoice/:payment_intent_id', (async (req: any, res: any) => {
  try {
    const { payment_intent_id } = (req as any).params;
    
    if (!payment_intent_id || payment_intent_id.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Payment intent ID is required'
      });
    }

    console.log(`📋 Retrieving invoice for payment intent: ${payment_intent_id}`);
    
    // Retrieve payment intent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);
    
    if (!paymentIntent) {
      return res.status(404).json({
        success: false,
        error: 'Payment intent not found'
      });
    }

    // Get invoice if one exists
    let invoice = null;
    if (paymentIntent.invoice) {
      invoice = await stripe.invoices.retrieve(paymentIntent.invoice as string);
    } else {
      // Create a mock invoice structure from payment intent data
      const charges = await stripe.charges.list({ payment_intent: payment_intent_id });
      const charge = charges.data[0];
      
      invoice = {
        id: `in_mock_${payment_intent_id}`,
        payment_intent_id: payment_intent_id,
        status: paymentIntent.status === 'succeeded' ? 'paid' : 'open',
        amount_due: paymentIntent.amount,
        amount_paid: paymentIntent.status === 'succeeded' ? paymentIntent.amount : 0,
        currency: paymentIntent.currency,
        customer_email: paymentIntent.receipt_email || charge?.billing_details?.email,
        description: paymentIntent.description || 'Event Ticket Purchase',
        invoice_date: new Date(paymentIntent.created * 1000).toISOString(),
        due_date: null,
        receipt_number: charge?.receipt_number,
        receipt_url: charge?.receipt_url,
        invoice_url: null,
        line_items: [{
          description: paymentIntent.description || 'Event Ticket',
          quantity: 1,
          unit_amount: paymentIntent.amount,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency
        }]
      };
    }

    console.log(`✅ Retrieved invoice details for: ${payment_intent_id}`);

    return res.json({
      success: true,
      invoice: invoice
    });
  } catch (error: any) {
    console.error('Invoice retrieval error:', error);
    
    if (isStripeError(error)) {
      const { message, statusCode } = handleStripeError(error);
      return res.status(statusCode).json({ 
        success: false, 
        error: message 
      });
    }
    
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}) as any);

// GET /payments/receipt/:payment_intent_id
// Get payment receipt for a payment intent
paymentRoutes.get('/receipt/:payment_intent_id', (async (req: any, res: any) => {
  try {
    const { payment_intent_id } = (req as any).params;
    
    if (!payment_intent_id || payment_intent_id.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Payment intent ID is required'
      });
    }

    console.log(`🧾 Retrieving receipt for payment intent: ${payment_intent_id}`);
    
    // Retrieve payment intent and charges from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);
    const charges = await stripe.charges.list({ payment_intent: payment_intent_id });
    
    if (!paymentIntent || charges.data.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Payment not found'
      });
    }

    const charge = charges.data[0];
    const receipt = {
      payment_intent_id: payment_intent_id,
      receipt_number: charge.receipt_number,
      receipt_url: charge.receipt_url,
      amount_paid: charge.amount,
      currency: charge.currency,
      payment_method: charge.payment_method_details?.type || 'card',
      payment_date: new Date(charge.created * 1000).toISOString(),
      customer_email: charge.billing_details?.email || paymentIntent.receipt_email,
      description: paymentIntent.description || 'Event Ticket Purchase',
      status: charge.status
    };

    console.log(`✅ Retrieved payment receipt for: ${payment_intent_id}`);

    return res.json({
      success: true,
      receipt: receipt
    });
  } catch (error: any) {
    console.error('Receipt retrieval error:', error);
    
    if (isStripeError(error)) {
      const { message, statusCode } = handleStripeError(error);
      return res.status(statusCode).json({ 
        success: false, 
        error: message 
      });
    }
    
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}) as any);
