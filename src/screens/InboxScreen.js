import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import DogAvatar from '../components/DogAvatar';
import { colors, spacing, borderRadius, shadows } from '../config/theme';

// ─── Timestamp formatter ───────────────────────────────────────────────────
function formatTime(ts) {
  if (!ts) return '';
  const date = ts.toDate?.() ?? new Date(ts);
  const now  = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const diffDays = (now - date) / 86_400_000;

  if (isToday)        return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (diffDays < 7)   return date.toLocaleDateString('en-US', { weekday: 'short' });
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Screen ────────────────────────────────────────────────────────────────
export default function InboxScreen({ navigation }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const uid = auth.currentUser?.uid;

  useEffect(() => {
    if (!uid) return;

    // messages/{threadId} — each doc has participants[], dogNames[], etc.
    const q = query(
      collection(db, 'messages'),
      where('participants', 'array-contains', uid),
      orderBy('lastMessageTime', 'desc')
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => {
          const thread = { id: d.id, ...d.data() };

          // participants[] is sorted; find the other user's index
          const myIdx    = thread.participants?.indexOf(uid) ?? 0;
          const theirIdx = 1 - myIdx;

          thread._theirDogName  = thread.dogNames?.[theirIdx]       ?? 'Unknown Dog';
          thread._theirPhoto    = thread.dogPhotoUris?.[theirIdx]   ?? null;
          thread._theirName     = thread.participantNames?.[theirIdx] ?? 'Dog Owner';
          thread._theirId       = thread.participants?.[theirIdx]   ?? '';

          return thread;
        });
        setThreads(list);
        setLoading(false);
      },
      (err) => {
        console.warn('[InboxScreen] snapshot error:', err.message);
        setLoading(false);
      }
    );

    return unsub;
  }, [uid]);

  function openThread(thread) {
    navigation.navigate('ChatThread', {
      threadId:       thread.id,
      otherOwnerId:   thread._theirId,
      otherOwnerName: thread._theirName,
      dogName:        thread._theirDogName,
      dogPhotoUri:    thread._theirPhoto,
    });
  }

  // ── Thread row ──
  function renderThread({ item }) {
    const unread = item.unreadCount?.[uid] > 0;
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => openThread(item)}
        activeOpacity={0.78}
      >
        {/* Dog avatar */}
        <View style={styles.avatarWrap}>
          <DogAvatar uri={item._theirPhoto} name={item._theirDogName} size={52} />
          {unread && <View style={styles.unreadDot} />}
        </View>

        {/* Text info */}
        <View style={styles.info}>
          <View style={styles.topRow}>
            <Text style={[styles.dogName, unread && styles.bold]} numberOfLines={1}>
              {item._theirDogName}
            </Text>
            <Text style={styles.time}>{formatTime(item.lastMessageTime)}</Text>
          </View>

          <Text style={styles.ownerLine} numberOfLines={1}>
            {item._theirName}
          </Text>

          <Text
            style={[styles.preview, unread && styles.previewUnread]}
            numberOfLines={1}
          >
            {item.lastMessage || 'Say hi! 🐾'}
          </Text>
        </View>

        <Ionicons name="chevron-forward" size={16} color={colors.mediumGray} />
      </TouchableOpacity>
    );
  }

  // ── Empty state ──
  function EmptyState() {
    return (
      <View style={styles.empty}>
        <View style={styles.emptyIcon}>
          <Ionicons name="chatbubbles-outline" size={48} color={colors.secondary} />
        </View>
        <Text style={styles.emptyTitle}>No messages yet</Text>
        <Text style={styles.emptyBody}>
          Tap "Message Owner" on any dog's profile to start a conversation!
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={threads}
        keyExtractor={(t) => t.id}
        renderItem={renderThread}
        contentContainerStyle={threads.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={<EmptyState />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: colors.offWhite },
  centered:       { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyContainer: { flex: 1 },

  // Thread row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    gap: spacing.md,
  },
  avatarWrap: { position: 'relative' },
  unreadDot: {
    position: 'absolute',
    top: 0,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.white,
  },
  info:    { flex: 1, minWidth: 0 },
  topRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 1 },

  dogName: { fontSize: 15, fontWeight: '600', color: colors.darkBrown, flexShrink: 1 },
  bold:    { fontWeight: '800' },
  time:    { fontSize: 11, color: colors.textLight, marginLeft: spacing.xs },

  ownerLine: { fontSize: 12, color: colors.textLight, marginBottom: 2 },

  preview:        { fontSize: 13, color: colors.textMedium },
  previewUnread:  { fontWeight: '700', color: colors.textDark },

  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: spacing.lg + 52 + spacing.md, // align with text, not avatar
  },

  // Empty
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#FFF3E0',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.darkBrown,
    marginBottom: spacing.sm,
  },
  emptyBody: {
    fontSize: 14,
    color: colors.textMedium,
    textAlign: 'center',
    lineHeight: 22,
  },
});
