import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { getOwnerPushToken, sendPushNotification } from '../utils/notifications';
import DogAvatar from '../components/DogAvatar';
import { colors, spacing, borderRadius, shadows } from '../config/theme';

// ─── Thread ID helper ──────────────────────────────────────────────────────
function makeThreadId(uid1, uid2) {
  return [uid1, uid2].sort().join('_');
}

// ─── Custom header title ───────────────────────────────────────────────────
function ChatHeader({ dogName, dogPhotoUri, ownerName }) {
  return (
    <View style={headerStyles.row}>
      <DogAvatar uri={dogPhotoUri} name={dogName} size={36} />
      <View style={headerStyles.text}>
        <Text style={headerStyles.name} numberOfLines={1}>{dogName || 'Chat'}</Text>
        {ownerName ? (
          <Text style={headerStyles.owner} numberOfLines={1}>with {ownerName}</Text>
        ) : null}
      </View>
    </View>
  );
}

const headerStyles = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: 220 },
  text:  { flex: 1 },
  name:  { fontSize: 16, fontWeight: '800', color: colors.darkBrown },
  owner: { fontSize: 11, color: colors.textLight, marginTop: 1 },
});

// ─── Screen ────────────────────────────────────────────────────────────────
export default function ChatThread({ route, navigation }) {
  const {
    otherOwnerId,
    otherOwnerName,
    dogName,
    dogPhotoUri,
    threadId: passedThreadId,
  } = route.params ?? {};

  const uid      = auth.currentUser?.uid;
  const threadId = passedThreadId ?? makeThreadId(uid, otherOwnerId);

  const [messages, setMessages] = useState([]);
  const [text,     setText]     = useState('');
  const [loading,  setLoading]  = useState(true);
  const flatRef = useRef(null);

  // ── Custom header ──
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <ChatHeader
          dogName={dogName}
          dogPhotoUri={dogPhotoUri}
          ownerName={otherOwnerName}
        />
      ),
      headerBackTitleVisible: false,
    });
  }, [dogName, dogPhotoUri, otherOwnerName]);

  // ── Create thread doc on first open ──
  useEffect(() => {
    async function initThread() {
      const threadRef = doc(db, 'messages', threadId);
      const snap = await getDoc(threadRef);
      if (snap.exists()) return; // already created

      // Fetch current user's display name + first dog
      let myName     = 'Dog Owner';
      let myDogName  = '';
      let myDogPhoto = null;

      try {
        const ownerSnap = await getDoc(doc(db, 'owners', uid));
        if (ownerSnap.exists()) {
          const od = ownerSnap.data();
          myName = od.name ?? 'Dog Owner';
          if (od.dogs?.length) {
            const dogSnap = await getDoc(doc(db, 'dogs', od.dogs[0]));
            if (dogSnap.exists()) {
              myDogName  = dogSnap.data().name   ?? '';
              myDogPhoto = dogSnap.data().photoUri ?? null;
            }
          }
        }
      } catch (e) {
        console.warn('[ChatThread] init fetch error:', e.message);
      }

      // participants[] is sorted — keep parallel arrays aligned to it
      const sorted   = [uid, otherOwnerId].sort();
      const myIdx    = sorted.indexOf(uid);
      const theirIdx = 1 - myIdx;

      const dogNames        = ['', ''];
      const dogPhotoUris    = [null, null];
      const participantNames = ['', ''];

      dogNames[myIdx]         = myDogName;
      dogNames[theirIdx]      = dogName ?? '';
      dogPhotoUris[myIdx]     = myDogPhoto;
      dogPhotoUris[theirIdx]  = dogPhotoUri ?? null;
      participantNames[myIdx] = myName;
      participantNames[theirIdx] = otherOwnerName ?? '';

      await setDoc(threadRef, {
        participants:     sorted,
        dogNames,
        dogPhotoUris,
        participantNames,
        lastMessage:      '',
        lastMessageTime:  serverTimestamp(),
        createdAt:        serverTimestamp(),
      });
    }

    if (uid && otherOwnerId) initThread().catch(console.error);
  }, [threadId]);

  // ── Real-time messages listener ──
  useEffect(() => {
    const q = query(
      collection(db, 'messages', threadId, 'messages'),
      orderBy('timestamp', 'asc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.warn('[ChatThread] messages error:', err.message);
        setLoading(false);
      }
    );
    return unsub;
  }, [threadId]);

  // ── Send ──
  async function sendMessage() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText('');
    try {
      await addDoc(collection(db, 'messages', threadId, 'messages'), {
        senderId:  uid,
        text:      trimmed,
        timestamp: serverTimestamp(),
      });
      await updateDoc(doc(db, 'messages', threadId), {
        lastMessage:     trimmed,
        lastMessageTime: serverTimestamp(),
      });

      // Notify the other user
      if (otherOwnerId) {
        const token = await getOwnerPushToken(otherOwnerId);
        await sendPushNotification(
          token,
          `${dogName || 'Someone'}'s owner sent you a message`,
          trimmed.length > 80 ? trimmed.slice(0, 80) + '…' : trimmed,
          {
            type:           'message',
            threadId,
            otherOwnerId:   uid,
            otherOwnerName: auth.currentUser?.displayName ?? '',
            dogName,
            dogPhotoUri:    dogPhotoUri ?? null,
          }
        );
      }
    } catch (err) {
      console.error('[ChatThread] send error:', err);
    }
  }

  // ── Message bubble ──
  function renderMessage({ item, index }) {
    const isMine  = item.senderId === uid;
    const ts      = item.timestamp?.toDate?.();

    // Show timestamp if first message or gap > 10 min from previous
    const prev = messages[index - 1];
    const prevTs = prev?.timestamp?.toDate?.();
    const showTs = !prevTs || (ts && ts - prevTs > 10 * 60 * 1000);

    return (
      <>
        {showTs && ts && (
          <Text style={styles.dateSep}>
            {ts.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            {' · '}
            {ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </Text>
        )}
        <View style={[styles.msgRow, isMine ? styles.rowRight : styles.rowLeft]}>
          {/* Avatar for received messages */}
          {!isMine && (
            <DogAvatar uri={dogPhotoUri} name={dogName} size={28} style={styles.msgAvatar} />
          )}
          <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
            <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>
              {item.text}
            </Text>
          </View>
        </View>
      </>
    );
  }

  // ── Loading ──
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // ── Render ──
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <FlatList
        ref={flatRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => flatRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View style={styles.emptyChat}>
            <DogAvatar uri={dogPhotoUri} name={dogName} size={72} />
            <Text style={styles.emptyChatTitle}>{dogName || 'Chat'}</Text>
            <Text style={styles.emptyChatSub}>
              Say hi to {otherOwnerName || 'them'}! 🐾
            </Text>
          </View>
        }
      />

      {/* Input bar */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Type a message…"
          placeholderTextColor={colors.textLight}
          multiline
          returnKeyType="default"
          blurOnSubmit={false}
        />
        <TouchableOpacity
          style={[styles.sendBtn, !text.trim() && styles.sendBtnOff]}
          onPress={sendMessage}
          disabled={!text.trim()}
          activeOpacity={0.8}
        >
          <Ionicons name="send" size={17} color={colors.white} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#F3EDE6' },
  centered:   { flex: 1, alignItems: 'center', justifyContent: 'center' },

  listContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    flexGrow: 1,
  },

  // Date separator
  dateSep: {
    alignSelf: 'center',
    fontSize: 11,
    color: colors.textLight,
    marginVertical: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.7)',
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },

  // Message rows
  msgRow:   { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 4 },
  rowRight: { justifyContent: 'flex-end' },
  rowLeft:  { justifyContent: 'flex-start', gap: spacing.xs },
  msgAvatar: { marginBottom: 2 },

  // Bubbles
  bubble: {
    maxWidth: '72%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.lg,
  },
  bubbleMine: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
    ...shadows.button,
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  bubbleTheirs: {
    backgroundColor: colors.white,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleText:     { fontSize: 15, color: colors.darkBrown, lineHeight: 21 },
  bubbleTextMine: { color: colors.white },

  // Empty chat
  emptyChat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: spacing.sm,
  },
  emptyChatTitle: { fontSize: 18, fontWeight: '800', color: colors.darkBrown, marginTop: spacing.sm },
  emptyChatSub:   { fontSize: 14, color: colors.textMedium },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    maxHeight: 110,
    backgroundColor: colors.lightGray,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 15,
    color: colors.darkBrown,
    lineHeight: 20,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.button,
    shadowOpacity: 0.25,
  },
  sendBtnOff: {
    backgroundColor: colors.mediumGray,
    shadowOpacity: 0,
    elevation: 0,
  },
});
