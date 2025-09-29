import admin from 'firebase-admin';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getMessaging } from 'firebase-admin/messaging';

class AdminService {
  private initialized = false;

  constructor() {
    this.initializeFirebase();
  }

  private initializeFirebase(): void {
    if (this.initialized) {
      return;
    }

    try {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "found-a-vibe-non-prod.firebasestorage.app",
      });

      this.initialized = true;
      console.log('Firebase Admin initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Firebase Admin:', error);
      throw new Error('Firebase Admin initialization failed');
    }
  }

  auth() {
    if (!this.initialized) {
      throw new Error('Firebase Admin not initialized');
    }
    return getAuth();
  }

  firestore() {
    if (!this.initialized) {
      throw new Error('Firebase Admin not initialized');
    }
    return getFirestore();
  }

  storage() {
    if (!this.initialized) {
      throw new Error('Firebase Admin not initialized');
    }
    return getStorage();
  }

  messaging() {
    if (!this.initialized) {
      throw new Error('Firebase Admin not initialized');
    }
    return getMessaging();
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

export const adminService = new AdminService();
export default adminService;