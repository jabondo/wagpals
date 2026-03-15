import React, { useState, useCallback } from 'react';
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
  doc, getDoc,
  collection, query, where, getDocs, orderBy,
  updateDoc,
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

// ─── Playdate status badge config ─────────────────────────────────────────
const STATUS_CONFIG = {
  pending:   { label: 'Pending',   bg: '#FEF3C7', text: '#92400E' },
  confirmed: { label: 'Confirmed', bg: '#D1FAE5', text: '#065F46' },
  declined:  { label: 'Declined',  bg: '#FEE2E2', text: '#991B1B' },
};

// ─── Screen ───────────────────────────────────────────────────────────────
export default function MyProfileScreen({ navigation }) {
  const [owner,          setOwner]          = useState(null);
  const [dogs,           setDogs]           = useState([]);
  const [sentRequests,   setSentRequests]   = useState([]);
  const [recvRequests,   setRecvRequests]   = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [sharingLoc,     setSharingLoc]     = useState(false);

  const uid = auth.currentUser?.uid;

  // Reload whenever the tab comes into focus (e.g. after editing a dog)
  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [uid])
  );

  async function loadAll() {
    if (!uid) return;
    try {
      // Owner doc
      const ownerSnap = await getDoc(doc(db, 'owners', uid));
      const ownerData = ownerSnap.exists() ? ownerSnap.data() : {};
      setOwner(ownerData);

      // Dogs
      if (ownerData.dogs?.length) {
        const snaps = await Promise.all(
          ownerData.dogs.map((id) => getDoc(doc(db, 'dogs', id)))
        );
        setDogs(snaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() })));
      } else {
        setDogs([]);
      }

      // Playdate requests — sent by me
      const sentSnap = await getDocs(
        query(
          collection(db, 'playdateRequests'),
          where('fromOwnerId', '==', uid),
          where('status', 'in', ['pending', 'confirmed'])
        )
      );
      setSentRequests(sentSnap.docs.map((d) => ({ id: d.id, ...d.data(), direction: 'sent' })));

      // Playdate requests — received by me
      const recvSnap = await getDocs(
        query(
          collection(db, 'playdateRequests'),
          where('toOwnerId', '==', uid),
          where('status', 'in', ['pending', 'confirmed'])
        )
      );
      setRecvRequests(recvSnap.docs.map((d) => ({ id: d.id, ...d.data(), direction: 'received' })));
    } catch (err) {
      console.error('[MyProfile] loadAll error:', err.message);
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
      await updateDoc(doc(db, 'playdateRequests', request.id), { status: 'confirmed' });

      // Notify the person who sent the request
      const token = await getOwnerPushToken(request.fromOwnerId);
      await sendPushNotification(
        token,
        'Playdate Confirmed! 🐾',
        `Your playdate request for ${request.dogName} has been accepted!`,
        { type: 'playdate' }
      );

      loadAll();
    } catch (err) {
      console.error('[MyProfile] accept error:', err.message);
      Alert.alert('Error', 'Could not accept request. Please try again.');
    }
  }

  async function handleDeclineRequest(request) {
    try {
      await updateDoc(doc(db, 'playdateRequests', request.id), { status: 'declined' });
      loadAll();
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

  const allRequests = [...sentRequests, ...recvRequests];

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

      {/* ── Upcoming playdates ── */}
      <Section title="Upcoming Playdates">
        {allRequests.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="calendar-outline" size={36} color={colors.mediumGray} />
            <Text style={styles.emptyText}>No upcoming playdates yet.</Text>
          </View>
        ) : (
          allRequests.map((req) => (
            <PlaydateRow
              key={req.id}
              request={req}
              onAccept={() => handleAcceptRequest(req)}
              onDecline={() => handleDeclineRequest(req)}
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
        <DogAvatar uri={dog.photoUri} name={dog.name} size={72} />
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

// ─── Playdate row ──────────────────────────────────────────────────────────
function PlaydateRow({ request, onAccept, onDecline }) {
  const cfg       = STATUS_CONFIG[request.status] ?? STATUS_CONFIG.pending;
  const isSent    = request.direction === 'sent';
  const isPending = request.status === 'pending';
  const createdAt = request.createdAt?.toDate?.() ?? null;
  const showActions = !isSent && isPending;

  return (
    <View style={styles.playdateCard}>
      <View style={[styles.playdateIcon, { backgroundColor: isSent ? '#FFF3E0' : '#F0FDF4' }]}>
        <Ionicons
          name={isSent ? 'send' : 'paw'}
          size={18}
          color={isSent ? colors.primary : colors.success}
        />
      </View>
      <View style={styles.playdateInfo}>
        <Text style={styles.playdateDog}>{request.dogName}</Text>
        <Text style={styles.playdateDir}>
          {isSent ? 'You requested a playdate' : 'Playdate requested with you'}
        </Text>
        {createdAt && (
          <Text style={styles.playdateTime}>
            {createdAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </Text>
        )}
        {showActions && (
          <View style={styles.requestActions}>
            <TouchableOpacity style={styles.acceptBtn} onPress={onAccept} activeOpacity={0.8}>
              <Ionicons name="checkmark" size={13} color={colors.white} />
              <Text style={styles.acceptBtnText}>Accept</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.declineBtn} onPress={onDecline} activeOpacity={0.8}>
              <Text style={styles.declineBtnText}>Decline</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      {!showActions && (
        <View style={[styles.statusPill, { backgroundColor: cfg.bg }]}>
          <Text style={[styles.statusText, { color: cfg.text }]}>{cfg.label}</Text>
        </View>
      )}
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

  // Playdate card
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
