import express from 'express';
import { body, validationResult } from 'express-validator';
import { stripe } from '../stripe';
import { firestore } from '../database';
import { validateRequest } from '../middleware/validation';
import { ApiError } from '../utils/errors';

export const paymentIntentsRoutes: ReturnType<typeof express.Router> = express.Router();

/**
 * Create a payment intent for event ticket purchase
 * Handles connected account payments for event hosts
 */
paymentIntentsRoutes.post('/payment-intents', [
  body('event_id').isString().notEmpty().withMessage('Event ID is required'),
  body('price_id').isString().notEmpty().withMessage('Stripe price ID is required'),
  body('quantity').isInt({ min: 1, max: 10 }).withMessage('Quantity must be between 1 and 10'),
  body('user_email').isEmail().withMessage('Valid email address is required'),
  body('connected_account_id').isString().notEmpty().withMessage('Connected account ID is required'),
], validateRequest, async (req, res) => {
  try {
    const { event_id, price_id, quantity, user_email, connected_account_id } = req.body;

    console.log('Creating payment intent for:', {
      event_id,
      price_id,
      quantity,
      user_email,
      connected_account_id: connected_account_id?.substring(0, 10) + '...'
    });

    // 1. Verify the event exists and belongs to the connected account
    const eventDoc = await firestore.collection('events').doc(event_id.toLowerCase()).get();
    if (!eventDoc.exists) {
      throw new ApiError(404, 'Event not found');
    }

    const eventData = eventDoc.data();
    if (eventData?.stripeConnectedAccountId !== connected_account_id) {
      throw new ApiError(403, 'Connected account mismatch for this event');
    }

    // 2. Retrieve the Stripe price to get amount information
    const price = await stripe.prices.retrieve(price_id, {
      stripeAccount: connected_account_id
    });

    if (!price.active) {
      throw new ApiError(400, 'Price is no longer available');
    }

    // 3. Calculate total amount
    const unitAmount = price.unit_amount || 0;
    const totalAmount = unitAmount * quantity;

    // 4. Create or retrieve customer on platform account
    let customerId: string;
    
    try {
      // Try to find existing customer by email on platform account
      const existingCustomers = await stripe.customers.list({
        email: user_email,
        limit: 1
      });

      if (existingCustomers.data.length > 0) {
        customerId = existingCustomers.data[0].id;
      } else {
        // Create new customer on platform account
        const customer = await stripe.customers.create({
          email: user_email,
          metadata: {
            platform: 'vibesy',
            event_id: event_id
          }
        });
        customerId = customer.id;
      }
    } catch (error) {
      console.error('Error managing customer:', error);
      throw new ApiError(500, 'Failed to set up customer account');
    }

    // 5. Create payment intent on platform account with transfer to connected account
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalAmount,
      currency: price.currency,
      customer: customerId,
      metadata: {
        event_id: event_id,
        price_id: price_id,
        quantity: quantity.toString(),
        user_email: user_email,
        platform: 'vibesy',
        connected_account_id: connected_account_id
      },
      // Application fee (platform fee) - 3% of total
      application_fee_amount: Math.floor(totalAmount * 0.03),
      // Transfer data for the connected account (event host gets the money)
      transfer_data: {
        destination: connected_account_id,
      },
      // Automatic payment methods for better UX
      automatic_payment_methods: {
        enabled: true,
      },
      // Note: No stripeAccount parameter - this creates the payment intent on the platform account
    });

    console.log('✅ Payment intent created:', paymentIntent.id);

    res.json({
      id: paymentIntent.id,
      client_secret: paymentIntent.client_secret,
      amount: totalAmount,
      currency: price.currency,
      status: paymentIntent.status,
      connected_account_id: connected_account_id,
      customer_id: customerId
    });

  } catch (error: any) {
    console.error('❌ Error creating payment intent:', error);
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    if (error.type === 'StripeCardError') {
      throw new ApiError(400, `Payment error: ${error.message}`);
    }
    
    if (error.type === 'StripeInvalidRequestError') {
      throw new ApiError(400, `Invalid request: ${error.message}`);
    }
    
    throw new ApiError(500, 'Failed to create payment intent');
  }
});

/**
 * Confirm payment intent (webhook alternative for demo)
 * In production, use Stripe webhooks for payment confirmation
 */
paymentIntentsRoutes.post('/payment-intents/:id/confirm', [
  body('user_email').isEmail().withMessage('Valid email address is required'),
], validateRequest, async (req, res) => {
  try {
    const { id: paymentIntentId } = req.params;
    const { user_email } = req.body;

    console.log('Confirming payment intent:', paymentIntentId);

    // Retrieve the payment intent to get metadata
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    if (paymentIntent.status !== 'succeeded') {
      throw new ApiError(400, 'Payment intent has not succeeded');
    }

    const { event_id, price_id, quantity } = paymentIntent.metadata;

    // Create reservation record in Firestore
    const reservationData = {
      event_id: event_id,
      user_email: user_email,
      price_id: price_id,
      quantity: parseInt(quantity),
      payment_intent_id: paymentIntentId,
      amount_paid: paymentIntent.amount,
      currency: paymentIntent.currency,
      status: 'confirmed',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Add to reservations collection
    const reservationRef = await firestore.collection('reservations').add(reservationData);

    console.log('✅ Reservation created:', reservationRef.id);

    res.json({
      id: reservationRef.id,
      status: 'confirmed',
      payment_intent_id: paymentIntentId,
      event_id: event_id,
      user_email: user_email
    });

  } catch (error: any) {
    console.error('❌ Error confirming payment:', error);
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    throw new ApiError(500, 'Failed to confirm payment');
  }
});

/**
 * Get payment intent status
 */
paymentIntentsRoutes.get('/payment-intents/:id', async (req, res) => {
  try {
    const { id: paymentIntentId } = req.params;
    const { connected_account_id } = req.query;

    if (!connected_account_id || typeof connected_account_id !== 'string') {
      throw new ApiError(400, 'Connected account ID is required');
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      stripeAccount: connected_account_id
    });

    res.json({
      id: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      metadata: paymentIntent.metadata
    });

  } catch (error: any) {
    console.error('❌ Error retrieving payment intent:', error);
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    if (error.type === 'StripeInvalidRequestError') {
      throw new ApiError(404, 'Payment intent not found');
    }
    
    throw new ApiError(500, 'Failed to retrieve payment intent');
  }
});