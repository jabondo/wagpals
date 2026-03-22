import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  ScrollView,
  Dimensions,
  Alert,
} from 'react-native';
import { seedTestDogs, clearTestDogs } from '../utils/seedTestData';
import MapView, { Marker, Circle } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import {
  collection, onSnapshot, query, where,
  getDoc, doc, addDoc, serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { getDistanceMiles, formatDistance } from '../utils/distance';
import { getOwnerPushToken, sendPushNotification } from '../utils/notifications';
import DogAvatar from '../components/DogAvatar';
import Tag from '../components/Tag';
import { colors, spacing, borderRadius, shadows } from '../config/theme';

const RADIUS_MILES  = 5;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const SHEET_HEIGHT  = Math.round(SCREEN_HEIGHT * 0.58);

// ─── Vaccination helper ────────────────────────────────────────────────────
// Green = rabies + bordetella + DHPP all current. Yellow = any missing.
function vaccineStatus(health) {
  if (!health) return 'unknown';
  const { rabiesVaccine, bordetellaVaccine, dhppVaccine } = health;
  const core = [rabiesVaccine, bordetellaVaccine, dhppVaccine];
  if (core.every((v) => v === 'Yes')) return 'current';
  return 'incomplete';
}

// ─── Main screen ───────────────────────────────────────────────────────────
export default function HomeMapScreen({ navigation }) {
  const [location,        setLocation]        = useState(null);
  const [permissionDenied,setPermissionDenied]= useState(false);
  const [nearbyDogs,      setNearbyDogs]      = useState([]);
  const [loading,         setLoading]         = useState(true);

  // Bottom sheet state
  const [selectedDog,     setSelectedDog]     = useState(null);
  const [ownerName,       setOwnerName]       = useState('');
  const [requesting,      setRequesting]      = useState(false);

  // Dev seed tool
  const [seedStatus, setSeedStatus] = useState('idle'); // 'idle' | 'running' | 'done'
  const sheetAnim = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  const mapRef = useRef(null);

  // ── Location ──
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setPermissionDenied(true); setLoading(false); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLocation(loc.coords);
      setLoading(false);
    })();
  }, []);

  // ── Nearby dogs listener ──
  useEffect(() => {
    if (!location) return;
    const q = query(collection(db, 'dogs'), where('ownerId', '!=', auth.currentUser?.uid));
    const unsub = onSnapshot(q, (snap) => {
      const dogs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((dog) => {
          if (!dog.location) return false;
          return getDistanceMiles(
            location.latitude, location.longitude,
            dog.location.latitude, dog.location.longitude
          ) <= RADIUS_MILES;
        })
        .map((dog) => ({
          ...dog,
          distance: getDistanceMiles(
            location.latitude, location.longitude,
            dog.location.latitude, dog.location.longitude
          ),
        }));
      setNearbyDogs(dogs);
    });
    return unsub;
  }, [location]);

  // ── Fetch owner name when sheet opens ──
  useEffect(() => {
    if (!selectedDog) return;
    setOwnerName('');
    getDoc(doc(db, 'owners', selectedDog.ownerId))
      .then((snap) => { if (snap.exists()) setOwnerName(snap.data().name ?? ''); })
      .catch(() => {});
  }, [selectedDog]);

  // ── Sheet open / close ──
  function openSheet(dog) {
    setSelectedDog(dog);
    Animated.parallel([
      Animated.spring(sheetAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 68,
        friction: 12,
      }),
      Animated.timing(backdropAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }

  function closeSheet() {
    Animated.parallel([
      Animated.spring(sheetAnim, {
        toValue: SHEET_HEIGHT,
        useNativeDriver: true,
        tension: 80,
        friction: 14,
      }),
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => { setSelectedDog(null); setOwnerName(''); });
  }

  // ── Request playdate ──
  async function handleRequestPlaydate() {
    if (!selectedDog) return;
    setRequesting(true);
    try {
      await addDoc(collection(db, 'playdateRequests'), {
        fromUserId:  auth.currentUser.uid,
        fromDogName: selectedDog.name,
        toUserId:    selectedDog.ownerId,
        toDogId:     selectedDog.id,
        status:      'pending',
        timestamp:   serverTimestamp(),
      });

      // Notify the dog's owner
      const token = await getOwnerPushToken(selectedDog.ownerId);
      await sendPushNotification(
        token,
        'New Playdate Request! 🐾',
        `${selectedDog.name} has a new playdate request!`,
        { type: 'playdate' }
      );

      closeSheet();
      Alert.alert(
        'Request Sent! 🐾',
        `Your playdate request for ${selectedDog.name} has been sent to ${ownerName || 'their owner'}.`,
        [{ text: 'Great!' }]
      );
    } catch {
      Alert.alert('Error', 'Could not send request. Please try again.');
    } finally {
      setRequesting(false);
    }
  }

  // ── Message owner ──
  function handleMessage() {
    if (!selectedDog) return;
    closeSheet();
    // Small delay so the sheet closes before navigating
    setTimeout(() => {
      navigation.navigate('MessagesTab', {
        screen: 'ChatThread',
        params: {
          otherOwnerId:   selectedDog.ownerId,
          otherOwnerName: ownerName || 'Owner',
          dogName:        selectedDog.name,
          dogPhotoUri:    selectedDog.photoUri ?? null,
        },
      });
    }, 300);
  }

  // ── Dev seed ──
  function handleSeed() {
    Alert.alert(
      'Seed Test Dogs',
      'Add 3 fake dogs near San Francisco to Firestore?\n\nBuddy (Golden Retriever), Luna (French Bulldog), Max (Husky)',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Seed',
          onPress: async () => {
            setSeedStatus('running');
            try {
              const { created, skipped } = await seedTestDogs();
              setSeedStatus('done');
              Alert.alert(
                'Seeded ✓',
                created > 0
                  ? `${created} dog${created > 1 ? 's' : ''} added. Share your location from My Profile so they appear on the map.`
                  : `All ${skipped} test dogs already exist in Firestore.`
              );
            } catch (err) {
              setSeedStatus('idle');
              Alert.alert('Seed failed', err.message);
            }
          },
        },
      ]
    );
  }

  function handleClearSeed() {
    Alert.alert(
      'Clear Test Dogs',
      'Remove all seeded test dogs and owners from Firestore?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              const { dogs } = await clearTestDogs();
              setSeedStatus('idle');
              Alert.alert('Cleared', `Removed ${dogs} test dog${dogs !== 1 ? 's' : ''} from Firestore.`);
            } catch (err) {
              Alert.alert('Clear failed', err.message);
            }
          },
        },
      ]
    );
  }

  function recenter() {
    if (location && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude:      location.latitude,
        longitude:     location.longitude,
        latitudeDelta: 0.05,
        longitudeDelta:0.05,
      });
    }
  }

  // ─── Loading / permission states ──────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Finding your location...</Text>
      </View>
    );
  }

  if (permissionDenied) {
    return (
      <View style={styles.centered}>
        <Ionicons name="location-outline" size={56} color={colors.mediumGray} />
        <Text style={styles.permText}>Location access needed</Text>
        <Text style={styles.permSubText}>
          WagPals uses GPS to show nearby dogs. Please enable location in Settings.
        </Text>
      </View>
    );
  }

  const region = location
    ? { latitude: location.latitude, longitude: location.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }
    : undefined;

  const vacStatus = selectedDog ? vaccineStatus(selectedDog.health) : null;
  const ownerFirst = ownerName ? ownerName.split(' ')[0] : null;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* ── Map ── */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={region}
        showsUserLocation
        showsMyLocationButton={false}
        customMapStyle={mapStyle}
        onPress={() => { if (selectedDog) closeSheet(); }}
      >
        {location && (
          <Circle
            center={{ latitude: location.latitude, longitude: location.longitude }}
            radius={RADIUS_MILES * 1609.34}
            strokeColor={`${colors.primary}40`}
            fillColor={`${colors.primary}10`}
          />
        )}
        {nearbyDogs.map((dog) => (
          <Marker
            key={dog.id}
            coordinate={{ latitude: dog.location.latitude, longitude: dog.location.longitude }}
            onPress={() => openSheet(dog)}
          >
            <View style={styles.markerContainer}>
              <DogAvatar uri={dog.photoUri} name={dog.name} size={44} style={styles.markerAvatar} />
              <View style={styles.markerBubble}>
                <Text style={styles.markerName}>{dog.name}</Text>
              </View>
              <View style={styles.markerArrow} />
            </View>
          </Marker>
        ))}
      </MapView>

      {/* ── Header pill ── */}
      <View style={styles.header} pointerEvents="none">
        <View style={styles.headerContent}>
          <Ionicons name="paw" size={20} color={colors.primary} />
          <Text style={styles.headerText}>
            {nearbyDogs.length === 0
              ? 'No dogs nearby yet'
              : `${nearbyDogs.length} dog${nearbyDogs.length > 1 ? 's' : ''} nearby`}
          </Text>
        </View>
      </View>

      {/* ── Recenter ── */}
      <TouchableOpacity style={styles.recenterBtn} onPress={recenter} activeOpacity={0.85}>
        <Ionicons name="locate" size={22} color={colors.primary} />
      </TouchableOpacity>

      {/* ── Dev seed button ── */}
      {seedStatus !== 'done' && (
        <TouchableOpacity
          style={[styles.seedBtn, seedStatus === 'running' && styles.seedBtnRunning]}
          onPress={seedStatus === 'running' ? undefined : handleSeed}
          activeOpacity={0.8}
        >
          {seedStatus === 'running'
            ? <ActivityIndicator size="small" color={colors.white} />
            : <Text style={styles.seedBtnText}>🌱 Seed Test Dogs</Text>
          }
        </TouchableOpacity>
      )}
      {seedStatus === 'done' && (
        <TouchableOpacity style={styles.seedClearBtn} onPress={handleClearSeed} activeOpacity={0.8}>
          <Text style={styles.seedClearText}>🗑 Clear Test Dogs</Text>
        </TouchableOpacity>
      )}

      {/* ── Nearby strip (hidden when sheet is open) ── */}
      {nearbyDogs.length > 0 && !selectedDog && (
        <View style={styles.nearbyStrip}>
          <Text style={styles.nearbyStripTitle}>Nearby Pups</Text>
          {nearbyDogs.slice(0, 3).map((dog) => (
            <TouchableOpacity
              key={dog.id}
              style={styles.nearbyItem}
              onPress={() => openSheet(dog)}
              activeOpacity={0.8}
            >
              <DogAvatar uri={dog.photoUri} name={dog.name} size={40} />
              <View style={styles.nearbyInfo}>
                <Text style={styles.nearbyName}>{dog.name}</Text>
                <Text style={styles.nearbyBreed}>{dog.breed}</Text>
              </View>
              <Text style={styles.nearbyDist}>{formatDistance(dog.distance)}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.mediumGray} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── Backdrop ── */}
      {selectedDog && (
        <Animated.View
          style={[styles.backdrop, { opacity: backdropAnim }]}
          pointerEvents={selectedDog ? 'auto' : 'none'}
        >
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={closeSheet} activeOpacity={1} />
        </Animated.View>
      )}

      {/* ── Bottom Sheet ── */}
      <Animated.View
        style={[styles.sheet, { transform: [{ translateY: sheetAnim }] }]}
        pointerEvents={selectedDog ? 'auto' : 'none'}
      >
        {selectedDog && (
          <>
            {/* Drag handle */}
            <View style={styles.sheetHandle} />

            {/* Dismiss button */}
            <TouchableOpacity style={styles.sheetCloseBtn} onPress={closeSheet} hitSlop={12}>
              <Ionicons name="close" size={20} color={colors.textLight} />
            </TouchableOpacity>

            <ScrollView
              contentContainerStyle={styles.sheetContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Dog photo + name row */}
              <View style={styles.sheetTopRow}>
                <View style={styles.sheetPhotoWrapper}>
                  <DogAvatar uri={selectedDog.photoURL ?? selectedDog.photoUri} name={selectedDog.name} size={84} />
                  {/* Vaccination badge */}
                  <View style={[
                    styles.vacBadge,
                    vacStatus === 'current'    && styles.vacBadgeGreen,
                    vacStatus === 'partial'    && styles.vacBadgeYellow,
                    vacStatus === 'incomplete' && styles.vacBadgeYellow,
                    vacStatus === 'unknown'    && styles.vacBadgeGray,
                  ]}>
                    <Ionicons
                      name={vacStatus === 'current' ? 'checkmark-circle' : 'alert-circle'}
                      size={14}
                      color={vacStatus === 'current' ? colors.success : '#B45309'}
                    />
                  </View>
                </View>

                <View style={styles.sheetNameCol}>
                  <Text style={styles.sheetDogName}>{selectedDog.name}</Text>
                  <Text style={styles.sheetBreed}>{selectedDog.breed}</Text>

                  {/* Distance */}
                  {selectedDog.distance !== undefined && (
                    <View style={styles.distRow}>
                      <Ionicons name="location" size={12} color={colors.primary} />
                      <Text style={styles.distText}>{formatDistance(selectedDog.distance)} away</Text>
                    </View>
                  )}

                  {/* Owner */}
                  {ownerFirst ? (
                    <Text style={styles.ownerText}>Owned by {ownerFirst}</Text>
                  ) : null}
                </View>
              </View>

              {/* Size + Energy badges */}
              <View style={styles.badgeRow}>
                {selectedDog.size ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>📏 {selectedDog.size}</Text>
                  </View>
                ) : null}
                {selectedDog.energyLevel ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {selectedDog.energyLevel === 'Low'    ? '🐾' :
                       selectedDog.energyLevel === 'Medium' ? '⚡' : '🔥'}{' '}
                      {selectedDog.energyLevel} Energy
                    </Text>
                  </View>
                ) : null}
                {/* Vaccine status label */}
                <View style={[styles.badge, vacStatus === 'current' ? styles.badgeGreen : styles.badgeYellow]}>
                  <Text style={[styles.badgeText, vacStatus === 'current' ? styles.badgeTextGreen : styles.badgeTextYellow]}>
                    {vacStatus === 'current' ? '✓ Vaccines Current' : '⚠ Vaccines Incomplete'}
                  </Text>
                </View>
              </View>

              {/* Temperament chips */}
              {selectedDog.temperament?.length > 0 && (
                <View style={styles.tagCloud}>
                  {selectedDog.temperament.map((t) => (
                    <Tag key={t} label={t} selected />
                  ))}
                </View>
              )}

              {/* Action buttons */}
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnPrimary]}
                onPress={handleRequestPlaydate}
                disabled={requesting}
                activeOpacity={0.85}
              >
                {requesting
                  ? <ActivityIndicator color={colors.white} />
                  : <>
                      <Ionicons name="calendar" size={18} color={colors.white} />
                      <Text style={styles.actionBtnTextLight}>Request Playdate</Text>
                    </>
                }
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnSecondary]}
                onPress={handleMessage}
                activeOpacity={0.85}
              >
                <Ionicons name="chatbubble-ellipses" size={18} color={colors.white} />
                <Text style={styles.actionBtnTextLight}>Message Owner</Text>
              </TouchableOpacity>
            </ScrollView>
          </>
        )}
      </Animated.View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  map:       { flex: 1 },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.offWhite, padding: spacing.xl },
  loadingText:  { marginTop: spacing.md, color: colors.textMedium, fontSize: 15 },
  permText:     { marginTop: spacing.md, fontSize: 18, fontWeight: '700', color: colors.darkBrown, textAlign: 'center' },
  permSubText:  { marginTop: spacing.sm, fontSize: 14, color: colors.textMedium, textAlign: 'center', lineHeight: 20 },

  // Header pill
  header: { position: 'absolute', top: 16, alignSelf: 'center' },
  headerContent: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.white, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: borderRadius.full, ...shadows.card,
  },
  headerText: { fontSize: 14, fontWeight: '600', color: colors.darkBrown },

  // Recenter
  recenterBtn: {
    position: 'absolute', top: 72, right: 16,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...shadows.card,
  },

  // Markers
  markerContainer: { alignItems: 'center' },
  markerAvatar:    { borderWidth: 2, borderColor: colors.primary },
  markerBubble:    { backgroundColor: colors.primary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: borderRadius.full, marginTop: 2 },
  markerName:      { color: colors.white, fontSize: 11, fontWeight: '700' },
  markerArrow:     { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: colors.primary },

  // Dev seed
  seedBtn: {
    position: 'absolute', top: 124, right: 16,
    backgroundColor: colors.darkBrown,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: borderRadius.full, minWidth: 44, alignItems: 'center',
    ...shadows.card,
  },
  seedBtnRunning: { opacity: 0.7 },
  seedBtnText:    { fontSize: 12, fontWeight: '700', color: colors.white },
  seedClearBtn: {
    position: 'absolute', top: 124, right: 16,
    backgroundColor: '#9B2335',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: borderRadius.full, alignItems: 'center',
    ...shadows.card,
  },
  seedClearText: { fontSize: 12, fontWeight: '700', color: colors.white },

  // Nearby strip
  nearbyStrip: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.white, borderTopLeftRadius: borderRadius.xl, borderTopRightRadius: borderRadius.xl,
    padding: spacing.lg, paddingBottom: spacing.xl, ...shadows.card,
  },
  nearbyStripTitle: { fontSize: 16, fontWeight: '800', color: colors.darkBrown, marginBottom: spacing.md },
  nearbyItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  nearbyInfo:  { flex: 1 },
  nearbyName:  { fontSize: 15, fontWeight: '700', color: colors.darkBrown },
  nearbyBreed: { fontSize: 12, color: colors.textLight },
  nearbyDist:  { fontSize: 12, color: colors.primary, fontWeight: '600' },

  // Backdrop
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    zIndex: 10,
  },

  // Bottom sheet
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_HEIGHT,
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    zIndex: 20,
    ...shadows.card,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 16,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center', marginTop: 12,
  },
  sheetCloseBtn: {
    position: 'absolute', top: 14, right: 16,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.lightGray,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },

  // Sheet top row: photo + name
  sheetTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.md },
  sheetPhotoWrapper: { position: 'relative' },
  vacBadge: {
    position: 'absolute', bottom: 0, right: -4,
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.white,
    borderWidth: 2, borderColor: colors.white,
  },
  vacBadgeGreen:  { backgroundColor: '#D1FAE5' },
  vacBadgeYellow: { backgroundColor: '#FEF3C7' },
  vacBadgeGray:   { backgroundColor: colors.lightGray },

  sheetNameCol: { flex: 1, paddingTop: 2 },
  sheetDogName: { fontSize: 22, fontWeight: '800', color: colors.darkBrown },
  sheetBreed:   { fontSize: 14, color: colors.textMedium, marginTop: 2 },
  distRow:      { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.xs },
  distText:     { fontSize: 12, color: colors.primary, fontWeight: '600' },
  ownerText:    { fontSize: 12, color: colors.textLight, marginTop: spacing.xs },

  // Badges
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  badge: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    backgroundColor: colors.lightGray,
  },
  badgeGreen:       { backgroundColor: '#D1FAE5' },
  badgeYellow:      { backgroundColor: '#FEF3C7' },
  badgeText:        { fontSize: 12, fontWeight: '600', color: colors.textMedium },
  badgeTextGreen:   { color: '#065F46' },
  badgeTextYellow:  { color: '#92400E' },

  // Tags
  tagCloud: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },

  // Action buttons
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    height: 52, borderRadius: borderRadius.full, marginBottom: spacing.sm,
    ...shadows.button,
  },
  actionBtnPrimary:   { backgroundColor: colors.primary },
  actionBtnSecondary: { backgroundColor: colors.darkBrown },
  actionBtnTextLight: { fontSize: 16, fontWeight: '700', color: colors.white, letterSpacing: 0.2 },
});

// ─── Warm map style ───────────────────────────────────────────────────────────
const mapStyle = [
  { elementType: 'geometry',            stylers: [{ color: '#f5f0e8' }] },
  { elementType: 'labels.text.fill',    stylers: [{ color: '#6B5B4E' }] },
  { featureType: 'road',    elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'water',   elementType: 'geometry', stylers: [{ color: '#c9e8f0' }] },
  { featureType: 'park',    elementType: 'geometry', stylers: [{ color: '#d8f0d0' }] },
];
