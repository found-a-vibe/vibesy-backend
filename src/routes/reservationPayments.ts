import { Router, Request, Response } from 'express';
import { 
  calculatePlatformFee,
  createPaymentIntentWithDestination,
  getOrCreateCustomer,
  createEphemeralKey,
  isStripeError,
  handleStripeError 
} from '../stripe';
import { 
  findUserByEmail,
  findUserByStripeConnectId,
  createUser,
  updateUser,
  getDatabase,
  firestore
} from '../database';

export const reservationPaymentRoutes = Router();

// Helper function to get host information from UUID event
async function getHostInfoFromUUIDEvent(eventId: string) {
  try {
    console.log(`Looking up event ${eventId} in Firestore...`);
    
    // Try different case variations of the UUID
    const eventIdVariations = [
      eventId, // Original case
      eventId.toLowerCase(), // Lowercase
      eventId.toUpperCase(), // Uppercase
    ];
    
    let eventDoc;
    let foundEventId;
    
    // Try each variation until we find the event
    for (const variation of eventIdVariations) {
      console.log(`Trying event ID variation: ${variation}`);
      eventDoc = await firestore.collection('events').doc(variation).get();
      
      if (eventDoc.exists) {
        foundEventId = variation;
        console.log(`Found event with ID: ${foundEventId}`);
        break;
      }
    }
    
    if (!eventDoc || !eventDoc.exists) {
      console.log(`Event ${eventId} not found in Firestore 'events' collection (tried all case variations)`);
      throw new Error('Event not found in Firestore');
    }
    
    const eventData = eventDoc.data();
    console.log(`Found event data:`, JSON.stringify(eventData, null, 2));
    
    const stripeConnectedAccountId = eventData?.stripeConnectedAccountId;
    
    if (!stripeConnectedAccountId) {
      console.log('No stripeConnectedAccountId field found in event data, using default host account');
      return null; // Will use platform account as fallback
    }
    
    console.log(`Found Stripe Connected Account ID: ${stripeConnectedAccountId}`);
    
    // Try to find host user by their Stripe Connect ID
    let hostUser = await findUserByStripeConnectId(stripeConnectedAccountId);
    
    if (!hostUser) {
      console.log(`Host user not found for Stripe Connect ID: ${stripeConnectedAccountId}, but we can still use destination charges`);
      // Create a mock host user object with the essential info for destination charges
      hostUser = {
        id: -1, // Mock ID
        email: 'host@unknown.com', // Mock email
        role: 'host' as const,
        stripe_connect_id: stripeConnectedAccountId,
        connect_onboarding_complete: true, // We assume it's complete if event has the account ID
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    }
    
    console.log(`Using host Stripe Connect ID: ${hostUser.stripe_connect_id} for destination charges`);
    
    return {
      hostUser,
      eventData,
      canUseDestinationCharges: true
    };
  } catch (error) {
    console.error('Error getting host info from UUID event:', error);
    return null; // Will use platform account as fallback
  }
}

// POST /reservation-payments/intent
// Create PaymentIntent for UUID-based event reservations
reservationPaymentRoutes.post('/intent', async (req: Request, res: Response) => {
  try {
    const {
      event_id,  // This will be a UUID string
      quantity = 1,
      buyer_email,
      buyer_name,
      currency = 'usd',
      // For demo/testing, we'll use some default values
      price_cents = 2500  // Default $25.00 per ticket
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

    console.log(`Creating payment intent for UUID event ${event_id}, quantity: ${quantity}`);

    // Get host information from UUID event
    const hostInfo = await getHostInfoFromUUIDEvent(event_id);
    
    // Use real event data if available, otherwise fallback to defaults
    const eventData = hostInfo?.eventData || {};
    const mockEvent = {
      id: event_id,
      title: eventData.title || 'Event Reservation',
      venue: eventData.location || 'TBD',
      starts_at: eventData.date || new Date().toISOString(),
      price_cents: price_cents
    };

    // Calculate amounts
    const ticketPriceCents = price_cents;
    const totalAmountCents = ticketPriceCents * quantity;
    const platformFeeCents = calculatePlatformFee(totalAmountCents);
    const hostAmountCents = totalAmountCents - platformFeeCents;
    
    if (hostInfo?.canUseDestinationCharges) {
      console.log(`Payment with destination charges: Total: ${totalAmountCents}¢, Platform Fee: ${platformFeeCents}¢, Host: ${hostAmountCents}¢ → ${hostInfo.hostUser.stripe_connect_id}`);
    } else {
      console.log(`Payment to platform account: Total: ${totalAmountCents}¢, Platform Fee: ${platformFeeCents}¢ (no host payout available)`);
    }

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
        stripeCustomer = await getOrCreateCustomer(buyer_email, buyer_name);
        if (stripeCustomer.id !== buyer.stripe_customer_id) {
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

    // Create PaymentIntent with Stripe Connect destination charges when available
    const db = getDatabase();
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    
    // Base payment intent parameters
    const baseParams = {
      amount: totalAmountCents,
      currency: currency,
      customer: stripeCustomer.id,
      metadata: {
        event_id: event_id,
        event_title: mockEvent.title,
        buyer_email: buyer_email,
        buyer_name: buyer_name || '',
        quantity: quantity.toString(),
        ticket_price_cents: ticketPriceCents.toString(),
        platform_fee_cents: platformFeeCents.toString(),
        payment_type: 'reservation',
        ...(hostInfo?.canUseDestinationCharges ? {
          host_stripe_connect_id: hostInfo.hostUser.stripe_connect_id,
          host_amount_cents: hostAmountCents.toString()
        } : {})
      },
      // Enable automatic payment methods
      automatic_payment_methods: {
        enabled: true,
      },
    };
    
    // Add destination charge parameters if host info is available and eligible
    const paymentIntentParams = hostInfo?.canUseDestinationCharges 
      ? {
          ...baseParams,
          transfer_data: {
            destination: hostInfo.hostUser.stripe_connect_id,
          },
          application_fee_amount: platformFeeCents,
        }
      : baseParams;
    
    const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

    // Create ephemeral key for PaymentSheet
    const ephemeralKey = await createEphemeralKey(stripeCustomer.id);

    console.log(`Created PaymentIntent: ${paymentIntent.id} for UUID event: ${event_id}`);

    // Idempotency: Check if an order already exists for this PaymentIntent
    let existingOrder = await db.query(
      'SELECT id FROM orders WHERE stripe_payment_intent_id = $1',
      [paymentIntent.id]
    );

    let orderId: number;
    if (existingOrder.rows.length > 0) {
      orderId = existingOrder.rows[0].id;
      console.log(`Order already exists for PaymentIntent ${paymentIntent.id}: ${orderId}`);
    } else {
      // Create a proper order record in the database
      // For UUID events, we use external_event_id instead of event_id
      const orderResult = await db.query(`
        INSERT INTO orders (
          buyer_id, 
          external_event_id,
          external_event_title,
          quantity, 
          amount_cents, 
          platform_fee_cents, 
          host_amount_cents, 
          currency,
          stripe_payment_intent_id,
          status,
          buyer_email,
          buyer_name
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id
      `, [
        buyer.id,
        event_id, // UUID from Firestore
        mockEvent.title, // Event title for display
        quantity,
        totalAmountCents,
        platformFeeCents,
        hostAmountCents,
        currency,
        paymentIntent.id,
        'pending',
        buyer_email,
        buyer_name || ''
      ]);
      
      orderId = orderResult.rows[0].id;
      console.log(`Created order record with ID: ${orderId}`);
    }

    // Idempotency: Skip ticket creation if they already exist for this order
    const existingTickets = await db.query(
      'SELECT COUNT(*) as count FROM tickets WHERE order_id = $1',
      [orderId]
    );

    let ticketResults;
    if (parseInt(existingTickets.rows[0].count) > 0) {
      console.log(`Tickets already exist for order ${orderId}, skipping creation`);
      ticketResults = [];
    } else {
      // Create tickets for this order
      const ticketCreationPromises = [];
      for (let i = 0; i < quantity; i++) {
        const ticketNumber = `VBS-${orderId.toString().padStart(6, '0')}-${(i + 1).toString().padStart(3, '0')}`;
        const qrToken = `${orderId}-${i + 1}-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
        
        const ticketPromise = db.query(`
          INSERT INTO tickets (
            order_id,
            external_event_id,
            qr_token,
            ticket_number,
            holder_name,
            holder_email,
            status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id
        `, [
          orderId,
          event_id, // UUID from Firestore
          qrToken,
          ticketNumber,
          buyer_name || '',
          buyer_email,
          'valid'
        ]);
        
        ticketCreationPromises.push(ticketPromise);
      }
      
      // Wait for all tickets to be created
      ticketResults = await Promise.all(ticketCreationPromises);
      console.log(`Created ${ticketResults.length} tickets for order ${orderId}`);
    }

    // Return configuration for PaymentSheet (matching the iOS TicketPaymentIntentResponse format)
    
    res.json({
      success: true,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      paymentIntentClientSecret: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: stripeCustomer.id,
      order_id: orderId, // Use snake_case as expected by iOS
      event: {
        id: parseInt(event_id.replace(/[^0-9]/g, '').slice(0, 9)) || 999999999, // Convert UUID to integer for iOS compatibility
        title: mockEvent.title,
        venue: mockEvent.venue,
        starts_at: mockEvent.starts_at, // Use snake_case
        price_cents: ticketPriceCents // Use snake_case
      },
      order_summary: { // Use snake_case as expected by iOS
        quantity: quantity,
        ticket_price_cents: ticketPriceCents, // Use snake_case
        total_amount_cents: totalAmountCents, // Use snake_case
        platform_fee_cents: platformFeeCents, // Use snake_case
        currency: currency
      }
    });

  } catch (error) {
    console.error('Reservation payment intent creation error:', error);
    
    if (isStripeError(error)) {
      const { message, statusCode } = handleStripeError(error);
      return res.status(statusCode).json({ error: { message } });
    }
    
    res.status(500).json({ 
      error: { message: 'Internal server error' } 
    });
  }
});