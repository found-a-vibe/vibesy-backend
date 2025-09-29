import { Router, Request, Response } from 'express';
import QRCode from 'qrcode';
import { 
  findTicketByQRToken,
  updateTicketStatus,
  getDatabase
} from '../database';

export const ticketRoutes = Router();

// GET /tickets/verify?token=...
// Verify a ticket QR code
ticketRoutes.get('/verify', async (req: Request, res: Response) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ 
        error: { message: 'QR token is required' } 
      });
    }

    console.log(`🔍 Verifying ticket with token: ${token.substring(0, 8)}...`);

    // Find ticket by QR token
    const ticketWithEvent = await findTicketByQRToken(token);

    if (!ticketWithEvent) {
      return res.status(404).json({
        valid: false,
        error: { message: 'Ticket not found' },
        details: 'Invalid QR code'
      });
    }

    const currentTime = new Date();
    const eventStartTime = new Date(ticketWithEvent.event.starts_at);
    
    // Check if ticket is valid
    if (ticketWithEvent.status === 'used') {
      return res.json({
        valid: false,
        used: true,
        error: { message: 'Ticket already used' },
        ticket: {
          id: ticketWithEvent.id,
          ticket_number: ticketWithEvent.ticket_number,
          status: ticketWithEvent.status,
          scanned_at: ticketWithEvent.scanned_at,
          holder_name: ticketWithEvent.holder_name
        },
        event: {
          title: ticketWithEvent.event.title,
          venue: ticketWithEvent.event.venue,
          starts_at: ticketWithEvent.event.starts_at
        }
      });
    }

    if (ticketWithEvent.status === 'cancelled' || ticketWithEvent.status === 'refunded') {
      return res.json({
        valid: false,
        error: { message: `Ticket ${ticketWithEvent.status}` },
        ticket: {
          id: ticketWithEvent.id,
          ticket_number: ticketWithEvent.ticket_number,
          status: ticketWithEvent.status
        }
      });
    }

    // Check if event has started (allow entry up to 30 minutes after start)
    const thirtyMinutesAfterStart = new Date(eventStartTime.getTime() + 30 * 60000);
    const isEventAccessible = currentTime >= new Date(eventStartTime.getTime() - 60 * 60000) && // 1 hour before
                              currentTime <= thirtyMinutesAfterStart; // 30 minutes after

    return res.json({
      valid: true,
      event_accessible: isEventAccessible,
      ticket: {
        id: ticketWithEvent.id,
        ticket_number: ticketWithEvent.ticket_number,
        status: ticketWithEvent.status,
        holder_name: ticketWithEvent.holder_name,
        holder_email: ticketWithEvent.holder_email
      },
      event: {
        id: ticketWithEvent.event.id,
        title: ticketWithEvent.event.title,
        venue: ticketWithEvent.event.venue,
        starts_at: ticketWithEvent.event.starts_at
      },
      access_window: {
        opens_at: new Date(eventStartTime.getTime() - 60 * 60000).toISOString(),
        closes_at: thirtyMinutesAfterStart.toISOString(),
        current_time: currentTime.toISOString()
      }
    });

  } catch (error) {
    console.error('Ticket verification error:', error);
    return res.status(500).json({ 
      valid: false,
      error: { message: 'Internal server error' } 
    });
  }
});

