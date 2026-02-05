import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getConfig } from "./config";

export const initFirebase = () => {
  const config = getConfig();
  const firebaseConfig = {
    apiKey: config.VITE_FIREBASE_API_KEY,
    authDomain: config.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: config.VITE_FIREBASE_PROJECT_ID,
    storageBucket: config.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: config.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: config.VITE_FIREBASE_APP_ID,
    measurementId: config.VITE_FIREBASE_MEASUREMENT_ID
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);

  // Initialize Analytics if supported (only in browser)
  if (typeof window !== "undefined" && firebaseConfig.measurementId) {
    getAnalytics(app);
    console.log("Firebase Analytics initialized");
  }
};
