import { Router, Request, Response } from 'express';
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

export const paymentRoutes = Router();

// POST /payments/intent
// Create PaymentIntent for ticket purchase with destination charges
paymentRoutes.post('/intent', async (req: Request, res: Response) => {
  try {
    const {
      event_id,
      quantity = 1,
      buyer_email,
      buyer_name,
      currency = 'usd'
    } = req.body;

    // Validate required fields
    if (!event_id || !buyer_email) {
      return res.status(400).json({ 
        error: { message: 'event_id and buyer_email are required' } 
      });
    }

    if (quantity < 1 || quantity > 10) {
      return res.status(400).json({ 
        error: { message: 'quantity must be between 1 and 10' } 
      });
    }

    console.log(`Creating payment intent for event ${event_id}, quantity: ${quantity}`);

    // Get event details
    const event = await findEventById(event_id);
    if (!event) {
      return res.status(404).json({ 
        error: { message: 'Event not found' } 
      });
    }

    // Check if event is active and has capacity
    if (event.status !== 'active') {
      return res.status(400).json({ 
        error: { message: 'Event is not available for purchase' } 
      });
    }

    if (event.tickets_sold + quantity > event.capacity) {
      return res.status(400).json({ 
        error: { message: 'Not enough tickets available' } 
      });
    }

    // Get host information
    const hostUser = await findUserById(event.host_id);
    if (!hostUser) {
      return res.status(500).json({ 
        error: { message: 'Event host not found' } 
      });
    }

    if (!hostUser.stripe_connect_id || !hostUser.connect_onboarding_complete) {
      return res.status(400).json({ 
        error: { message: 'Host payment setup incomplete' } 
      });
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
        last_name: lastNameParts.join(' ') || undefined
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

    // Create order record
    const order = await createOrder({
      buyer_id: buyer.id,
      event_id: event_id,
      quantity: quantity,
      amount_cents: totalAmountCents,
      platform_fee_cents: platformFeeCents,
      host_amount_cents: hostAmountCents,
      currency: currency,
      stripe_payment_intent_id: paymentIntent.id,
      buyer_email: buyer_email,
      buyer_name: buyer_name
    });

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

  } catch (error) {
    console.error('Payment intent creation error:', error);
    
    if (isStripeError(error)) {
      const { message, statusCode } = handleStripeError(error);
      return res.status(statusCode).json({ error: { message } });
    }
    
    res.status(500).json({ 
      error: { message: 'Internal server error' } 
    });
  }
});

// GET /payments/config
// Get publishable key and other config for PaymentSheet
paymentRoutes.get('/config', async (req: Request, res: Response) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    currency: 'usd',
    country: 'US'
  });
});

// POST /payments/customer
// Create or retrieve Stripe customer (for standalone customer creation)
paymentRoutes.post('/customer', async (req: Request, res: Response) => {
  try {
    const { email, name } = req.body;

    if (!email) {
      return res.status(400).json({ 
        error: { message: 'Email is required' } 
      });
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
        stripe_customer_id: customer.id
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

  } catch (error) {
    console.error('Customer creation error:', error);
    
    if (isStripeError(error)) {
      const { message, statusCode } = handleStripeError(error);
      return res.status(statusCode).json({ error: { message } });
    }
    
    res.status(500).json({ 
      error: { message: 'Internal server error' } 
    });
  }
});

// GET /payments/order/:order_id
// Get order details
paymentRoutes.get('/order/:order_id', async (req: Request, res: Response) => {
  try {
    const { order_id } = req.params;
    
    const db = getDatabase();
    const result = await db.query(`
      SELECT o.*, e.title as event_title, e.venue, e.starts_at, e.address
      FROM orders o
      JOIN events e ON o.event_id = e.id
      WHERE o.id = $1
    `, [order_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: { message: 'Order not found' } 
      });
    }

    const order = result.rows[0];

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

  } catch (error) {
    console.error('Order retrieval error:', error);
    res.status(500).json({ 
      error: { message: 'Internal server error' } 
    });
  }
});

// GET /payments/invoice/:payment_intent_id
// Get invoice details for a payment intent
paymentRoutes.get('/invoice/:payment_intent_id', async (req: Request, res: Response) => {
  try {
    const { payment_intent_id } = req.params;
    
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

    res.json({
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
    
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// GET /payments/receipt/:payment_intent_id
// Get payment receipt for a payment intent
paymentRoutes.get('/receipt/:payment_intent_id', async (req: Request, res: Response) => {
  try {
    const { payment_intent_id } = req.params;
    
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

    res.json({
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
    
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});
