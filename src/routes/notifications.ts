import { Router, Request, Response } from 'express';
import { logTime } from '../middleware/logger';
import { validateNotificationRequest } from '../middleware/validation';
import { notificationService } from '../services/notificationService';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/errors';

const router = Router();

interface NotificationRequest {
  title: string;
  body: string;
  toUserId: string;
  fromUserId: string;
  metadata?: Record<string, any>;
}

interface NotificationResponse {
  status: string;
  description: string;
  messageId?: string;
}

const sendNotificationHandler = asyncHandler(async (req: Request, res: Response) => {
  const { title, body, toUserId, fromUserId, metadata }: NotificationRequest = req.body;

  if (!title || !body || !toUserId || !fromUserId) {
    throw new ApiError(400, 'Bad Request', 'title, body, toUserId, and fromUserId are required');
  }

  const result = await notificationService.sendNotification({
    title,
    body,
    toUserId,
    fromUserId,
    metadata
  });

  const response: NotificationResponse = {
    status: 'OK',
    description: 'Notification sent successfully',
    messageId: result.messageId
  };

  res.status(200).json(response);
});

router.post('/send', logTime, validateNotificationRequest, sendNotificationHandler);

export { router as notificationRoutes };