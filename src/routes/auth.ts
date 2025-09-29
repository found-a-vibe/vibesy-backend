import { Router, Request, Response } from 'express';
import { logTime } from '../middleware/logger';
import { validatePasswordReset } from '../middleware/validation';
import { adminService } from '../services/adminService';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/errors';

const router = Router();

interface PasswordResetRequest {
  uid: string;
  password: string;
}

interface ApiResponse {
  status: string;
  description: string;
  data?: any;
}

const resetPasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  const { uid, password }: PasswordResetRequest = req.body;

  if (!uid || !password) {
    throw new ApiError(400, 'Bad Request', 'User ID and password are required');
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

router.post('/reset-password', logTime, validatePasswordReset, resetPasswordHandler);

export { router as authRoutes };