// POST /tickets/scan
// Mark a ticket as used (for event staff)
ticketRoutes.post('/scan', async (req: Request, res: Response) => {
  try {
    const { token, scanner_user_id } = req.body;

    if (!token) {
      return res.status(400).json({ 
        error: { message: 'QR token is required' } 
      });
    }

    console.log(`📱 Scanning ticket with token: ${token.substring(0, 8)}...`);

    // Verify ticket exists and is valid
    const ticketWithEvent = await findTicketByQRToken(token);

    if (!ticketWithEvent) {
      return res.status(404).json({
        success: false,
        error: { message: 'Ticket not found' }
      });
    }

    if (ticketWithEvent.status === 'used') {
      return res.status(400).json({
        success: false,
        error: { message: 'Ticket already used' },
        scanned_at: ticketWithEvent.scanned_at
      });
    }

    if (ticketWithEvent.status !== 'valid') {
      return res.status(400).json({
        success: false,
        error: { message: `Ticket is ${ticketWithEvent.status}` }
      });
    }

    // Check event timing
    const currentTime = new Date();
    const eventStartTime = new Date(ticketWithEvent.event.starts_at);
    const thirtyMinutesAfterStart = new Date(eventStartTime.getTime() + 30 * 60000);
    const oneHourBeforeStart = new Date(eventStartTime.getTime() - 60 * 60000);

    if (currentTime < oneHourBeforeStart) {
      return res.status(400).json({
        success: false,
        error: { message: 'Event entry not yet open' },
        opens_at: oneHourBeforeStart.toISOString()
      });
    }

    if (currentTime > thirtyMinutesAfterStart) {
      return res.status(400).json({
        success: false,
        error: { message: 'Event entry window has closed' },
        closed_at: thirtyMinutesAfterStart.toISOString()
      });
    }

    // Mark ticket as used
    const updatedTicket = await updateTicketStatus(token, 'used', scanner_user_id);

    if (!updatedTicket) {
      return res.status(500).json({
        success: false,
        error: { message: 'Failed to update ticket status' }
      });
    }

    console.log(`✅ Ticket ${updatedTicket.ticket_number} marked as used`);

    res.json({
      success: true,
      message: 'Ticket successfully scanned',
      ticket: {
        id: updatedTicket.id,
        ticket_number: updatedTicket.ticket_number,
        holder_name: updatedTicket.holder_name,
        status: updatedTicket.status,
        scanned_at: updatedTicket.scanned_at
      },
      event: {
        title: ticketWithEvent.event.title,
        venue: ticketWithEvent.event.venue,
        starts_at: ticketWithEvent.event.starts_at
      }
    });

  } catch (error) {
    console.error('Ticket scanning error:', error);
    res.status(500).json({ 
      success: false,
      error: { message: 'Internal server error' } 
    });
  }
});

// GET /tickets/qr/:token
// Generate QR code image for a ticket
ticketRoutes.get('/qr/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const { size = '200' } = req.query;

    // Validate ticket exists
    const ticket = await findTicketByQRToken(token);
    if (!ticket) {
      return res.status(404).json({ error: { message: 'Ticket not found' } });
    }

    // Generate QR code
    const qrCodeDataURL = await QRCode.toDataURL(token, {
      width: parseInt(size as string),
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    // Return as base64 data URL
    res.json({
      success: true,
      qr_code: qrCodeDataURL,
      ticket_number: ticket.ticket_number
    });

  } catch (error) {
    console.error('QR code generation error:', error);
    res.status(500).json({ 
      error: { message: 'Failed to generate QR code' } 
    });
  }
});

// GET /tickets/order/:order_id
// Get all tickets for an order
ticketRoutes.get('/order/:order_id', async (req: Request, res: Response) => {
  try {
    const { order_id } = req.params;
    
    // Validate order_id is a reasonable integer (not a timestamp)
    const orderIdNum = parseInt(order_id);
    if (isNaN(orderIdNum) || orderIdNum > 2147483647 || orderIdNum < 1) {
      return res.status(400).json({ 
        error: { message: 'Invalid order ID. Order ID must be a valid integer between 1 and 2147483647.' } 
      });
    }

    const db = getDatabase();
    // Get tickets with order info, handling both internal and external events
    const result = await db.query(`
      SELECT 
        t.*,
        COALESCE(e.title, o.external_event_title, 'Event Reservation') as event_title,
        COALESCE(e.venue, 'TBD') as venue,
        COALESCE(e.starts_at, CURRENT_TIMESTAMP) as starts_at,
        COALESCE(e.address, 'Address TBD') as address,
        o.buyer_name,
        o.buyer_email,
        o.amount_cents,
        o.status as order_status,
        o.external_event_id
      FROM tickets t
      JOIN orders o ON t.order_id = o.id
      LEFT JOIN events e ON t.event_id = e.id
      WHERE t.order_id = $1
      ORDER BY t.created_at
    `, [order_id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: { message: 'No tickets found for this order' } 
      });
    }

    const tickets = result.rows.map((row: any) => ({
      id: row.id,
      ticket_number: row.ticket_number,
      qr_token: row.qr_token,
      holder_name: row.holder_name,
      holder_email: row.holder_email,
      status: row.status,
      scanned_at: row.scanned_at,
      created_at: row.created_at,
      event: {
        id: 999999, // Mock event ID for external events
        title: row.event_title,
        venue: row.venue,
        starts_at: row.starts_at,
        price_cents: Math.floor(row.amount_cents / (result.rows.length || 1)) // Estimate price per ticket
      }
    }));

    const orderInfo = result.rows[0];

    res.json({
      success: true,
      order: {
        id: order_id,
        status: orderInfo.order_status,
        buyer_name: orderInfo.buyer_name,
        buyer_email: orderInfo.buyer_email,
        amount_cents: orderInfo.amount_cents,
        ticket_count: tickets.length
      },
      tickets: tickets
    });

  } catch (error) {
    console.error('Order tickets retrieval error:', error);
    res.status(500).json({ 
      error: { message: 'Internal server error' } 
    });
  }
});

