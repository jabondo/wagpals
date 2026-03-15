import React, { useState, useEffect, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { createNavigationContainerRef } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';

import { useAuth } from './src/hooks/useAuth';
import { db } from './src/config/firebase';
import OnboardingScreen from './src/screens/OnboardingScreen';
import AppNavigator from './src/navigation/AppNavigator';
import { colors } from './src/config/theme';
import { registerForPushNotifications } from './src/utils/notifications';

export const navigationRef = createNavigationContainerRef();

export default function App() {
  const { user, loading } = useAuth();
  const [hasDog, setHasDog] = useState(null); // null = still checking Firestore
  const notifListenerRef = useRef(null);

  // ── Check if current user already has a dog ──
  useEffect(() => {
    if (!user) {
      setHasDog(null);
      return;
    }
    const q = query(
      collection(db, 'dogs'),
      where('ownerId', '==', user.uid),
      limit(1)
    );
    getDocs(q)
      .then((snap) => {
        console.log('[App] hasDog check — uid:', user.uid, '— docs found:', snap.size);
        setHasDog(!snap.empty);
      })
      .catch((err) => {
        console.warn('[App] hasDog query failed:', err.message);
        setHasDog(false);
      });
  }, [user]);

  // ── Register push notifications when user logs in ──
  useEffect(() => {
    if (!user) return;
    registerForPushNotifications().catch((err) =>
      console.warn('[App] Push registration failed:', err.message)
    );
  }, [user?.uid]);

  // ── Handle notification taps ──
  useEffect(() => {
    notifListenerRef.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data ?? {};
        if (!navigationRef.isReady()) return;

        if (data.type === 'message') {
          if (data.threadId) {
            navigationRef.navigate('MessagesTab', {
              screen: 'ChatThread',
              params: {
                threadId:       data.threadId,
                otherOwnerId:   data.otherOwnerId,
                otherOwnerName: data.otherOwnerName,
                dogName:        data.dogName,
                dogPhotoUri:    data.dogPhotoUri ?? null,
              },
            });
          } else {
            navigationRef.navigate('MessagesTab');
          }
        } else if (data.type === 'playdate') {
          navigationRef.navigate('ProfileTab');
        }
      }
    );
    return () => notifListenerRef.current?.remove();
  }, []);

  // Still resolving auth or checking Firestore for existing dog
  if (loading || (user && hasDog === null)) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style={user ? 'dark' : 'light'} />
      {user
        ? <AppNavigator
            hasDog={hasDog}
            onDogCreated={() => setHasDog(true)}
            navigationRef={navigationRef}
          />
        : <OnboardingScreen />
      }
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.offWhite },
});
