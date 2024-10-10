const Redis = require('ioredis');

// Initialize the Redis client
const redis = new Redis({
  url: process.env.REDIS_URL
});

module.exports = redis;