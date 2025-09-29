import express from 'express';
import { body, query, param } from 'express-validator';
import { FieldValue } from 'firebase-admin/firestore';
import { firestore } from '../database';
import { validateRequest } from '../middleware/validation';
import { ApiError } from '../utils/errors';

export const reservationsRoutes = express.Router();

/**
 * Create a reservation record
 * Used by the payment service after successful payment
 */
reservationsRoutes.post('/', [
  body('event_id').isString().notEmpty().withMessage('Event ID is required'),
  body('user_id').isString().notEmpty().withMessage('User ID is required'),
  body('price_detail_id').isString().notEmpty().withMessage('Price detail ID is required'),
  body('quantity').isInt({ min: 1, max: 10 }).withMessage('Quantity must be between 1 and 10'),
  body('payment_intent_id').isString().notEmpty().withMessage('Payment intent ID is required'),
  body('status').isIn(['pending', 'confirmed', 'cancelled']).withMessage('Invalid status'),
], validateRequest, async (req, res) => {
  try {
    const {
      event_id,
      user_id,
      price_detail_id,
      quantity,
      payment_intent_id,
      status
    } = req.body;

    console.log('Creating reservation:', {
      event_id,
      user_id,
      quantity,
      status
    });

    // Verify the event exists
    const eventDoc = await firestore.collection('events').doc(event_id.toLowerCase()).get();
    if (!eventDoc.exists) {
      throw new ApiError(404, 'Event not found');
    }

    // Create reservation document
    const reservationData = {
      event_id: event_id.toLowerCase(),
      user_id: user_id,
      price_detail_id: price_detail_id,
      quantity: quantity,
      payment_intent_id: payment_intent_id,
      status: status,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Add to reservations collection
    const reservationRef = await firestore.collection('reservations').add(reservationData);
    
    // Update event reservations count and add user to reservations array
    const eventRef = firestore.collection('events').doc(event_id.toLowerCase());
    await eventRef.update({
      reservations: FieldValue.arrayUnion(user_id),
      updated_at: new Date().toISOString()
    });

    console.log('✅ Reservation created:', reservationRef.id);

    res.status(201).json({
      id: reservationRef.id,
      event_id: event_id,
      user_id: user_id,
      status: status,
      created_at: reservationData.created_at,
      updated_at: reservationData.updated_at
    });

  } catch (error: any) {
    console.error('❌ Error creating reservation:', error);
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    throw new ApiError(500, 'Failed to create reservation');
  }
});

/**
 * Get reservations for a specific user
 */
reservationsRoutes.get('/user/:userId', [
  param('userId').isString().notEmpty().withMessage('User ID is required'),
  query('status').optional().isIn(['pending', 'confirmed', 'cancelled']).withMessage('Invalid status filter'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
], validateRequest, async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, limit = '20' } = req.query;

    console.log('Getting reservations for user:', userId);

    let query = firestore.collection('reservations')
      .where('user_id', '==', userId)
      .orderBy('created_at', 'desc')
      .limit(parseInt(limit as string));

    if (status) {
      query = query.where('status', '==', status);
    }

    const reservationsSnapshot = await query.get();
    const reservations = reservationsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Enrich with event information
    const enrichedReservations = await Promise.all(
      reservations.map(async (reservation: any) => {
        try {
          const eventDoc = await firestore.collection('events').doc(reservation.event_id).get();
          const eventData = eventDoc.exists ? eventDoc.data() : null;
          
          return {
            ...reservation,
            event: eventData ? {
              id: reservation.event_id,
              title: eventData.title,
              date: eventData.date,
              location: eventData.location,
              images: eventData.images || []
            } : null
          };
        } catch (error) {
          console.warn('Failed to enrich reservation with event data:', error);
          return reservation;
        }
      })
    );

    res.json({
      reservations: enrichedReservations,
      count: reservations.length,
      user_id: userId
    });

  } catch (error: any) {
    console.error('❌ Error getting user reservations:', error);
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    throw new ApiError(500, 'Failed to get reservations');
  }
});

/**
 * Get reservations for a specific event
 */
