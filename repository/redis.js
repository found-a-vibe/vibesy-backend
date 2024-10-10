const Redis = require('ioredis');

// Initialize the Redis client
const redis = new Redis(process.env.REDIS_URL);

module.exports = redis;