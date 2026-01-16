import { Router, Request, Response } from 'express';
import { createErrorResponse } from '../utils/errors';
import { stripe } from '../stripe';
import { getDatabase } from '../database';

export const productsRoutes: ReturnType<typeof Router> = Router();

// POST /stripe/products
// Create a Stripe product for an event
productsRoutes.post('/products', async (req: Request, res: Response) => {
  try {
    const { eventId, name, description, connected_account_id, metadata = {} } = req.body;

    // Validate required fields
    if (!name || !connected_account_id) {
      return res.status(400).json({
        error: { message: 'name and connected_account_id are required' }
      });
    }

    console.log(`Creating Stripe product for connected account: ${connected_account_id}`);

    // Create product in the connected account
    const product = await stripe.products.create({
      name: name,
      description: description || undefined,
      metadata: {
        ...metadata,
        eventId: eventId || undefined,
        platform: 'vibesy'
      }
    }, {
      stripeAccount: connected_account_id
    });

    console.log(`Successfully created Stripe product: ${product.id}`);

    return res.status(201).json({
      id: product.id,
      name: product.name,
      description: product.description,
      metadata: product.metadata,
      created: product.created,
      updated: product.updated || product.created
    });

  } catch (error: any) {
    console.error('Error creating Stripe product:', error);
    
    if (error.type?.startsWith('Stripe')) {
      return res.status(400).json({
        error: { message: error.message }
      });
    }
    
    return res.status(500).json({
      error: { message: 'Failed to create product' }
    });
  }
});

// POST /stripe/prices
// Create a Stripe price for a product
productsRoutes.post('/prices', async (req: Request, res: Response) => {
  try {
    const { 
      product_id, 
      unit_amount, 
      currency, 
      nickname, 
      metadata, 
      connected_account_id 
    } = req.body;

    // Validate required fields
    if (!product_id || unit_amount === undefined || !currency || !connected_account_id) {
      return res.status(400).json({
        error: { message: 'product_id, unit_amount, currency, and connected_account_id are required' }
      });
    }

    console.log(`Creating Stripe price for product: ${product_id}`);

    // Create price in the connected account
    const price = await stripe.prices.create({
      product: product_id,
      unit_amount: unit_amount,
      currency: currency.toLowerCase(),
      nickname: nickname || undefined,
      metadata: {
        ...metadata,
        platform: 'vibesy'
      }
    }, {
      stripeAccount: connected_account_id
    });

    console.log(`Successfully created Stripe price: ${price.id}`);

    return res.status(201).json({
      id: price.id,
      product: price.product,
      unit_amount: price.unit_amount,
      currency: price.currency,
      nickname: price.nickname,
      metadata: price.metadata,
      created: price.created
    });

  } catch (error: any) {
    console.error('Error creating Stripe price:', error);
    
    if (error.type?.startsWith('Stripe')) {
      return res.status(400).json({
        error: { message: error.message }
      });
    }
    
    return res.status(500).json({
      error: { message: 'Failed to create price' }
    });
  }
});

// GET /stripe/products/:productId/prices
// Get all prices for a product
productsRoutes.get('/products/:productId/prices', async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const { connected_account_id } = req.query;

    if (!connected_account_id) {
      return res.status(400).json({
        error: { message: 'connected_account_id is required' }
      });
    }

    console.log(`Getting prices for product: ${productId}`);

    const prices = await stripe.prices.list({
      product: productId,
      limit: 100 // Adjust as needed
    }, {
      stripeAccount: connected_account_id as string
    });

    console.log(`Successfully retrieved ${prices.data.length} prices for product: ${productId}`);

    const formattedPrices = prices.data.map(price => ({
      id: price.id,
      product: price.product,
      unit_amount: price.unit_amount,
      currency: price.currency,
      nickname: price.nickname,
      metadata: price.metadata,
      created: price.created
    }));

    return res.json({
      success: true,
      data: formattedPrices,
      has_more: prices.has_more
    });

  } catch (error: any) {
    console.error('Error getting prices for product:', error);
    
    if (error.type?.startsWith('Stripe')) {
      return res.status(400).json({
        error: { message: error.message }
      });
    }
    
    return res.status(500).json({
      error: { message: 'Failed to get prices' }
    });
  }
});

// GET /stripe/products/:productId
// Get a specific product
productsRoutes.get('/products/:productId', async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const { connected_account_id } = req.query;

    if (!connected_account_id) {
      return res.status(400).json({
        error: { message: 'connected_account_id is required' }
      });
    }

    console.log(`Getting Stripe product: ${productId}`);

    const product = await stripe.products.retrieve(productId, {
      stripeAccount: connected_account_id as string
    });

    console.log(`Successfully retrieved Stripe product: ${product.id}`);

    return res.json({
      success: true,
      product: {
        id: product.id,
        name: product.name,
        description: product.description,
        metadata: product.metadata,
        created: product.created,
        updated: product.updated || product.created
      }
    });

  } catch (error: any) {
    console.error('Error getting Stripe product:', error);
    
    if (error.type?.startsWith('Stripe')) {
      return res.status(400).json({
        error: { message: error.message }
      });
    }
    
    return res.status(500).json({
      error: { message: 'Failed to get product' }
    });
  }
});
