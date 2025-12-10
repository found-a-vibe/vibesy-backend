import { Router, Request, Response } from 'express';
import { logTime } from '../middleware/logger';
import { validateEmail, validateOTP } from '../middleware/validation';
import { verifyEmail } from '../middleware/emailVerifier';
import { emailService } from '../services/emailService';
import { otpService } from '../services/otpService';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/errors';
import { validateSchema, emailSchema, otpVerifySchema } from '../middleware/schemaValidation';

const router: ReturnType<typeof Router> = Router();

interface SendOTPRequest {
  email: string;
}

interface VerifyOTPRequest {
  email: string;
  otp: string;
}

interface OTPResponse {
  status: string;
  description: string;
  data?: {
    email: string;
    uid?: string;
    expiry?: Date;
  };
}

const sendOTPHandler = asyncHandler(async (req: Request, res: Response) => {
  const { email }: SendOTPRequest = req.body;

  if (!email) {
    throw new ApiError(400, 'Bad Request', 'Email is required');
  }

  const otpData = await otpService.generateOTP(email);
  await emailService.sendOTPEmail(email, otpData.code);

  const response: OTPResponse = {
    status: 'OK',
    description: `One-time passcode sent to ${email}`,
    data: {
      email,
      uid: (req as any).uid,
      expiry: otpData.expiresAt
    }
  };

  res.status(200).json(response);
});

const verifyOTPHandler = asyncHandler(async (req: Request, res: Response) => {
  const { email, otp }: VerifyOTPRequest = req.body;

  if (!email || !otp) {
    throw new ApiError(400, 'Bad Request', 'Email and OTP are required');
  }

  const isValid = await otpService.verifyOTP(email, otp);

  if (!isValid) {
    throw new ApiError(400, 'Bad Request', `One-time passcode is not valid or has expired for ${email}`);
  }

  const response: OTPResponse = {
    status: 'OK',
    description: 'One-time passcode successfully verified',
    data: {
      email,
      uid: (req as any).uid
    }
  };

  res.status(200).json(response);
});

router.post('/send', validateSchema(emailSchema), logTime, validateEmail, verifyEmail, sendOTPHandler);
router.post('/verify', validateSchema(otpVerifySchema), logTime, validateOTP, verifyEmail, verifyOTPHandler);

export { router as otpRoutes };