// GET /tickets/event/:event_id/stats
// Get ticket statistics for an event (for hosts)
ticketRoutes.get('/event/:event_id/stats', async (req: Request, res: Response) => {
  try {
    const { event_id } = req.params;

    const db = getDatabase();
    
    // Get ticket statistics
    const statsResult = await db.query(`
      SELECT 
        COUNT(*) as total_tickets,
        COUNT(CASE WHEN status = 'valid' THEN 1 END) as valid_tickets,
        COUNT(CASE WHEN status = 'used' THEN 1 END) as used_tickets,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_tickets,
        COUNT(CASE WHEN status = 'refunded' THEN 1 END) as refunded_tickets
      FROM tickets
      WHERE event_id = $1
    `, [event_id]);

    // Get recent scans
    const recentScansResult = await db.query(`
      SELECT 
        t.ticket_number,
        t.holder_name,
        t.scanned_at,
        u.first_name as scanner_name
      FROM tickets t
      LEFT JOIN users u ON t.scanned_by_user_id = u.id
      WHERE t.event_id = $1 AND t.status = 'used'
      ORDER BY t.scanned_at DESC
      LIMIT 10
    `, [event_id]);

    const stats = statsResult.rows[0];
    const recentScans = recentScansResult.rows;

    res.json({
      success: true,
      stats: {
        total_tickets: parseInt(stats.total_tickets),
        valid_tickets: parseInt(stats.valid_tickets),
        used_tickets: parseInt(stats.used_tickets),
        cancelled_tickets: parseInt(stats.cancelled_tickets),
        refunded_tickets: parseInt(stats.refunded_tickets),
        usage_percentage: stats.total_tickets > 0 
          ? Math.round((stats.used_tickets / stats.total_tickets) * 100)
          : 0
      },
      recent_scans: recentScans.map((scan: {
        ticket_number: string;
        holder_name: string;
        scanned_at: string;
        scanner_name: string;
      }) => ({
        ticket_number: scan.ticket_number,
        holder_name: scan.holder_name,
        scanned_at: scan.scanned_at,
        scanner_name: scan.scanner_name
      }))
    });

  } catch (error) {
    console.error('Event ticket stats error:', error);
    res.status(500).json({ 
      error: { message: 'Internal server error' } 
    });
  }
});

// Debug endpoint to list all orders
ticketRoutes.get('/debug/orders', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const result = await db.query(`
      SELECT 
        id, 
        buyer_email, 
        external_event_id, 
        external_event_title,
        status, 
        amount_cents, 
        created_at,
        stripe_payment_intent_id
      FROM orders 
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    
    res.json({
      success: true,
      orders: result.rows
    });
  } catch (error) {
    console.error('Debug orders error:', error);
    res.status(500).json({ 
      error: { message: 'Internal server error' } 
    });
  }
});
