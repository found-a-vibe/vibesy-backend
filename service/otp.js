const redis = require('../repository/redis');
/**
 * Function to generate a 4-digit OTP and store it in Redis
 * @param {string} key - Unique identifier for the OTP (e.g., userID, phone number)
 * @returns {Promise<string>} - Generated OTP
 */
async function generateOTP(key) {
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const expiry = 300;

  // Store OTP in Redis with an expiry time of 5 minutes
  await redis.set(key.toLowerCase(), otp, 'EX', expiry);

  console.log(`OTP for key ${key} is ${otp}`);
  return otp;
}

/**
 * Function to verify a given OTP against the stored value in Redis
 * @param {string} key - Unique identifier used to store the OTP
 * @param {string} input - OTP entered by the user
 * @returns {Promise<boolean>} - True if OTP is valid, false otherwise
 */
async function verifyOTP(key, input) {
  const otp = await redis.get(key.toLowerCase());
  if (input === otp) {
    await redis.del(key);
    return true;
  }
  return false;
}

module.exports = {
  generateOTP,
  verifyOTP
}