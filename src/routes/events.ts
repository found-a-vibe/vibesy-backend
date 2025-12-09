import { Router, Request, Response } from 'express';
import { logTime } from '../middleware/logger';
import { fetchGoogleEvents, saveEventsBatch } from '../services/eventsService';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/errors';
import moment from 'moment-timezone';

const router: ReturnType<typeof Router> = Router();

interface FetchEventsResponse {
  status: string;
  description: string;
  events_count?: number;
  sync_time?: string;
}

const fetchEventsHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const now = moment().tz("America/New_York");
  console.log(`Running Vibesy event sync @ ${now.format()}`);

  const events = await fetchGoogleEvents();
  
  if (!events || events.length === 0) {
    console.warn("No events found to save.");
    res.status(200).json({
      status: "OK",
      description: "No events found to sync",
      events_count: 0,
      sync_time: now.format()
    } as FetchEventsResponse);
    return;
  }

  await saveEventsBatch(events);
  
  console.log(`Events synced manually: ${events.length} events`);
  
  res.status(200).json({
    status: "OK",
    description: "Events synced successfully",
    events_count: events.length,
    sync_time: now.format()
  } as FetchEventsResponse);
  return;
});

router.get('/fetch-events', logTime, fetchEventsHandler);

export { router as eventsRoutes };