reservationsRoutes.get('/event/:eventId', [
  param('eventId').isString().notEmpty().withMessage('Event ID is required'),
  query('status').optional().isIn(['pending', 'confirmed', 'cancelled']).withMessage('Invalid status filter'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
], validateRequest, async (req, res) => {
  try {
    const { eventId } = req.params;
    const { status, limit = '20' } = req.query;

    console.log('Getting reservations for event:', eventId);

    let query = firestore.collection('reservations')
      .where('event_id', '==', eventId.toLowerCase())
      .orderBy('created_at', 'desc')
      .limit(parseInt(limit as string));

    if (status) {
      query = query.where('status', '==', status);
    }

    const reservationsSnapshot = await query.get();
    const reservations = reservationsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({
      reservations: reservations,
      count: reservations.length,
      event_id: eventId
    });

  } catch (error: any) {
    console.error('❌ Error getting event reservations:', error);
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    throw new ApiError(500, 'Failed to get reservations');
  }
});

/**
 * Update reservation status
 */
reservationsRoutes.patch('/:reservationId', [
  param('reservationId').isString().notEmpty().withMessage('Reservation ID is required'),
  body('status').isIn(['pending', 'confirmed', 'cancelled']).withMessage('Invalid status'),
], validateRequest, async (req, res) => {
  try {
    const { reservationId } = req.params;
    const { status } = req.body;

    console.log('Updating reservation status:', reservationId, 'to', status);

    const reservationRef = firestore.collection('reservations').doc(reservationId);
    const reservationDoc = await reservationRef.get();

    if (!reservationDoc.exists) {
      throw new ApiError(404, 'Reservation not found');
    }

    const updateData = {
      status: status,
      updated_at: new Date().toISOString()
    };

    await reservationRef.update(updateData);

    // If cancelling, remove user from event reservations
    if (status === 'cancelled') {
      const reservationData = reservationDoc.data();
      if (reservationData?.event_id && reservationData?.user_id) {
        const eventRef = firestore.collection('events').doc(reservationData.event_id);
        await eventRef.update({
          reservations: firestore.FieldValue.arrayRemove(reservationData.user_id),
          updated_at: new Date().toISOString()
        });
      }
    }

    console.log('✅ Reservation status updated:', reservationId);

    res.json({
      id: reservationId,
      status: status,
      updated_at: updateData.updated_at
    });

  } catch (error: any) {
    console.error('❌ Error updating reservation:', error);
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    throw new ApiError(500, 'Failed to update reservation');
  }
});

/**
 * Get specific reservation details
 */
reservationsRoutes.get('/:reservationId', [
  param('reservationId').isString().notEmpty().withMessage('Reservation ID is required'),
], validateRequest, async (req, res) => {
  try {
    const { reservationId } = req.params;

    console.log('Getting reservation details:', reservationId);

    const reservationDoc = await firestore.collection('reservations').doc(reservationId).get();

    if (!reservationDoc.exists) {
      throw new ApiError(404, 'Reservation not found');
    }

    const reservation = {
      id: reservationDoc.id,
      ...reservationDoc.data()
    };

    // Enrich with event information
    const eventDoc = await firestore.collection('events').doc(reservation.event_id).get();
    const eventData = eventDoc.exists ? eventDoc.data() : null;

    const enrichedReservation = {
      ...reservation,
      event: eventData ? {
        id: reservation.event_id,
        title: eventData.title,
        description: eventData.description,
        date: eventData.date,
        timeRange: eventData.timeRange,
        location: eventData.location,
        images: eventData.images || [],
        priceDetails: eventData.priceDetails || []
      } : null
    };

    res.json(enrichedReservation);

  } catch (error: any) {
    console.error('❌ Error getting reservation details:', error);
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    throw new ApiError(500, 'Failed to get reservation details');
  }
});

/**
 * Delete a reservation (admin only or user's own reservation)
 */
reservationsRoutes.delete('/:reservationId', [
  param('reservationId').isString().notEmpty().withMessage('Reservation ID is required'),
], validateRequest, async (req, res) => {
  try {
    const { reservationId } = req.params;

    console.log('Deleting reservation:', reservationId);

    const reservationRef = firestore.collection('reservations').doc(reservationId);
    const reservationDoc = await reservationRef.get();

    if (!reservationDoc.exists) {
      throw new ApiError(404, 'Reservation not found');
    }

    const reservationData = reservationDoc.data();

    // Remove user from event reservations
    if (reservationData?.event_id && reservationData?.user_id) {
      const eventRef = firestore.collection('events').doc(reservationData.event_id);
      await eventRef.update({
        reservations: firestore.FieldValue.arrayRemove(reservationData.user_id),
        updated_at: new Date().toISOString()
      });
    }

    // Delete the reservation
    await reservationRef.delete();

    console.log('✅ Reservation deleted:', reservationId);

    res.json({
      id: reservationId,
      status: 'deleted',
      deleted_at: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('❌ Error deleting reservation:', error);
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    throw new ApiError(500, 'Failed to delete reservation');
  }
});