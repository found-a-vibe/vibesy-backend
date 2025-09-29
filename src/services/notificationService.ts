import { adminService } from './adminService';
import { ApiError } from '../utils/errors';

interface NotificationData {
  title: string;
  body: string;
  toUserId: string;
  fromUserId: string;
  metadata?: Record<string, any>;
  imageUrl?: string;
  action?: {
    type: string;
    url?: string;
    data?: Record<string, any>;
  };
}

interface NotificationResult {
  messageId: string;
  success: boolean;
  recipientToken?: string;
}

interface UserProfile {
  fullName?: string;
  firstName?: string;
  lastName?: string;
}

interface FCMTokenData {
  fcmToken: string;
  deviceId?: string;
  platform?: 'ios' | 'android';
  updatedAt?: Date;
}

class NotificationService {
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 1000;

  async sendNotification(data: NotificationData): Promise<NotificationResult> {
    const { title, body, toUserId, fromUserId, metadata, imageUrl, action } = data;

    try {
      // Get recipient's FCM token
      const recipientToken = await this.getFCMToken(toUserId);
      if (!recipientToken) {
        throw new ApiError(400, 'Notification Error', 'Recipient has no FCM token');
      }

      // Get sender's profile information
      const senderProfile = await this.getUserProfile(fromUserId);
      const senderName = senderProfile?.fullName || 
                        `${senderProfile?.firstName || ''} ${senderProfile?.lastName || ''}`.trim() || 
                        'Someone';

      // Prepare notification message
      const message = {
        notification: {
          title: title,
          body: `${body} from ${senderName}`,
          ...(imageUrl && { imageUrl })
        },
        data: {
          fromUserId,
          toUserId,
          senderName,
          type: action?.type || 'general',
          ...(metadata && { metadata: JSON.stringify(metadata) }),
          ...(action?.data && { actionData: JSON.stringify(action.data) }),
          ...(action?.url && { actionUrl: action.url })
        },
        token: recipientToken,
        android: {
          notification: {
            sound: 'default',
            priority: 'high' as const,
            channelId: 'default'
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
              'content-available': 1
            }
          }
        }
      };

      // Send notification with retry logic
      const messageId = await this.sendWithRetry(message);

      // Log successful notification
      console.log(`Notification sent successfully from ${fromUserId} to ${toUserId}: ${messageId}`);

      // Store notification in database for history
      await this.storeNotificationHistory({
        messageId,
        fromUserId,
        toUserId,
        title,
        body,
        sentAt: new Date(),
        metadata
      });

      return {
        messageId,
        success: true,
        recipientToken
      };
    } catch (error) {
      console.error('Error sending notification:', error);
      
      if (error instanceof ApiError) {
        throw error;
      }
      
      throw new ApiError(500, 'Notification Error', 'Failed to send notification');
    }
  }

  async sendBulkNotification(
    title: string, 
    body: string, 
    userIds: string[], 
    fromUserId?: string,
    metadata?: Record<string, any>
  ): Promise<{ successful: number; failed: number; results: NotificationResult[] }> {
    const results: NotificationResult[] = [];
    let successful = 0;
    let failed = 0;

    // Process in batches to avoid overwhelming Firebase
    const BATCH_SIZE = 500;
    
    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batch = userIds.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(async (userId) => {
        try {
          const result = await this.sendNotification({
            title,
            body,
            toUserId: userId,
            fromUserId: fromUserId || 'system',
            metadata
          });
          successful++;
          return result;
        } catch (error) {
          console.error(`Failed to send notification to user ${userId}:`, error);
          failed++;
          return {
            messageId: '',
            success: false,
            recipientToken: ''
          };
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults.map(result => 
        result.status === 'fulfilled' ? result.value : {
          messageId: '',
          success: false,
          recipientToken: ''
        }
      ));
    }

    console.log(`Bulk notification completed: ${successful} successful, ${failed} failed`);
    
    return { successful, failed, results };
  }

  private async getFCMToken(userId: string): Promise<string | null> {
    try {
      const db = adminService.firestore();
      const tokenDoc = await db
        .collection('users')
        .doc(userId)
        .collection('tokens')
        .doc('fcm')
        .get();

      if (!tokenDoc.exists) {
        console.warn(`No FCM token found for user: ${userId}`);
        return null;
      }

      const tokenData = tokenDoc.data() as FCMTokenData;
      return tokenData.fcmToken || null;
    } catch (error) {
      console.error(`Error fetching FCM token for user ${userId}:`, error);
      return null;
    }
  }

  private async getUserProfile(userId: string): Promise<UserProfile | null> {
    try {
      const db = adminService.firestore();
      const profileDoc = await db
        .collection('users')
        .doc(userId)
        .collection('profile')
        .doc('metadata')
        .get();

      if (!profileDoc.exists) {
        console.warn(`No profile found for user: ${userId}`);
        return null;
      }

      return profileDoc.data() as UserProfile;
    } catch (error) {
      console.error(`Error fetching profile for user ${userId}:`, error);
      return null;
    }
  }

  private async sendWithRetry(message: any): Promise<string> {
    const messaging = adminService.messaging();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const response = await messaging.send(message);
        return response; // This is the message ID
      } catch (error) {
        lastError = error as Error;
        console.warn(`Notification send attempt ${attempt} failed:`, error);

        if (attempt < this.MAX_RETRIES) {
          await this.sleep(this.RETRY_DELAY_MS * attempt);
        }
      }
    }

    throw lastError || new Error('Failed to send notification after retries');
  }

  private async storeNotificationHistory(data: {
    messageId: string;
    fromUserId: string;
    toUserId: string;
    title: string;
    body: string;
    sentAt: Date;
    metadata?: Record<string, any>;
  }): Promise<void> {
    try {
      const db = adminService.firestore();
      await db.collection('notifications').add(data);
    } catch (error) {
      // Non-critical error - don't throw, just log
      console.error('Failed to store notification history:', error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async updateFCMToken(
    userId: string, 
    token: string, 
    deviceId?: string, 
    platform?: 'ios' | 'android'
  ): Promise<void> {
    try {
      const db = adminService.firestore();
      const tokenData: FCMTokenData = {
        fcmToken: token,
        deviceId,
        platform,
        updatedAt: new Date()
      };

      await db
        .collection('users')
        .doc(userId)
        .collection('tokens')
        .doc('fcm')
        .set(tokenData, { merge: true });

      console.log(`FCM token updated for user: ${userId}`);
    } catch (error) {
      console.error(`Failed to update FCM token for user ${userId}:`, error);
      throw new ApiError(500, 'Token Update Error', 'Failed to update FCM token');
    }
  }

  async removeFCMToken(userId: string): Promise<void> {
    try {
      const db = adminService.firestore();
      await db
        .collection('users')
        .doc(userId)
        .collection('tokens')
        .doc('fcm')
        .delete();

      console.log(`FCM token removed for user: ${userId}`);
    } catch (error) {
      console.error(`Failed to remove FCM token for user ${userId}:`, error);
      throw new ApiError(500, 'Token Removal Error', 'Failed to remove FCM token');
    }
  }
}

export const notificationService = new NotificationService();
export default notificationService;