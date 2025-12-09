import { Router, Response } from 'express';
import { logTime } from '../middleware/logger';
import { validatePasswordReset } from '../middleware/validation';
import { adminService } from '../services/adminService';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/errors';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router: ReturnType<typeof Router> = Router();

interface PasswordResetRequest {
  uid: string;
  password: string;
}

interface ApiResponse {
  status: string;
  description: string;
  data?: any;
}

const resetPasswordHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { uid, password }: PasswordResetRequest = req.body;

  if (!uid || !password) {
    throw new ApiError(400, 'Bad Request', 'User ID and password are required');
  }

  // SECURITY: Verify user is resetting their OWN password
  if (!req.user || req.user.uid !== uid) {
    throw new ApiError(403, 'Forbidden', 'Cannot reset another user\'s password');
  }

  const userRecord = await adminService.auth().updateUser(uid, { password });
  
  if (!userRecord) {
    throw new ApiError(500, 'Internal Server Error', 'Failed to update user password');
  }

  const response: ApiResponse = {
    status: 'OK',
    description: "User's password has been successfully updated",
    data: { uid: userRecord.uid }
  };

  res.status(200).json(response);
});

router.post('/reset-password', requireAuth, logTime, validatePasswordReset, resetPasswordHandler);

export { router as authRoutes };