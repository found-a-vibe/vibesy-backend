import cron, { ScheduledTask } from 'node-cron';
import moment from 'moment-timezone';
import { eventsService } from '../services/eventsService';
import { createLogEntry } from '../middleware/logger';
import { ApiError } from '../utils/errors';

interface JobStats {
  lastRun?: Date;
  lastSuccess?: Date;
  lastError?: Date;
  successCount: number;
  errorCount: number;
  totalEventsProcessed: number;
}

class EventSyncJob {
  private stats: JobStats = {
    successCount: 0,
    errorCount: 0,
    totalEventsProcessed: 0
  };

  private isRunning = false;
  private task: ScheduledTask | null = null;
  private readonly timezone = 'America/New_York';
  private readonly cronExpression = '0 0 * * *'; // Run daily at midnight EST

  constructor() {
    console.log('EventSyncJob initialized');
  }

  /**
   * Start the scheduled event sync job
   */
  start(): void {
    if (this.task) {
      console.log('Event sync job is already running');
      return;
    }

    try {
      this.task = cron.schedule(this.cronExpression, () => {
        this.runSync();
      }, {
        timezone: this.timezone
      });

      createLogEntry('info', 'Event sync cron job started', {
        schedule: this.cronExpression,
        timezone: this.timezone
      });

      console.log(`Event sync job scheduled: ${this.cronExpression} (${this.timezone})`);
    } catch (error) {
      console.error('Failed to start event sync job:', error);
      throw new ApiError(500, 'Job Scheduler Error', 'Failed to start event sync job');
    }
  }

  /**
   * Stop the scheduled job
   */
  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
      createLogEntry('info', 'Event sync cron job stopped');
      console.log('Event sync job stopped');
    }
  }

  /**
   * Run the sync job immediately (for testing or manual trigger)
   */
  async runNow(): Promise<{ success: boolean; eventsProcessed?: number; error?: string }> {
    if (this.isRunning) {
      throw new ApiError(409, 'Job Already Running', 'Event sync job is already in progress');
    }

    return await this.runSync();
  }

  /**
   * Main sync execution logic
   */
  private async runSync(): Promise<{ success: boolean; eventsProcessed?: number; error?: string }> {
    if (this.isRunning) {
      console.log('Event sync job already running, skipping this execution');
      return { success: false, error: 'Job already running' };
    }

    this.isRunning = true;
    this.stats.lastRun = new Date();

    const now = moment().tz(this.timezone);
    const startTime = Date.now();

    createLogEntry('info', `Starting event sync job`, {
      scheduledTime: now.format(),
      timezone: this.timezone
    });

    try {
      // Fetch events from external API
      const events = await eventsService.fetchGoogleEvents();

      if (!events || events.length === 0) {
        createLogEntry('info', 'No events found to sync');
        this.stats.lastSuccess = new Date();
        this.stats.successCount++;
        return { success: true, eventsProcessed: 0 };
      }

      // Save events to database
      await eventsService.saveEventsBatch(events);

      // Update statistics
      const duration = Date.now() - startTime;
      this.stats.lastSuccess = new Date();
      this.stats.successCount++;
      this.stats.totalEventsProcessed += events.length;

      createLogEntry('info', `Event sync job completed successfully`, {
        eventsProcessed: events.length,
        duration: `${duration}ms`,
        totalProcessed: this.stats.totalEventsProcessed,
        successCount: this.stats.successCount
      });

      console.log(`✅ Event sync completed: ${events.length} events processed in ${duration}ms`);

      return { success: true, eventsProcessed: events.length };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.stats.lastError = new Date();
      this.stats.errorCount++;

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      createLogEntry('error', `Event sync job failed`, {
        error: errorMessage,
        duration: `${duration}ms`,
        errorCount: this.stats.errorCount,
        lastSuccess: this.stats.lastSuccess?.toISOString()
      });

      console.error(`❌ Event sync failed after ${duration}ms:`, error);

      // Don't throw - let the job continue to retry on next schedule
      return { success: false, error: errorMessage };

    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get job statistics
   */
  getStats(): JobStats {
    return { ...this.stats };
  }

  /**
   * Get job status
   */
  getStatus(): {
    isRunning: boolean;
    isScheduled: boolean;
    nextRun: string | null;
    stats: JobStats;
  } {
    let nextRun: string | null = null;
    
    if (this.task) {
      // For simplicity, just indicate that it's scheduled
      // Getting exact next run time from node-cron is complex
      nextRun = 'Scheduled according to cron expression';
    }

    return {
      isRunning: this.isRunning,
      isScheduled: this.task !== null,
      nextRun,
      stats: this.getStats()
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      successCount: 0,
      errorCount: 0,
      totalEventsProcessed: 0
    };
    createLogEntry('info', 'Event sync job statistics reset');
  }

  /**
   * Update schedule (stop and start with new schedule)
   */
  updateSchedule(newCronExpression: string): void {
    if (!cron.validate(newCronExpression)) {
      throw new ApiError(400, 'Invalid Cron Expression', 'The provided cron expression is invalid');
    }

    const wasRunning = this.task !== null;
    
    if (wasRunning) {
      this.stop();
    }

    // Update the cron expression
    (this as any).cronExpression = newCronExpression;

    if (wasRunning) {
      this.start();
    }

    createLogEntry('info', 'Event sync job schedule updated', {
      newSchedule: newCronExpression,
      timezone: this.timezone
    });
  }
}

// Create singleton instance
export const eventSyncJob = new EventSyncJob();

// Export for testing and manual control
export default eventSyncJob;