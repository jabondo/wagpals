import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAuth, getAuth, getReactNativePersistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyAX3F6CUoqK8tJjxzi45VrzFGVkNB8AEnk',
  authDomain: 'wagpals-ccfc1.firebaseapp.com',
  projectId: 'wagpals-ccfc1',
  storageBucket: 'wagpals-ccfc1.firebasestorage.app',
  messagingSenderId: '754058448612',
  appId: '1:754058448612:web:898ec595c95542b4f5e6f1',
};

// Guard against Fast Refresh re-initializing an already-running app
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

let auth;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  // initializeAuth throws if called twice (Fast Refresh) — fall back to getAuth
  auth = getAuth(app);
}

export { auth };
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;
