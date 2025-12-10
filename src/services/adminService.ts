import fs from "fs";
import admin from "firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getMessaging } from "firebase-admin/messaging";

class AdminService {
  private SA_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || "/etc/secrets/firebaseAdminServiceAccount.json";
  private initialized = false;

  constructor() {
    this.initializeFirebase();
  }

  private initializeFirebase(): void {
    if (this.initialized) {
      return;
    }

    try {
      const serviceAccount = JSON.parse(
        fs.readFileSync(this.SA_PATH, "utf8")
      );

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket:
          process.env.FIREBASE_STORAGE_BUCKET ||
          "found-a-vibe-non-prod.firebasestorage.app",
      });

      this.initialized = true;
      console.log("Firebase Admin initialized successfully");
    } catch (error) {
      console.error("Failed to initialize Firebase Admin:", error);
      throw new Error("Firebase Admin initialization failed");
    }
  }

  getCredential() {
  if (fs.existsSync(this.SA_PATH)) {
    // Render secret file detected → use cert auth
    const serviceAccount = JSON.parse(fs.readFileSync(this.SA_PATH, "utf8"));
    console.log("Using service account from Render secret file.");
    return admin.credential.cert(serviceAccount);
  }

  // No service account file → fallback: ADC
  console.log("Using Google application default credentials.");
  return admin.credential.applicationDefault();
}

  auth() {
    if (!this.initialized) {
      throw new Error("Firebase Admin not initialized");
    }
    return getAuth();
  }

  firestore() {
    if (!this.initialized) {
      throw new Error("Firebase Admin not initialized");
    }
    return getFirestore();
  }

  storage() {
    if (!this.initialized) {
      throw new Error("Firebase Admin not initialized");
    }
    return getStorage();
  }

  messaging() {
    if (!this.initialized) {
      throw new Error("Firebase Admin not initialized");
    }
    return getMessaging();
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

export const adminService = new AdminService();
export default adminService;
