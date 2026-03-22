import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

// Show alerts even when app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ── Register device and save token to Firestore ──────────────────────────────
export async function registerForPushNotifications() {
  try {
    console.log('[Notifications] registerForPushNotifications() started');
    console.log('[Notifications] Device.isDevice:', Device.isDevice, '| Device.deviceName:', Device.deviceName);
    console.log('[Notifications] Running on OS:', Platform.OS);

    if (Platform.OS === 'android') {
      console.log('[Notifications] Setting Android notification channel...');
      await Notifications.setNotificationChannelAsync('default', {
        name: 'WagPals',
        importance: Notifications.AndroidImportance.MAX,
        sound: true,
      });
      console.log('[Notifications] Android channel set');
    }

    console.log('[Notifications] Checking existing permission status...');
    const { status: existing } = await Notifications.getPermissionsAsync();
    console.log('[Notifications] Existing permission status:', existing);

    let finalStatus = existing;
    if (existing !== 'granted') {
      console.log('[Notifications] Requesting permission from user...');
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
      console.log('[Notifications] Permission request result:', status);
    } else {
      console.log('[Notifications] Permission already granted, skipping prompt');
    }

    if (finalStatus !== 'granted') {
      console.log('[Notifications] Permission denied (finalStatus:', finalStatus, ') — push disabled');
      return null;
    }
    console.log('[Notifications] Permission granted, fetching Expo push token...');

    const { data: token } = await Notifications.getExpoPushTokenAsync();
    console.log('[Notifications] Expo push token:', token);

    const uid = auth.currentUser?.uid;
    console.log('[Notifications] Saving token to Firestore for uid:', uid);
    if (uid && token) {
      await setDoc(doc(db, 'owners', uid), { expoPushToken: token }, { merge: true });
      console.log('[Notifications] Token saved to Firestore successfully');
    } else {
      console.log('[Notifications] Skipped Firestore save — uid:', uid, 'token:', token);
    }

    return token;
  } catch (err) {
    console.error('[Notifications] registerForPushNotifications() failed:', err.message, '\nFull error:', err);
    return null;
  }
}

// ── Fetch push token for any owner ───────────────────────────────────────────
export async function getOwnerPushToken(ownerId) {
  try {
    const snap = await getDoc(doc(db, 'owners', ownerId));
    return snap.exists() ? (snap.data().expoPushToken ?? null) : null;
  } catch {
    return null;
  }
}

// ── Send a push notification via Expo's push service ─────────────────────────
export async function sendPushNotification(expoPushToken, title, body, data = {}) {
  if (!expoPushToken) {
    console.log('[Notifications] No token — would have sent:', title, '|', body);
    return;
  }
  console.log('[Notifications] Sending push →', expoPushToken, '|', title, '|', body);
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to: expoPushToken, sound: 'default', title, body, data }),
    });
  } catch (err) {
    console.warn('[Notifications] Send failed:', err.message);
  }
}
