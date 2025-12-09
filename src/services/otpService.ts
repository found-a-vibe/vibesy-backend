import { redisClient } from '../repositories/redisRepository';
import { ApiError } from '../utils/errors';
import crypto from 'crypto';

interface OTPData {
  code: string;
  expiresAt: Date;
  attempts: number;
}

interface OTPResult {
  code: string;
  expiresAt: Date;
}

class OTPService {
  private readonly DEFAULT_EXPIRY_MINUTES = 5;
  private readonly MAX_ATTEMPTS = 3;
  private readonly OTP_LENGTH = 6;

  /**
   * Generate a secure OTP and store it in Redis
   */
  async generateOTP(identifier: string): Promise<OTPResult> {
    const normalizedKey = this.normalizeKey(identifier);
    
    // Generate cryptographically secure OTP
    const code = this.generateSecureOTP();
    const expiresAt = new Date(Date.now() + this.DEFAULT_EXPIRY_MINUTES * 60 * 1000);
    
    const otpData: OTPData = {
      code,
      expiresAt,
      attempts: 0
    };

    // Store with expiration
    const expirySeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    await redisClient.set(
      `otp:${normalizedKey}`, 
      JSON.stringify(otpData), 
      'EX', 
      expirySeconds
    );

    console.log(`OTP generated for ${identifier} (expires at ${expiresAt.toISOString()})`);
    
    return { code, expiresAt };
  }

  /**
   * Verify an OTP against the stored value
   */
  async verifyOTP(identifier: string, inputCode: string): Promise<boolean> {
    const normalizedKey = this.normalizeKey(identifier);
    const redisKey = `otp:${normalizedKey}`;
    
    const storedData = await redisClient.get(redisKey);
    
    if (!storedData) {
      console.log(`OTP verification failed: No OTP found for ${identifier}`);
      return false;
    }

    let otpData: OTPData;
    try {
      otpData = JSON.parse(storedData);
    } catch (error) {
      console.error('Error parsing OTP data:', error);
      await redisClient.del(redisKey);
      return false;
    }

    // Check if OTP has expired
    if (new Date() > new Date(otpData.expiresAt)) {
      console.log(`OTP verification failed: OTP expired for ${identifier}`);
      await redisClient.del(redisKey);
      return false;
    }

    // Check attempts limit
    if (otpData.attempts >= this.MAX_ATTEMPTS) {
      console.log(`OTP verification failed: Too many attempts for ${identifier}`);
      await redisClient.del(redisKey);
      throw new ApiError(429, 'Too Many Requests', 'Maximum OTP verification attempts exceeded');
    }

    // Verify the code using constant-time comparison
    const isValid = this.constantTimeCompare(inputCode, otpData.code);
    
    if (isValid) {
      // Delete OTP after successful verification
      await redisClient.del(redisKey);
      console.log(`OTP verified successfully for ${identifier}`);
      return true;
    } else {
      // Increment attempts and update in Redis
      otpData.attempts += 1;
      const expirySeconds = Math.floor((new Date(otpData.expiresAt).getTime() - Date.now()) / 1000);
      
      if (expirySeconds > 0) {
        await redisClient.set(redisKey, JSON.stringify(otpData), 'EX', expirySeconds);
      }
      
      console.log(`OTP verification failed: Invalid code for ${identifier} (attempt ${otpData.attempts})`);
      return false;
    }
  }

  /**
   * Check if an OTP exists for the given identifier
   */
  async hasOTP(identifier: string): Promise<boolean> {
    const normalizedKey = this.normalizeKey(identifier);
    const exists = await redisClient.exists(`otp:${normalizedKey}`);
    return exists === 1;
  }

  /**
   * Remove an OTP (useful for cleanup or cancellation)
   */
  async removeOTP(identifier: string): Promise<boolean> {
    const normalizedKey = this.normalizeKey(identifier);
    const deleted = await redisClient.del(`otp:${normalizedKey}`);
    return deleted === 1;
  }

  /**
   * Get remaining attempts for an OTP
   */
  async getRemainingAttempts(identifier: string): Promise<number> {
    const normalizedKey = this.normalizeKey(identifier);
    const storedData = await redisClient.get(`otp:${normalizedKey}`);
    
    if (!storedData) {
      return 0;
    }

    try {
      const otpData: OTPData = JSON.parse(storedData);
      return Math.max(0, this.MAX_ATTEMPTS - otpData.attempts);
    } catch (error) {
      console.error('Error parsing OTP data:', error);
      return 0;
    }
  }

  private generateSecureOTP(): string {
    // Generate cryptographically secure random number
    const randomBytes = crypto.randomBytes(4);
    const randomNumber = randomBytes.readUInt32BE(0);
    
    // Ensure OTP is exactly OTP_LENGTH digits
    return (randomNumber % Math.pow(10, this.OTP_LENGTH))
          .toString()
          .padStart(this.OTP_LENGTH, '0');
  }

  private normalizeKey(key: string): string {
    return key.toLowerCase().trim();
  }

  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return result === 0;
  }
}

export const otpService = new OTPService();
export default otpService;