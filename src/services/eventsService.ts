import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import sharp from 'sharp';
import { adminService } from './adminService';
import { ApiError } from '../utils/errors';

interface GoogleEvent {
  title: string;
  description?: string;
  date?: {
    start_date?: string;
    when?: string;
  };
  address?: string[];
  image?: string;
  thumbnail?: string;
  ticket_info?: Array<{
    link?: string;
  }>;
  link?: string;
}

interface ProcessedEvent {
  id: string;
  title: string;
  description: string;
  date: string;
  timeRange: string;
  location: string;
  images: string[];
  hashtags: string[];
  guests: string[];
  priceDetails: Array<{
    title: string;
    price: string;
    link: string;
  }>;
  likes: string[];
  interactions: string[];
  createdBy: string;
  source: string;
}

class EventsService {
  private readonly MAX_IMAGE_SIZE_MB = 5;
  private readonly SUPPORTED_IMAGE_FORMATS = ['jpeg', 'jpg', 'png', 'webp'];
  private readonly IMAGE_QUALITY = 80;

  async fetchGoogleEvents(): Promise<GoogleEvent[]> {
    const apiKey = process.env.SERPAPI_KEY;
    if (!apiKey) {
      throw new ApiError(500, 'Configuration Error', 'SERPAPI_KEY is not configured');
    }

    const url = `https://serpapi.com/search.json?engine=google_events&q=Events%2Bin%2BAtlanta&hl=en&gl=us&htichips=date%3Amonth&api_key=${apiKey}`;

    try {
      console.log('Fetching events from SerpAPI...');
      const response = await axios.get(url, { 
        timeout: 30000,
        headers: {
          'User-Agent': 'vibesy-backend/1.0.0'
        }
      });

      if (!response.data || !response.data.events_results) {
        console.warn('No events found in SerpAPI response');
        return [];
      }

      const events = response.data.events_results as GoogleEvent[];
      console.log(`Fetched ${events.length} events from SerpAPI`);
      
      return events;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('SerpAPI request failed:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data
        });
        
        if (error.response?.status === 401) {
          throw new ApiError(500, 'Configuration Error', 'Invalid SerpAPI key');
        }
        
        throw new ApiError(500, 'External API Error', 'Failed to fetch events from SerpAPI');
      }
      
