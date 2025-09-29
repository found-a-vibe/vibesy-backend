import { eventSyncJob } from './eventSyncJob';
import { createLogEntry } from '../middleware/logger';

interface JobManager {
  name: string;
  instance: any;
  description: string;
  isEnabled: boolean;
}

class JobScheduler {
  private jobs: Map<string, JobManager> = new Map();
  private isInitialized = false;

  constructor() {
    this.registerJobs();
  }

  /**
   * Register all available jobs
   */
  private registerJobs(): void {
    this.jobs.set('eventSync', {
      name: 'eventSync',
      instance: eventSyncJob,
      description: 'Synchronizes events from external sources',
      isEnabled: process.env.ENABLE_EVENT_SYNC !== 'false' // Enabled by default
    });

    createLogEntry('info', `Job scheduler initialized with ${this.jobs.size} jobs`, {
      jobs: Array.from(this.jobs.keys())
    });
  }

  /**
   * Start all enabled jobs
   */
  startAll(): void {
    if (this.isInitialized) {
      console.log('Job scheduler already initialized');
      return;
    }

    let startedCount = 0;
    let skippedCount = 0;

    for (const [jobName, jobManager] of this.jobs.entries()) {
      try {
        if (jobManager.isEnabled) {
          jobManager.instance.start();
          startedCount++;
          createLogEntry('info', `Started job: ${jobName}`, {
            description: jobManager.description
          });
        } else {
          skippedCount++;
          createLogEntry('info', `Skipped disabled job: ${jobName}`, {
            description: jobManager.description
          });
        }
      } catch (error) {
        console.error(`Failed to start job ${jobName}:`, error);
        createLogEntry('error', `Failed to start job: ${jobName}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          description: jobManager.description
        });
      }
    }

    this.isInitialized = true;

    createLogEntry('info', 'Job scheduler startup complete', {
      totalJobs: this.jobs.size,
      startedJobs: startedCount,
      skippedJobs: skippedCount
    });

    console.log(`✅ Job scheduler started: ${startedCount} jobs running, ${skippedCount} skipped`);
  }

  /**
   * Stop all running jobs
   */
  stopAll(): void {
    let stoppedCount = 0;

    for (const [jobName, jobManager] of this.jobs.entries()) {
      try {
        if (jobManager.instance && typeof jobManager.instance.stop === 'function') {
          jobManager.instance.stop();
          stoppedCount++;
          createLogEntry('info', `Stopped job: ${jobName}`);
        }
      } catch (error) {
        console.error(`Failed to stop job ${jobName}:`, error);
        createLogEntry('error', `Failed to stop job: ${jobName}`, {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    this.isInitialized = false;

    createLogEntry('info', 'Job scheduler stopped', {
      stoppedJobs: stoppedCount
    });

    console.log(`🛑 Job scheduler stopped: ${stoppedCount} jobs stopped`);
  }

  /**
   * Get status of all jobs
   */
  getStatus(): Record<string, any> {
    const status: Record<string, any> = {
      isInitialized: this.isInitialized,
      totalJobs: this.jobs.size,
      jobs: {}
    };

    for (const [jobName, jobManager] of this.jobs.entries()) {
      try {
        status.jobs[jobName] = {
          name: jobName,
          description: jobManager.description,
          isEnabled: jobManager.isEnabled,
          status: jobManager.instance && typeof jobManager.instance.getStatus === 'function' 
            ? jobManager.instance.getStatus()
            : 'Unknown'
        };
      } catch (error) {
        status.jobs[jobName] = {
          name: jobName,
          description: jobManager.description,
          isEnabled: jobManager.isEnabled,
          status: 'Error',
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }

    return status;
  }

  /**
   * Start a specific job
   */
  startJob(jobName: string): boolean {
    const jobManager = this.jobs.get(jobName);
    
    if (!jobManager) {
      throw new Error(`Job not found: ${jobName}`);
    }

    if (!jobManager.isEnabled) {
      throw new Error(`Job is disabled: ${jobName}`);
    }

    try {
      if (jobManager.instance && typeof jobManager.instance.start === 'function') {
        jobManager.instance.start();
        createLogEntry('info', `Manually started job: ${jobName}`);
        return true;
      }
      throw new Error(`Job does not support start operation: ${jobName}`);
    } catch (error) {
      createLogEntry('error', `Failed to start job: ${jobName}`, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Stop a specific job
   */
  stopJob(jobName: string): boolean {
    const jobManager = this.jobs.get(jobName);
    
    if (!jobManager) {
      throw new Error(`Job not found: ${jobName}`);
    }

    try {
      if (jobManager.instance && typeof jobManager.instance.stop === 'function') {
        jobManager.instance.stop();
        createLogEntry('info', `Manually stopped job: ${jobName}`);
        return true;
      }
      throw new Error(`Job does not support stop operation: ${jobName}`);
    } catch (error) {
      createLogEntry('error', `Failed to stop job: ${jobName}`, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Run a specific job immediately
   */
  async runJobNow(jobName: string): Promise<any> {
    const jobManager = this.jobs.get(jobName);
    
    if (!jobManager) {
      throw new Error(`Job not found: ${jobName}`);
    }

    if (!jobManager.isEnabled) {
      throw new Error(`Job is disabled: ${jobName}`);
    }

    try {
      if (jobManager.instance && typeof jobManager.instance.runNow === 'function') {
        createLogEntry('info', `Manually triggered job: ${jobName}`);
        const result = await jobManager.instance.runNow();
        createLogEntry('info', `Manual job execution completed: ${jobName}`, { result });
        return result;
      }
      throw new Error(`Job does not support manual execution: ${jobName}`);
    } catch (error) {
      createLogEntry('error', `Failed to run job: ${jobName}`, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get specific job status
   */
  getJobStatus(jobName: string): any {
    const jobManager = this.jobs.get(jobName);
    
    if (!jobManager) {
      throw new Error(`Job not found: ${jobName}`);
    }

    try {
      return {
        name: jobName,
        description: jobManager.description,
        isEnabled: jobManager.isEnabled,
        status: jobManager.instance && typeof jobManager.instance.getStatus === 'function' 
          ? jobManager.instance.getStatus()
          : 'Status not available'
      };
    } catch (error) {
      return {
        name: jobName,
        description: jobManager.description,
        isEnabled: jobManager.isEnabled,
        status: 'Error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Enable or disable a job
   */
  setJobEnabled(jobName: string, enabled: boolean): void {
    const jobManager = this.jobs.get(jobName);
    
    if (!jobManager) {
      throw new Error(`Job not found: ${jobName}`);
    }

    const wasEnabled = jobManager.isEnabled;
    jobManager.isEnabled = enabled;

    createLogEntry('info', `Job ${enabled ? 'enabled' : 'disabled'}: ${jobName}`, {
      previousState: wasEnabled,
      newState: enabled
    });

    // If job was running and now disabled, stop it
    if (wasEnabled && !enabled && jobManager.instance && typeof jobManager.instance.stop === 'function') {
      try {
        jobManager.instance.stop();
      } catch (error) {
        console.error(`Failed to stop disabled job ${jobName}:`, error);
      }
    }

    // If job was disabled and now enabled, start it (if scheduler is initialized)
    if (!wasEnabled && enabled && this.isInitialized && jobManager.instance && typeof jobManager.instance.start === 'function') {
      try {
        jobManager.instance.start();
      } catch (error) {
        console.error(`Failed to start enabled job ${jobName}:`, error);
      }
    }
  }

  /**
   * Get list of all job names
   */
  getJobNames(): string[] {
    return Array.from(this.jobs.keys());
  }

  /**
   * Check if scheduler is initialized
   */
  getIsInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    createLogEntry('info', 'Starting job scheduler shutdown...');
    
    this.stopAll();
    
    // Wait a bit for jobs to finish gracefully
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    createLogEntry('info', 'Job scheduler shutdown complete');
  }
}

// Create singleton instance
export const jobScheduler = new JobScheduler();

// Handle process signals for graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down job scheduler...');
  await jobScheduler.shutdown();
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down job scheduler...');
  await jobScheduler.shutdown();
});

export default jobScheduler;