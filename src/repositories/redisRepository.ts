import Redis from 'ioredis';
import { ApiError } from '../utils/errors';

class RedisRepository {
  private client: Redis | null = null;
  private connecting = false;
  private connectionPromise: Promise<Redis> | null = null;

  async connect(): Promise<Redis> {
    if (this.client && this.client.status === 'ready') {
      return this.client;
    }

    if (this.connecting && this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connecting = true;
    this.connectionPromise = this.createConnection();

    try {
      this.client = await this.connectionPromise;
      this.connecting = false;
      return this.client;
    } catch (error) {
      this.connecting = false;
      this.connectionPromise = null;
      throw error;
    }
  }

  private async createConnection(): Promise<Redis> {
    const redisUrl = process.env.REDIS_URL;
    
    if (!redisUrl) {
      throw new ApiError(500, 'Configuration Error', 'REDIS_URL environment variable is not set');
    }

    try {
      const redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        keepAlive: 30000,
        connectTimeout: 10000,
        commandTimeout: 5000,
      });

      // Event listeners for connection management
      redis.on('connect', () => {
        console.log('Redis client connected successfully');
      });

      redis.on('ready', () => {
        console.log('Redis client ready to receive commands');
      });

      redis.on('error', (error) => {
        console.error('Redis connection error:', error);
      });

      redis.on('close', () => {
        console.log('Redis connection closed');
      });

      redis.on('reconnecting', (delay: number) => {
        console.log(`Redis reconnecting in ${delay}ms`);
      });

      // Connect to Redis
      await redis.connect();
      
      console.log('Redis repository initialized successfully');
      return redis;
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
      throw new ApiError(500, 'Database Connection Error', 'Failed to connect to Redis');
    }
  }

  async get(key: string): Promise<string | null> {
    const client = await this.connect();
    
    try {
      return await client.get(key);
    } catch (error) {
      console.error(`Redis GET error for key ${key}:`, error);
      throw new ApiError(500, 'Database Error', 'Failed to get value from Redis');
    }
  }

  async set(key: string, value: string, mode?: string, duration?: number): Promise<'OK'> {
    const client = await this.connect();
    
    try {
      if (mode && duration) {
        // mode should be either 'EX' or 'PX'
        if (mode === 'EX') {
          return await client.set(key, value, 'EX', duration);
        } else if (mode === 'PX') {
          return await client.set(key, value, 'PX', duration);
        } else {
          throw new ApiError(400, 'Invalid Mode', 'Mode must be "EX" or "PX"');
        }
      }
      return await client.set(key, value);
    } catch (error) {
      console.error(`Redis SET error for key ${key}:`, error);
      throw new ApiError(500, 'Database Error', 'Failed to set value in Redis');
    }
  }

  async del(key: string): Promise<number> {
    const client = await this.connect();
    
    try {
      return await client.del(key);
    } catch (error) {
      console.error(`Redis DEL error for key ${key}:`, error);
      throw new ApiError(500, 'Database Error', 'Failed to delete key from Redis');
    }
  }

  async exists(key: string): Promise<number> {
    const client = await this.connect();
    
    try {
      return await client.exists(key);
    } catch (error) {
      console.error(`Redis EXISTS error for key ${key}:`, error);
      throw new ApiError(500, 'Database Error', 'Failed to check key existence in Redis');
    }
  }

  async expire(key: string, seconds: number): Promise<number> {
    const client = await this.connect();
    
    try {
      return await client.expire(key, seconds);
    } catch (error) {
      console.error(`Redis EXPIRE error for key ${key}:`, error);
      throw new ApiError(500, 'Database Error', 'Failed to set expiration in Redis');
    }
  }

  async ttl(key: string): Promise<number> {
    const client = await this.connect();
    
    try {
      return await client.ttl(key);
    } catch (error) {
      console.error(`Redis TTL error for key ${key}:`, error);
      throw new ApiError(500, 'Database Error', 'Failed to get TTL from Redis');
    }
  }

  async hget(key: string, field: string): Promise<string | null> {
    const client = await this.connect();
    
    try {
      return await client.hget(key, field);
    } catch (error) {
      console.error(`Redis HGET error for key ${key}, field ${field}:`, error);
      throw new ApiError(500, 'Database Error', 'Failed to get hash field from Redis');
    }
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    const client = await this.connect();
    
    try {
      return await client.hset(key, field, value);
    } catch (error) {
      console.error(`Redis HSET error for key ${key}, field ${field}:`, error);
      throw new ApiError(500, 'Database Error', 'Failed to set hash field in Redis');
    }
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const client = await this.connect();
    
    try {
      return await client.hgetall(key);
    } catch (error) {
      console.error(`Redis HGETALL error for key ${key}:`, error);
      throw new ApiError(500, 'Database Error', 'Failed to get hash from Redis');
    }
  }

  async incr(key: string): Promise<number> {
    const client = await this.connect();
    
    try {
      return await client.incr(key);
    } catch (error) {
      console.error(`Redis INCR error for key ${key}:`, error);
      throw new ApiError(500, 'Database Error', 'Failed to increment key in Redis');
    }
  }

  async decr(key: string): Promise<number> {
    const client = await this.connect();
    
    try {
      return await client.decr(key);
    } catch (error) {
      console.error(`Redis DECR error for key ${key}:`, error);
      throw new ApiError(500, 'Database Error', 'Failed to decrement key in Redis');
    }
  }

  async keys(pattern: string): Promise<string[]> {
    const client = await this.connect();
    
    try {
      return await client.keys(pattern);
    } catch (error) {
      console.error(`Redis KEYS error for pattern ${pattern}:`, error);
      throw new ApiError(500, 'Database Error', 'Failed to get keys from Redis');
    }
  }

  async flushdb(): Promise<'OK'> {
    const client = await this.connect();
    
    try {
      return await client.flushdb();
    } catch (error) {
      console.error('Redis FLUSHDB error:', error);
      throw new ApiError(500, 'Database Error', 'Failed to flush Redis database');
    }
  }

  async ping(): Promise<'PONG'> {
    const client = await this.connect();
    
    try {
      return await client.ping();
    } catch (error) {
      console.error('Redis PING error:', error);
      throw new ApiError(500, 'Database Error', 'Redis health check failed');
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
        console.log('Redis client disconnected successfully');
      } catch (error) {
        console.error('Error disconnecting Redis client:', error);
      } finally {
        this.client = null;
        this.connectionPromise = null;
        this.connecting = false;
      }
    }
  }

  getConnectionStatus(): string {
    return this.client?.status || 'disconnected';
  }

  isConnected(): boolean {
    return this.client?.status === 'ready';
  }
}

// Create singleton instance
const redisRepository = new RedisRepository();

// Export both the instance and the class
export { redisRepository as redisClient, RedisRepository };
export default redisRepository;