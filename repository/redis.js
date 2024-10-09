const Redis = require('ioredis');

// Initialize the Redis client
const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT
});

module.exports = redis;