      console.error('Unexpected error fetching events:', error);
      throw new ApiError(500, 'Service Error', 'Unexpected error while fetching events');
    }
  }

  async saveEventsBatch(googleEvents: GoogleEvent[]): Promise<void> {
    if (!googleEvents.length) {
      console.warn('⚠️  No events to save');
      return;
    }

    const db = adminService.firestore();
    const batch = db.batch();
    let savedCount = 0;

    try {
      for (const googleEvent of googleEvents) {
        try {
          const processedEvent = await this.processEvent(googleEvent);
          const eventRef = db.collection('events').doc(processedEvent.id);
          
          batch.set(eventRef, processedEvent, { merge: true });
          savedCount++;
          
          console.log(`Processed event: ${processedEvent.title}`);
        } catch (error) {
          console.error(`Failed to process event: ${googleEvent.title}`, error);
          // Continue with other events even if one fails
        }
      }

      if (savedCount > 0) {
        await batch.commit();
        console.log(`✅ Successfully saved ${savedCount} events to Firestore`);
      } else {
        console.warn('⚠️  No events were successfully processed');
      }
    } catch (error) {
      console.error('Error saving events batch:', error);
      throw new ApiError(500, 'Database Error', 'Failed to save events to database');
    }
  }

  private async processEvent(googleEvent: GoogleEvent): Promise<ProcessedEvent> {
    const eventId = uuidv4();
    let bucketImageUrl = '';

    // Process image if available
    const imageUrl = googleEvent.image || googleEvent.thumbnail;
    if (imageUrl) {
      try {
        bucketImageUrl = await this.uploadImageFromUrl(imageUrl, eventId);
      } catch (error) {
        console.warn(`Failed to upload image for event: ${googleEvent.title}`, error);
        // Continue without image
      }
    }

    return {
      id: eventId,
      title: googleEvent.title || 'Untitled Event',
      description: googleEvent.description || '',
      date: googleEvent.date?.start_date || '',
      timeRange: googleEvent.date?.when || '',
      location: Array.isArray(googleEvent.address) ? googleEvent.address.join(', ') : '',
      images: bucketImageUrl ? [bucketImageUrl] : [],
      hashtags: [],
      guests: [],
      priceDetails: [{
        title: '',
        price: '',
        link: googleEvent.ticket_info?.[0]?.link || '',
      }],
      likes: [],
      interactions: [],
      createdBy: '',
      source: googleEvent.link || '',
    };
  }

  private async uploadImageFromUrl(imageUrl: string, eventId: string): Promise<string> {
    if (!imageUrl) {
      throw new Error('Image URL is required');
    }

    const bucket = adminService.storage().bucket();
    const filename = `event_images/${eventId}/image_${uuidv4()}.jpg`;
    
    try {
      console.log(`Downloading image: ${imageUrl}`);
      
      // Download image with timeout and size limit
      const response = await axios.get(imageUrl, { 
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: this.MAX_IMAGE_SIZE_MB * 1024 * 1024,
        headers: {
          'User-Agent': 'vibesy-backend/1.0.0'
        }
      });

      // Process image with Sharp
      const processedBuffer = await sharp(response.data)
        .resize(1200, 800, { 
          fit: 'inside',
          withoutEnlargement: true 
        })
        .jpeg({ 
          quality: this.IMAGE_QUALITY,
          progressive: true 
        })
        .toBuffer();

      // Upload to Firebase Storage
      const file = bucket.file(filename);
      await file.save(processedBuffer, {
        metadata: { 
          contentType: 'image/jpeg',
          cacheControl: 'public, max-age=31536000', // 1 year cache
        },
      });

      // Make file publicly accessible
      await file.makePublic();

      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;
      console.log(`✅ Image uploaded: ${publicUrl}`);

      return publicUrl;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(`Failed to download image from ${imageUrl}:`, {
          status: error.response?.status,
          statusText: error.response?.statusText
        });
      } else {
        console.error(`Error processing image from ${imageUrl}:`, error);
      }
      
      throw new Error(`Failed to upload image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getEventById(eventId: string): Promise<ProcessedEvent | null> {
    try {
      const db = adminService.firestore();
      const eventRef = db.collection('events').doc(eventId);
      const eventSnap = await eventRef.get();
      
      if (!eventSnap.exists) {
        return null;
      }
      
      return eventSnap.data() as ProcessedEvent;
    } catch (error) {
      console.error(`Error fetching event ${eventId}:`, error);
      throw new ApiError(500, 'Database Error', 'Failed to fetch event');
    }
  }

  async getEventsByLocation(location: string, limit: number = 50): Promise<ProcessedEvent[]> {
    try {
      const db = adminService.firestore();
      const eventsRef = db.collection('events')
        .where('location', '>=', location)
        .where('location', '<', location + '\uf8ff')
        .limit(limit);
      
      const snapshot = await eventsRef.get();
      const events: ProcessedEvent[] = [];
      
      snapshot.forEach(doc => {
        events.push(doc.data() as ProcessedEvent);
      });
      
      return events;
    } catch (error) {
      console.error(`Error fetching events by location ${location}:`, error);
      throw new ApiError(500, 'Database Error', 'Failed to fetch events by location');
    }
  }
}

export const eventsService = new EventsService();

// Export functions for backward compatibility
export const fetchGoogleEvents = () => eventsService.fetchGoogleEvents();
export const saveEventsBatch = (events: GoogleEvent[]) => eventsService.saveEventsBatch(events);

export default eventsService;