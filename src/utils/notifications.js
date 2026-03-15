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
  if (!Device.isDevice) {
    console.log('[Notifications] Simulator detected — push token skipped');
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'WagPals',
      importance: Notifications.AndroidImportance.MAX,
      sound: true,
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.log('[Notifications] Permission denied — push disabled');
    return null;
  }

  const { data: token } = await Notifications.getExpoPushTokenAsync();
  console.log('[Notifications] Expo push token:', token);

  const uid = auth.currentUser?.uid;
  if (uid && token) {
    await setDoc(doc(db, 'owners', uid), { expoPushToken: token }, { merge: true });
  }

  return token;
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
