import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { signOut } from 'firebase/auth';
import {
  doc, getDoc, getDocs,
  collection, query, where, limit,
  onSnapshot, addDoc, updateDoc, serverTimestamp, increment,
} from 'firebase/firestore';
import * as Location from 'expo-location';
import { auth, db } from '../config/firebase';
import { getOwnerPushToken, sendPushNotification } from '../utils/notifications';
import DogAvatar from '../components/DogAvatar';
import Tag from '../components/Tag';
import { colors, spacing, borderRadius, shadows } from '../config/theme';

// ─── Vaccine helper (same logic as map bottom sheet) ──────────────────────
function coreVaccineStatus(health) {
  if (!health) return 'unknown';
  const { rabiesVaccine, bordetellaVaccine, dhppVaccine } = health;
  return [rabiesVaccine, bordetellaVaccine, dhppVaccine].every((v) => v === 'Yes')
    ? 'current'
    : 'incomplete';
}

// ─── Screen ───────────────────────────────────────────────────────────────
export default function MyProfileScreen({ navigation }) {
  const [owner,            setOwner]            = useState(null);
  const [dogs,             setDogs]             = useState([]);
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [playdates,        setPlaydates]        = useState([]);
  const [loading,          setLoading]          = useState(true);
  const [sharingLoc,       setSharingLoc]       = useState(false);

  const uid = auth.currentUser?.uid;

  // ── onSnapshot listeners (persistent, not tied to focus) ──────────────
  useEffect(() => {
    if (!uid) return;

    // Incoming pending requests where toUserId == current user
    const reqQ = query(
      collection(db, 'playdateRequests'),
      where('toUserId', '==', uid),
      where('status', '==', 'pending'),
    );
    const unsubReq = onSnapshot(reqQ, (snap) => {
      setIncomingRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    // Upcoming playdates where current user is a participant
    const pdQ = query(
      collection(db, 'playdates'),
      where('participants', 'array-contains', uid),
    );
    const unsubPd = onSnapshot(pdQ, (snap) => {
      setPlaydates(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => { unsubReq(); unsubPd(); };
  }, [uid]);

  // Reload owner + dogs whenever the tab comes into focus
  useFocusEffect(
    useCallback(() => {
      loadOwnerAndDogs();
    }, [uid])
  );

  async function loadOwnerAndDogs() {
    if (!uid) return;
    try {
      const ownerSnap = await getDoc(doc(db, 'owners', uid));
      const ownerData = ownerSnap.exists() ? ownerSnap.data() : {};
      setOwner(ownerData);

      if (ownerData.dogs?.length) {
        const snaps = await Promise.all(
          ownerData.dogs.map((id) => getDoc(doc(db, 'dogs', id)))
        );
        setDogs(snaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() })));
      } else {
        setDogs([]);
      }
    } catch (err) {
      console.error('[MyProfile] loadOwnerAndDogs error:', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function shareLocation() {
    setSharingLoc(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Location access is required to appear on the map.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await Promise.all(
        dogs.map((dog) =>
          updateDoc(doc(db, 'dogs', dog.id), {
            location: { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
            locationUpdatedAt: new Date().toISOString(),
          })
        )
      );
      Alert.alert('Location shared!', 'Other dog owners nearby can now see you on the map.');
    } catch {
      Alert.alert('Error', 'Could not share location. Please try again.');
    } finally {
      setSharingLoc(false);
    }
  }

  async function handleAcceptRequest(request) {
    try {
      // Look up the requester's first dog so paw taps can reference both dog IDs
      let fromDogId = null;
      try {
        const requesterSnap = await getDoc(doc(db, 'owners', request.fromUserId));
        if (requesterSnap.exists()) fromDogId = requesterSnap.data().dogs?.[0] ?? null;
      } catch { /* non-critical — paw tap will still work via owner lookup */ }

      await updateDoc(doc(db, 'playdateRequests', request.id), { status: 'accepted' });

      // Create a confirmed playdate doc
      await addDoc(collection(db, 'playdates'), {
        fromUserId:   request.fromUserId,
        toUserId:     request.toUserId,
        toDogId:      request.toDogId,
        fromDogId,
        fromDogName:  request.fromDogName,
        participants: [request.fromUserId, request.toUserId],
        status:       'upcoming',
        timestamp:    serverTimestamp(),
      });

      // Notify the person who sent the request
      const token = await getOwnerPushToken(request.fromUserId);
      await sendPushNotification(
        token,
        'Playdate Accepted! 🐾',
        `Your playdate request for ${request.fromDogName} has been accepted!`,
        { type: 'playdate' }
      );
    } catch (err) {
      console.error('[MyProfile] accept error:', err.message);
      Alert.alert('Error', 'Could not accept request. Please try again.');
    }
  }

  async function handleDeclineRequest(request) {
    try {
      await updateDoc(doc(db, 'playdateRequests', request.id), { status: 'declined' });
    } catch (err) {
      console.error('[MyProfile] decline error:', err.message);
      Alert.alert('Error', 'Could not decline request. Please try again.');
    }
  }

  function handleSignOut() {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: () => signOut(auth) },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Owner header ── */}
      <OwnerHeader owner={owner} />

      {/* ── Share location card ── */}
      <View style={styles.locationCard}>
        <View style={styles.locationLeft}>
          <View style={styles.locationIconWrap}>
            <Ionicons name="location" size={20} color={colors.primary} />
          </View>
          <View>
            <Text style={styles.locationTitle}>Share Your Location</Text>
            <Text style={styles.locationSub}>Let nearby owners find you on the map</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.locationBtn}
          onPress={shareLocation}
          disabled={sharingLoc || dogs.length === 0}
          activeOpacity={0.8}
        >
          {sharingLoc
            ? <ActivityIndicator size="small" color={colors.white} />
            : <Text style={styles.locationBtnText}>Share</Text>
          }
        </TouchableOpacity>
      </View>

      {/* ── My Dogs ── */}
      <Section
        title="My Dogs"
        action={{ label: '+ Add Dog', onPress: () => navigation.navigate('DogProfileCreator') }}
      >
        {dogs.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="paw-outline" size={36} color={colors.mediumGray} />
            <Text style={styles.emptyText}>No dogs yet — add one to get started!</Text>
          </View>
        ) : (
          dogs.map((dog) => (
            <DogCard
              key={dog.id}
              dog={dog}
              onEdit={() => navigation.navigate('DogProfileCreator', { dog })}
            />
          ))
        )}
      </Section>

      {/* ── Playdate Requests (incoming, pending) ── */}
      {incomingRequests.length > 0 && (
        <Section title="Playdate Requests">
          {incomingRequests.map((req) => (
            <RequestRow
              key={req.id}
              request={req}
              onAccept={() => handleAcceptRequest(req)}
              onDecline={() => handleDeclineRequest(req)}
            />
          ))}
        </Section>
      )}

      {/* ── Playdates ── */}
      <Section title="Playdates">
        {playdates.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="calendar-outline" size={36} color={colors.mediumGray} />
            <Text style={styles.emptyText}>No playdates yet.</Text>
          </View>
        ) : (
          playdates.map((pd) => (
            <PlaydateRow
              key={pd.id}
              playdate={pd}
              currentUid={uid}
              myDogId={dogs[0]?.id ?? null}
            />
          ))
        )}
      </Section>

      {/* ── Log Out ── */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleSignOut} activeOpacity={0.85}>
        <Ionicons name="log-out-outline" size={18} color={colors.white} />
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Owner header ──────────────────────────────────────────────────────────
function OwnerHeader({ owner }) {
  const initials = (owner?.name ?? 'U')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <View style={styles.header}>
      {/* Warm gradient band */}
      <View style={styles.headerBand} />
      <View style={styles.headerContent}>
        <View style={styles.initialsCircle}>
          <Text style={styles.initialsText}>{initials}</Text>
        </View>
        <Text style={styles.ownerName}>{owner?.name || 'Dog Owner'}</Text>
        {owner?.email ? (
          <Text style={styles.ownerEmail}>{owner.email}</Text>
        ) : null}
      </View>
    </View>
  );
}

// ─── Section wrapper ───────────────────────────────────────────────────────
function Section({ title, action, children }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {action && (
          <TouchableOpacity style={styles.sectionAction} onPress={action.onPress} activeOpacity={0.8}>
            <Text style={styles.sectionActionText}>{action.label}</Text>
          </TouchableOpacity>
        )}
      </View>
      {children}
    </View>
  );
}

// ─── Dog card ─────────────────────────────────────────────────────────────
function DogCard({ dog, onEdit }) {
  const vacStatus = coreVaccineStatus(dog.health);
  const energyIcon =
    dog.energyLevel === 'Low'    ? '🐾' :
    dog.energyLevel === 'Medium' ? '⚡' : '🔥';

  return (
    <View style={styles.dogCard}>
      {/* Photo + vac badge */}
      <View style={styles.dogPhotoWrap}>
        <DogAvatar uri={dog.photoURL ?? dog.photoUri} name={dog.name} size={72} />
        <View style={[
          styles.vacDot,
          vacStatus === 'current' ? styles.vacDotGreen : styles.vacDotYellow,
        ]}>
          <Ionicons
            name={vacStatus === 'current' ? 'checkmark' : 'alert'}
            size={10}
            color={colors.white}
          />
        </View>
      </View>

      {/* Info */}
      <View style={styles.dogInfo}>
        <Text style={styles.dogName}>{dog.name}</Text>
        <Text style={styles.dogBreed}>
          {dog.breed}
          {dog.age ? ` · ${dog.age} ${dog.age === 1 ? 'yr' : 'yrs'}` : ''}
        </Text>

        {/* Size + energy badges */}
        <View style={styles.dogBadges}>
          {dog.size ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>📏 {dog.size}</Text>
            </View>
          ) : null}
          {dog.energyLevel ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{energyIcon} {dog.energyLevel}</Text>
            </View>
          ) : null}
          {/* Vaccination status */}
          <View style={[styles.badge, vacStatus === 'current' ? styles.badgeGreen : styles.badgeYellow]}>
            <Text style={[styles.badgeText, vacStatus === 'current' ? styles.badgeTextGreen : styles.badgeTextYellow]}>
              {vacStatus === 'current' ? '✓ Vaccines OK' : '⚠ Vaccines Incomplete'}
            </Text>
          </View>
        </View>

        {/* Temperament tags */}
        {dog.temperament?.length > 0 && (
          <View style={styles.tagRow}>
            {dog.temperament.map((t) => (
              <Tag key={t} label={t} selected />
            ))}
          </View>
        )}

        {/* Edit button */}
        <TouchableOpacity style={styles.editBtn} onPress={onEdit} activeOpacity={0.85}>
          <Ionicons name="pencil" size={13} color={colors.white} />
          <Text style={styles.editBtnText}>Edit Dog Profile</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Incoming request row (pending, with Accept / Decline) ─────────────────
function RequestRow({ request, onAccept, onDecline }) {
  const sentAt = request.timestamp?.toDate?.() ?? null;

  return (
    <View style={styles.playdateCard}>
      <View style={[styles.playdateIcon, { backgroundColor: '#F0FDF4' }]}>
        <Ionicons name="paw" size={18} color={colors.success} />
      </View>
      <View style={styles.playdateInfo}>
        <Text style={styles.playdateDog}>{request.fromDogName}</Text>
        <Text style={styles.playdateDir}>Wants to have a playdate!</Text>
        {sentAt && (
          <Text style={styles.playdateTime}>
            {sentAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </Text>
        )}
        <View style={styles.requestActions}>
          <TouchableOpacity style={styles.acceptBtn} onPress={onAccept} activeOpacity={0.8}>
            <Ionicons name="checkmark" size={13} color={colors.white} />
            <Text style={styles.acceptBtnText}>Accept</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.declineBtn} onPress={onDecline} activeOpacity={0.8}>
            <Text style={styles.declineBtnText}>Decline</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─── Playdate row (upcoming + completed with paw tap) ──────────────────────
function PlaydateRow({ playdate, currentUid, myDogId }) {
  const [marking,      setMarking]      = useState(false);
  const [tapping,      setTapping]      = useState(false);
  const [hasTapped,    setHasTapped]    = useState(false);
  const [tapCheckDone, setTapCheckDone] = useState(false);

  const isInitiator = playdate.fromUserId === currentUid;
  const isCompleted = playdate.status === 'completed';
  const scheduledAt = playdate.timestamp?.toDate?.() ?? null;

  // For paw taps: the other dog's ID depends on who the current user is
  const otherDogId = isInitiator ? (playdate.toDogId ?? null) : (playdate.fromDogId ?? null);
  const otherUserId = isInitiator ? playdate.toUserId : playdate.fromUserId;

  // Check for an existing tap whenever this playdate is completed
  useEffect(() => {
    if (!isCompleted || !playdate.id || !currentUid) return;
    getDocs(
      query(
        collection(db, 'pawTaps'),
        where('fromUserId', '==', currentUid),
        where('playdateId', '==', playdate.id),
        limit(1),
      )
    )
      .then((snap) => { setHasTapped(!snap.empty); setTapCheckDone(true); })
      .catch(() => setTapCheckDone(true));
  }, [isCompleted, playdate.id, currentUid]);

  async function doMarkComplete() {
    setMarking(true);
    try {
      await updateDoc(doc(db, 'playdates', playdate.id), { status: 'completed' });
    } catch {
      Alert.alert('Error', 'Could not update the playdate. Please try again.');
    } finally {
      setMarking(false);
    }
  }

  async function doPawTap() {
    if (!myDogId || !otherDogId || hasTapped || tapping) return;
    setTapping(true);
    try {
      await addDoc(collection(db, 'pawTaps'), {
        fromDogId:  myDogId,
        toDogId:    otherDogId,
        fromUserId: currentUid,
        toUserId:   otherUserId,
        playdateId: playdate.id,
        createdAt:  serverTimestamp(),
      });
      await updateDoc(doc(db, 'dogs', otherDogId), {
        pawTapCount: increment(1),
      });
      setHasTapped(true);
    } catch {
      Alert.alert('Error', 'Could not send paw tap. Please try again.');
    } finally {
      setTapping(false);
    }
  }

  return (
    <View style={styles.playdateCard}>
      <View style={[styles.playdateIcon, { backgroundColor: isCompleted ? '#F0FDF4' : '#FFF3E0' }]}>
        <Ionicons
          name={isCompleted ? 'checkmark-circle' : 'calendar'}
          size={18}
          color={isCompleted ? colors.success : colors.primary}
        />
      </View>

      <View style={styles.playdateInfo}>
        <Text style={styles.playdateDog}>{playdate.fromDogName}</Text>
        <Text style={styles.playdateDir}>
          {isInitiator ? 'You requested this playdate' : 'Playdate scheduled with you'}
        </Text>
        {scheduledAt && (
          <Text style={styles.playdateTime}>
            {scheduledAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </Text>
        )}

        {/* Mark as Completed */}
        {!isCompleted && (
          <TouchableOpacity
            style={styles.markCompleteBtn}
            onPress={doMarkComplete}
            disabled={marking}
            activeOpacity={0.8}
          >
            {marking ? (
              <ActivityIndicator size="small" color={colors.success} />
            ) : (
              <>
                <Ionicons name="checkmark" size={13} color={colors.success} />
                <Text style={styles.markCompleteBtnText}>Mark as Completed</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Paw tap prompt — only shown once tap check has resolved */}
        {isCompleted && tapCheckDone && (
          hasTapped ? (
            <View style={styles.pawTapSent}>
              <Text style={styles.pawTapSentText}>🐾 Great Playmate tap sent!</Text>
            </View>
          ) : (
            <View style={styles.pawTapPrompt}>
              <Text style={styles.pawTapPromptLabel}>Rate this playdate</Text>
              <TouchableOpacity
                style={[styles.pawTapBtn, (!otherDogId || tapping) && styles.pawTapBtnDisabled]}
                onPress={doPawTap}
                disabled={!otherDogId || tapping}
                activeOpacity={0.8}
              >
                {tapping ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <>
                    <Text style={styles.pawTapEmoji}>🐾</Text>
                    <Text style={styles.pawTapBtnText}>Great Playmate!</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )
        )}
      </View>

      <View style={[
        styles.statusPill,
        isCompleted ? { backgroundColor: '#DBEAFE' } : { backgroundColor: '#D1FAE5' },
      ]}>
        <Text style={[
          styles.statusText,
          isCompleted ? { color: '#1D4ED8' } : { color: '#065F46' },
        ]}>
          {isCompleted ? 'Done' : 'Upcoming'}
        </Text>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  scroll:     { flex: 1, backgroundColor: colors.offWhite },
  container:  { paddingBottom: 48 },
  centered:   { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Header
  header: { marginBottom: spacing.sm },
  headerBand: {
    height: 80,
    backgroundColor: colors.darkBrown,
  },
  headerContent: {
    alignItems: 'center',
    marginTop: -44, // pull up over the band
    paddingBottom: spacing.lg,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  initialsCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.white,
    ...shadows.card,
    marginBottom: spacing.sm,
  },
  initialsText: { fontSize: 30, fontWeight: '800', color: colors.white },
  ownerName:    { fontSize: 22, fontWeight: '800', color: colors.darkBrown },
  ownerEmail:   { fontSize: 13, color: colors.textLight, marginTop: 3 },

  // Location card
  locationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.md,
    ...shadows.card,
  },
  locationLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  locationIconWrap: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#FFF3E0',
    alignItems: 'center', justifyContent: 'center',
  },
  locationTitle: { fontSize: 14, fontWeight: '700', color: colors.darkBrown },
  locationSub:   { fontSize: 12, color: colors.textLight, marginTop: 1 },
  locationBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    minWidth: 68,
    alignItems: 'center',
  },
  locationBtnText: { color: colors.white, fontWeight: '700', fontSize: 13 },

  // Section
  section:       { paddingHorizontal: spacing.lg, marginBottom: spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sectionTitle:  { fontSize: 18, fontWeight: '800', color: colors.darkBrown },
  sectionAction: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.full,
  },
  sectionActionText: { fontSize: 13, fontWeight: '700', color: colors.white },

  // Empty state
  emptyBox: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    ...shadows.card,
  },
  emptyText: { fontSize: 14, color: colors.textMedium, textAlign: 'center' },

  // Dog card
  dogCard: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
    ...shadows.card,
  },
  dogPhotoWrap: { position: 'relative', alignSelf: 'flex-start' },
  vacDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.white,
  },
  vacDotGreen:  { backgroundColor: colors.success },
  vacDotYellow: { backgroundColor: '#D97706' },

  dogInfo:   { flex: 1 },
  dogName:   { fontSize: 18, fontWeight: '800', color: colors.darkBrown },
  dogBreed:  { fontSize: 13, color: colors.textMedium, marginTop: 2, marginBottom: spacing.sm },

  dogBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    backgroundColor: colors.lightGray,
  },
  badgeGreen:       { backgroundColor: '#D1FAE5' },
  badgeYellow:      { backgroundColor: '#FEF3C7' },
  badgeText:        { fontSize: 11, fontWeight: '600', color: colors.textMedium },
  badgeTextGreen:   { color: '#065F46' },
  badgeTextYellow:  { color: '#92400E' },

  tagRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm },

  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.full,
    gap: 5,
    marginTop: spacing.xs,
    ...shadows.button,
    shadowOpacity: 0.2,
  },
  editBtnText: { fontSize: 13, fontWeight: '700', color: colors.white },

  // Playdate / request card
  playdateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
    ...shadows.card,
  },
  playdateIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playdateInfo:  { flex: 1 },
  playdateDog:   { fontSize: 15, fontWeight: '700', color: colors.darkBrown },
  playdateDir:   { fontSize: 12, color: colors.textMedium, marginTop: 1 },
  playdateTime:  { fontSize: 11, color: colors.textLight, marginTop: 2 },
  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  statusText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },

  // Request accept/decline
  requestActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  acceptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.success,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    borderRadius: borderRadius.full,
  },
  acceptBtnText: { fontSize: 12, fontWeight: '700', color: colors.white },
  declineBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  declineBtnText: { fontSize: 12, fontWeight: '600', color: colors.textMedium },

  // Mark as completed button
  markCompleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.success,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 1,
    borderRadius: borderRadius.full,
    marginTop: spacing.sm,
    minWidth: 44,
    justifyContent: 'center',
  },
  markCompleteBtnText: { fontSize: 12, fontWeight: '700', color: colors.success },

  // Paw tap
  pawTapPrompt: { marginTop: spacing.sm },
  pawTapPromptLabel: { fontSize: 11, fontWeight: '700', color: colors.textLight, marginBottom: spacing.xs, textTransform: 'uppercase', letterSpacing: 0.5 },
  pawTapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.full,
    minWidth: 44,
    justifyContent: 'center',
    ...shadows.button,
    shadowOpacity: 0.2,
  },
  pawTapBtnDisabled: { opacity: 0.45 },
  pawTapEmoji:   { fontSize: 16 },
  pawTapBtnText: { fontSize: 13, fontWeight: '700', color: colors.white },
  pawTapSent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  pawTapSentText: { fontSize: 12, fontWeight: '600', color: colors.primary },

  // Log out
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    height: 52,
    borderRadius: borderRadius.full,
    backgroundColor: colors.darkBrown,
    ...shadows.card,
  },
  logoutText: { fontSize: 16, fontWeight: '700', color: colors.white, letterSpacing: 0.3 },
});
