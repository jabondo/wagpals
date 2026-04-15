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
  Linking,
  Platform,
  Modal,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { seedTestDogs, clearTestDogs } from '../utils/seedTestData';
import MapView, { Marker, Circle } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import {
  collection, onSnapshot, query, where,
  getDoc, doc, addDoc, getDocs, runTransaction,
  serverTimestamp, orderBy, limit,
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

// ─── Establishment filter categories ──────────────────────────────────────────
const FILTERS = [
  { label: 'All',         value: 'all' },
  { label: 'Restaurants', value: 'restaurant' },
  { label: 'Bars',        value: 'bar' },
  { label: 'Dog Parks',   value: 'dogpark' },
  { label: 'Retail',      value: 'retail' },
  { label: 'Hotels',      value: 'hotel' },
  { label: 'Wellness',    value: 'wellness' },
  { label: 'Trails',      value: 'trail' },
];

// ─── City quick-nav ───────────────────────────────────────────────────────────
const CITIES = [
  { label: 'Denver',       lat: 39.7392, lng: -104.9903 },
  { label: 'Philadelphia', lat: 39.9526, lng: -75.1652  },
  { label: 'New York',     lat: 40.7128, lng: -74.0060  },
  { label: 'New Orleans',  lat: 29.9511, lng: -90.0715  },
  { label: 'Los Angeles',  lat: 34.0522, lng: -118.2437 },
];

// ─── Establishment helpers ─────────────────────────────────────────────────────
function categoryEmoji(category) {
  if (!category) return '📍';
  const c = category.toLowerCase();
  if (c.includes('restaurant') || c.includes('cafe') || c.includes('diner')) return '🍽';
  if (c.includes('bar') || c.includes('pub') || c.includes('brewery')) return '🍺';
  if (c.includes('dog park') || c.includes('park')) return '🐾';
  if (c.includes('retail') || c.includes('store') || c.includes('shop') || c.includes('boutique')) return '🛍';
  if (c.includes('coffee')) return '☕';
  if (c.includes('hotel') || c.includes('lodging')) return '🏨';
  if (c.includes('wellness') || c.includes('groom') || c.includes('vet') || c.includes('daycare') || c.includes('training')) return '🏥';
  if (c.includes('trail') || c.includes('hike') || c.includes('path')) return '🥾';
  return '📍';
}

function ratingDisplay(rating, reviewCount) {
  if (!reviewCount || reviewCount === 0) return 'No reviews yet';
  return `${typeof rating === 'number' ? rating.toFixed(1) : rating} ★  (${reviewCount} review${reviewCount !== 1 ? 's' : ''})`;
}

function formatReviewDate(ts) {
  if (!ts) return '';
  try {
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

function openDirections(est) {
  const q = encodeURIComponent(`${est.name}, ${est.address}, ${est.city}, ${est.state}`);
  const url =
    Platform.OS === 'ios'
      ? `maps://app?q=${q}`
      : `geo:${est.latitude},${est.longitude}?q=${q}`;
  Linking.canOpenURL(url)
    .then((supported) => {
      if (supported) return Linking.openURL(url);
      return Linking.openURL(`https://maps.google.com/maps?q=${q}`);
    })
    .catch(() => Linking.openURL(`https://maps.google.com/maps?q=${q}`));
}

// ─── Vaccination helper ────────────────────────────────────────────────────────
function vaccineStatus(health) {
  if (!health) return 'unknown';
  const { rabiesVaccine, bordetellaVaccine, dhppVaccine } = health;
  const core = [rabiesVaccine, bordetellaVaccine, dhppVaccine];
  if (core.every((v) => v === 'Yes')) return 'current';
  return 'incomplete';
}

// ─── Main screen ───────────────────────────────────────────────────────────────
export default function HomeMapScreen({ navigation }) {
  const [location,         setLocation]         = useState(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [nearbyDogs,       setNearbyDogs]       = useState([]);
  const [loading,          setLoading]          = useState(true);

  // Establishments
  const [establishments,        setEstablishments]        = useState([]);
  const [activeFilter,          setActiveFilter]          = useState('all');
  const [selectedEstablishment, setSelectedEstablishment] = useState(null);

  // Establishment reviews
  const [estReviews,     setEstReviews]     = useState([]);
  const [userReview,     setUserReview]     = useState(null);  // current user's existing review or null
  const [reviewsLoading, setReviewsLoading] = useState(false);

  // Review modal
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [reviewRating,       setReviewRating]       = useState(0);
  const [reviewComment,      setReviewComment]      = useState('');
  const [submittingReview,   setSubmittingReview]   = useState(false);

  // Claim modal
  const [claimModalVisible, setClaimModalVisible] = useState(false);
  const [claimOwnerName,    setClaimOwnerName]    = useState('');
  const [claimEmail,        setClaimEmail]        = useState('');
  const [claimPhone,        setClaimPhone]        = useState('');
  const [submittingClaim,   setSubmittingClaim]   = useState(false);
  const [claimSuccess,      setClaimSuccess]      = useState(false);

  // Bottom sheet state (dog)
  const [selectedDog,  setSelectedDog]  = useState(null);
  const [ownerName,    setOwnerName]    = useState('');
  const [requesting,   setRequesting]   = useState(false);

  // City switcher
  const [selectedCity, setSelectedCity] = useState(null);

  // Dev seed tool
  const [seedStatus, setSeedStatus] = useState('idle');
  const sheetAnim    = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const mapRef       = useRef(null);

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

  // ── Establishments listener ──
  useEffect(() => {
    const q = query(collection(db, 'establishments'), where('status', '==', 'active'));
    const unsub = onSnapshot(q, (snap) => {
      setEstablishments(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  // ── Load reviews when establishment sheet opens ──
  useEffect(() => {
    if (!selectedEstablishment) {
      setEstReviews([]);
      setUserReview(null);
      return;
    }
    loadEstReviews(selectedEstablishment.id);
  }, [selectedEstablishment?.id]);

  async function loadEstReviews(estId) {
    if (!estId) return;
    setReviewsLoading(true);
    try {
      const recentQ = query(
        collection(db, 'establishments', estId, 'reviews'),
        orderBy('createdAt', 'desc'),
        limit(3)
      );
      const recentSnap = await getDocs(recentQ);
      setEstReviews(recentSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      const userQ = query(
        collection(db, 'establishments', estId, 'reviews'),
        where('userId', '==', auth.currentUser.uid)
      );
      const userSnap = await getDocs(userQ);
      setUserReview(
        userSnap.empty ? null : { id: userSnap.docs[0].id, ...userSnap.docs[0].data() }
      );
    } catch {
      // fail silently — reviews are non-critical
    } finally {
      setReviewsLoading(false);
    }
  }

  // ── Fetch owner name when dog sheet opens ──
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
    setSelectedEstablishment(null);
    Animated.parallel([
      Animated.spring(sheetAnim, { toValue: 0, useNativeDriver: true, tension: 68, friction: 12 }),
      Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }

  function openEstablishmentSheet(est) {
    setSelectedEstablishment(est);
    setSelectedDog(null);
    setOwnerName('');
    Animated.parallel([
      Animated.spring(sheetAnim, { toValue: 0, useNativeDriver: true, tension: 68, friction: 12 }),
      Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }

  function flyToCity(city) {
    setSelectedCity(city.label);
    mapRef.current?.animateToRegion(
      { latitude: city.lat, longitude: city.lng, latitudeDelta: 0.12, longitudeDelta: 0.12 },
      800
    );
  }

  function closeSheet() {
    Animated.parallel([
      Animated.spring(sheetAnim, { toValue: SHEET_HEIGHT, useNativeDriver: true, tension: 80, friction: 14 }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      setSelectedDog(null);
      setOwnerName('');
      setSelectedEstablishment(null);
    });
  }

  // ── Submit review ──
  async function handleSubmitReview() {
    if (!selectedEstablishment || reviewRating === 0) return;
    const trimmed = reviewComment.trim();
    if (trimmed.length < 20) {
      Alert.alert('Too short', 'Please write at least 20 characters.');
      return;
    }
    setSubmittingReview(true);
    try {
      const estId  = selectedEstablishment.id;
      const estRef = doc(db, 'establishments', estId);

      // Write the review document
      await addDoc(collection(db, 'establishments', estId, 'reviews'), {
        userId:        auth.currentUser.uid,
        rating:        reviewRating,
        comment:       trimmed,
        createdAt:     serverTimestamp(),
        visitVerified: false,
      });

      // Recalculate parent rating + reviewCount atomically
      let newRating, newCount;
      await runTransaction(db, async (tx) => {
        const estSnap = await tx.get(estRef);
        const data    = estSnap.data();
        const oldCount  = data.reviewCount ?? 0;
        const oldRating = data.rating      ?? 0;
        newCount  = oldCount + 1;
        newRating = Math.round(((oldRating * oldCount + reviewRating) / newCount) * 10) / 10;
        tx.update(estRef, { rating: newRating, reviewCount: newCount });
      });

      // Optimistically update the selected establishment in local state
      setSelectedEstablishment((prev) => prev ? ({ ...prev, rating: newRating, reviewCount: newCount }) : prev);

      // Reset modal state and close
      setReviewModalVisible(false);
      setReviewRating(0);
      setReviewComment('');

      // Reload reviews (will now include the new one at the top)
      await loadEstReviews(estId);
    } catch {
      Alert.alert('Error', 'Could not submit your review. Please try again.');
    } finally {
      setSubmittingReview(false);
    }
  }

  function openReviewModal() {
    setReviewRating(0);
    setReviewComment('');
    setReviewModalVisible(true);
  }

  function openClaimModal() {
    setClaimOwnerName('');
    setClaimEmail('');
    setClaimPhone('');
    setClaimSuccess(false);
    setClaimModalVisible(true);
  }

  async function handleSubmitClaim() {
    const name  = claimOwnerName.trim();
    const email = claimEmail.trim().toLowerCase();
    const phone = claimPhone.trim();
    if (!name || !email || !phone) {
      Alert.alert('Missing info', 'Please fill in all fields.');
      return;
    }
    setSubmittingClaim(true);
    try {
      await addDoc(collection(db, 'claimRequests'), {
        establishmentId:   selectedEstablishment.id,
        establishmentName: selectedEstablishment.name,
        ownerName:         name,
        email,
        phone,
        submittedBy:       auth.currentUser.uid,
        status:            'pending',
        createdAt:         serverTimestamp(),
      });
      setClaimSuccess(true);
    } catch {
      Alert.alert('Error', 'Could not submit your request. Please try again.');
    } finally {
      setSubmittingClaim(false);
    }
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
      'Add 3 fake dogs near Denver to Firestore?\n\nBuddy (Golden Retriever), Luna (French Bulldog), Max (Husky)',
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
        latitude:       location.latitude,
        longitude:      location.longitude,
        latitudeDelta:  0.05,
        longitudeDelta: 0.05,
      });
    }
  }

  // ── Derived ──
  const sheetOpen = !!(selectedDog || selectedEstablishment);

  const filteredEstablishments = activeFilter === 'all'
    ? establishments
    : establishments.filter((e) => {
        const cat = (e.category ?? '').toLowerCase().replace(/[\s_-]/g, '');
        return cat.includes(activeFilter.toLowerCase());
      });

  // ─── Loading / permission states ───────────────────────────────────────────
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

  const vacStatus  = selectedDog ? vaccineStatus(selectedDog.health) : null;
  const ownerFirst = ownerName ? ownerName.split(' ')[0] : null;

  const reviewSubmitDisabled =
    submittingReview || reviewRating === 0 || reviewComment.trim().length < 20;

  // ─── Render ────────────────────────────────────────────────────────────────
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
        onPress={() => { if (sheetOpen) closeSheet(); }}
      >
        {location && (
          <Circle
            center={{ latitude: location.latitude, longitude: location.longitude }}
            radius={RADIUS_MILES * 1609.34}
            strokeColor={`${colors.primary}40`}
            fillColor={`${colors.primary}10`}
          />
        )}

        {/* Dog markers */}
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
                {(dog.pawTapCount ?? 0) > 0 && (
                  <Text style={styles.markerPawCount}>🐾 {dog.pawTapCount}</Text>
                )}
              </View>
              <View style={styles.markerArrow} />
            </View>
          </Marker>
        ))}

        {/* Establishment markers */}
        {filteredEstablishments.map((est) => (
          <Marker
            key={est.id}
            coordinate={{ latitude: est.latitude, longitude: est.longitude }}
            onPress={() => openEstablishmentSheet(est)}
          >
            <View style={styles.estMarkerContainer}>
              {est.isSponsored && (
                <View style={styles.sponsoredPinPill}>
                  <Text style={styles.sponsoredPinText}>Sponsored</Text>
                </View>
              )}
              <View style={[styles.estMarkerPin, est.isSponsored && styles.estMarkerPinSponsored]}>
                <Text style={styles.estMarkerEmoji}>{categoryEmoji(est.category)}</Text>
              </View>
              <View style={[styles.estMarkerArrow, est.isSponsored && styles.estMarkerArrowSponsored]} />
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

      {/* ── Filter bar ── */}
      <ScrollView
        horizontal
        style={styles.filterBar}
        contentContainerStyle={styles.filterBarContent}
        showsHorizontalScrollIndicator={false}
        pointerEvents="box-none"
      >
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.value}
            style={[styles.filterPill, activeFilter === f.value && styles.filterPillActive]}
            onPress={() => setActiveFilter(f.value)}
            activeOpacity={0.8}
          >
            <Text style={[styles.filterPillText, activeFilter === f.value && styles.filterPillTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── City switcher ── */}
      <ScrollView
        horizontal
        style={styles.cityBar}
        contentContainerStyle={styles.cityBarContent}
        showsHorizontalScrollIndicator={false}
        pointerEvents="box-none"
      >
        {CITIES.map((city) => (
          <TouchableOpacity
            key={city.label}
            style={[styles.cityPill, selectedCity === city.label && styles.cityPillActive]}
            onPress={() => flyToCity(city)}
            activeOpacity={0.8}
          >
            <Text style={[styles.cityPillText, selectedCity === city.label && styles.cityPillTextActive]}>
              {city.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── Recenter ── */}
      <TouchableOpacity style={styles.recenterBtn} onPress={recenter} activeOpacity={0.85}>
        <Ionicons name="locate" size={22} color={colors.primary} />
      </TouchableOpacity>

      {/* ── Dev seed button (dev only) ── */}
      {__DEV__ && seedStatus !== 'done' && (
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
      {__DEV__ && seedStatus === 'done' && (
        <TouchableOpacity style={styles.seedClearBtn} onPress={handleClearSeed} activeOpacity={0.8}>
          <Text style={styles.seedClearText}>🗑 Clear Test Dogs</Text>
        </TouchableOpacity>
      )}

      {/* ── Nearby strip (hidden when sheet is open) ── */}
      {nearbyDogs.length > 0 && !sheetOpen && (
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
      {sheetOpen && (
        <Animated.View
          style={[styles.backdrop, { opacity: backdropAnim }]}
          pointerEvents={sheetOpen ? 'auto' : 'none'}
        >
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={closeSheet} activeOpacity={1} />
        </Animated.View>
      )}

      {/* ── Bottom Sheet ── */}
      <Animated.View
        style={[styles.sheet, { transform: [{ translateY: sheetAnim }] }]}
        pointerEvents={sheetOpen ? 'auto' : 'none'}
      >
        {/* ── Dog sheet content ── */}
        {selectedDog && (
          <>
            <View style={styles.sheetHandle} />
            <TouchableOpacity style={styles.sheetCloseBtn} onPress={closeSheet} hitSlop={12}>
              <Ionicons name="close" size={20} color={colors.textLight} />
            </TouchableOpacity>

            <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
              {/* Dog photo + name row */}
              <View style={styles.sheetTopRow}>
                <View style={styles.sheetPhotoWrapper}>
                  <DogAvatar uri={selectedDog.photoURL ?? selectedDog.photoUri} name={selectedDog.name} size={84} />
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

                  {selectedDog.distance !== undefined && (
                    <View style={styles.distRow}>
                      <Ionicons name="location" size={12} color={colors.primary} />
                      <Text style={styles.distText}>{formatDistance(selectedDog.distance)} away</Text>
                    </View>
                  )}

                  {ownerFirst ? (
                    <Text style={styles.ownerText}>Owned by {ownerFirst}</Text>
                  ) : null}

                  {(selectedDog.pawTapCount ?? 0) > 0 && (
                    <View style={styles.pawCountRow}>
                      <Text style={styles.pawCountText}>
                        🐾 {selectedDog.pawTapCount} Great Playmate{selectedDog.pawTapCount !== 1 ? 's' : ''}
                      </Text>
                    </View>
                  )}
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
                      {selectedDog.energyLevel === 'Low' ? '🐾' :
                       selectedDog.energyLevel === 'Medium' ? '⚡' : '🔥'}{' '}
                      {selectedDog.energyLevel} Energy
                    </Text>
                  </View>
                ) : null}
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

        {/* ── Establishment sheet content ── */}
        {selectedEstablishment && (
          <>
            <View style={styles.sheetHandle} />
            <TouchableOpacity style={styles.sheetCloseBtn} onPress={closeSheet} hitSlop={12}>
              <Ionicons name="close" size={20} color={colors.textLight} />
            </TouchableOpacity>

            <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
              {/* Sponsored disclosure (FTC compliance) */}
              {selectedEstablishment.isSponsored && (
                <View style={styles.sponsoredSheetPill}>
                  <Text style={styles.sponsoredSheetText}>Sponsored</Text>
                </View>
              )}

              {/* Name + verified badge */}
              <View style={styles.estNameRow}>
                <Text style={styles.estName}>{selectedEstablishment.name}</Text>
                {selectedEstablishment.isVerified && (
                  <View style={styles.verifiedBadge}>
                    <Ionicons name="checkmark-circle" size={13} color={colors.success} />
                    <Text style={styles.verifiedText}>Verified</Text>
                  </View>
                )}
              </View>

              {/* Category badge */}
              <View style={styles.estCategoryBadge}>
                <Text style={styles.estCategoryText}>
                  {categoryEmoji(selectedEstablishment.category)}  {selectedEstablishment.category}
                </Text>
              </View>

              {/* Address */}
              <View style={styles.estAddressRow}>
                <Ionicons name="location-outline" size={14} color={colors.textMedium} />
                <Text style={styles.estAddressText}>
                  {selectedEstablishment.address}, {selectedEstablishment.city}, {selectedEstablishment.state}
                </Text>
              </View>

              {/* Rating */}
              <View style={styles.estRatingRow}>
                <Ionicons name="star" size={14} color={colors.secondary} />
                <Text style={styles.estRatingText}>
                  {ratingDisplay(selectedEstablishment.rating, selectedEstablishment.reviewCount)}
                </Text>
              </View>

              {/* Amenity chips */}
              {selectedEstablishment.amenities?.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.amenityScroll}
                  contentContainerStyle={styles.amenityScrollContent}
                >
                  {selectedEstablishment.amenities.map((amenity) => (
                    <View key={amenity} style={styles.amenityChip}>
                      <Text style={styles.amenityChipText}>{amenity}</Text>
                    </View>
                  ))}
                </ScrollView>
              )}

              {/* ── Reviews section ── */}
              <View style={styles.reviewsDivider} />

              <View style={styles.reviewsHeader}>
                <Text style={styles.reviewsTitle}>Reviews</Text>
                {reviewsLoading && (
                  <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: spacing.sm }} />
                )}
              </View>

              {!reviewsLoading && estReviews.length === 0 && (
                <Text style={styles.noReviewsText}>No reviews yet. Be the first!</Text>
              )}

              {estReviews.map((review) => (
                <View key={review.id} style={styles.reviewCard}>
                  <View style={styles.reviewCardHeader}>
                    {/* Generic member avatar */}
                    <View style={styles.reviewAvatar}>
                      <Ionicons name="paw" size={14} color={colors.white} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.reviewMeta}>
                        <Text style={styles.reviewAuthor}>Wag Member</Text>
                        {review.visitVerified && (
                          <View style={styles.visitedBadge}>
                            <Text style={styles.visitedBadgeText}>Visited</Text>
                          </View>
                        )}
                      </View>
                      {/* Paw rating */}
                      <View style={styles.reviewPawRow}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Text
                            key={n}
                            style={[styles.reviewPaw, n > review.rating && styles.reviewPawEmpty]}
                          >
                            🐾
                          </Text>
                        ))}
                        <Text style={styles.reviewDate}>{formatReviewDate(review.createdAt)}</Text>
                      </View>
                    </View>
                  </View>
                  <Text style={styles.reviewComment}>{review.comment}</Text>
                </View>
              ))}

              {/* Leave a Review / Already reviewed */}
              <View style={styles.reviewActionRow}>
                {userReview ? (
                  <View style={styles.alreadyReviewedBox}>
                    <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                    <Text style={styles.alreadyReviewedText}>You've reviewed this place</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionBtnOutline]}
                    onPress={openReviewModal}
                    activeOpacity={0.85}
                    disabled={reviewsLoading}
                  >
                    <Ionicons name="star-outline" size={18} color={colors.primary} />
                    <Text style={styles.actionBtnTextOutline}>Leave a Review</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Get Directions */}
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnPrimary]}
                onPress={() => openDirections(selectedEstablishment)}
                activeOpacity={0.85}
              >
                <Ionicons name="navigate" size={18} color={colors.white} />
                <Text style={styles.actionBtnTextLight}>Get Directions</Text>
              </TouchableOpacity>

              {/* Claim This Business */}
              {selectedEstablishment.claimedBy === null && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnClaim]}
                  onPress={openClaimModal}
                  activeOpacity={0.85}
                >
                  <Ionicons name="briefcase-outline" size={18} color="#EA580C" />
                  <Text style={styles.actionBtnTextClaim}>Claim This Business</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </>
        )}
      </Animated.View>

      {/* ── Review Modal ── */}
      <Modal
        visible={reviewModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setReviewModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            onPress={() => setReviewModalVisible(false)}
            activeOpacity={1}
          />
          <View style={styles.modalSheet}>
            {/* Handle */}
            <View style={styles.modalHandle} />

            <Text style={styles.modalTitle}>Leave a Review</Text>
            {selectedEstablishment && (
              <Text style={styles.modalSubtitle}>{selectedEstablishment.name}</Text>
            )}

            {/* Paw rating selector */}
            <Text style={styles.modalLabel}>Your rating</Text>
            <View style={styles.pawRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity
                  key={n}
                  onPress={() => setReviewRating(n)}
                  activeOpacity={0.7}
                  hitSlop={8}
                >
                  <Text style={[styles.pawSelector, n <= reviewRating ? styles.pawSelected : styles.pawUnselected]}>
                    🐾
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {reviewRating > 0 && (
              <Text style={styles.ratingLabel}>
                {['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent!'][reviewRating]}
              </Text>
            )}

            {/* Comment input */}
            <Text style={styles.modalLabel}>Your comment</Text>
            <TextInput
              style={styles.reviewInput}
              multiline
              placeholder="Tell others about your visit with your dog..."
              placeholderTextColor={colors.mediumGray}
              value={reviewComment}
              onChangeText={setReviewComment}
              maxLength={1000}
              textAlignVertical="top"
            />
            <View style={styles.charCountRow}>
              {reviewComment.trim().length < 20 && reviewComment.length > 0 && (
                <Text style={styles.charCountHint}>
                  {20 - reviewComment.trim().length} more character{20 - reviewComment.trim().length !== 1 ? 's' : ''} needed
                </Text>
              )}
              <Text style={[styles.charCount, reviewComment.length >= 950 && styles.charCountWarn]}>
                {reviewComment.length}/1000
              </Text>
            </View>

            {/* Submit */}
            <TouchableOpacity
              style={[
                styles.actionBtn,
                styles.actionBtnPrimary,
                reviewSubmitDisabled && styles.actionBtnDisabled,
              ]}
              onPress={handleSubmitReview}
              disabled={reviewSubmitDisabled}
              activeOpacity={0.85}
            >
              {submittingReview
                ? <ActivityIndicator color={colors.white} />
                : <>
                    <Ionicons name="star" size={18} color={colors.white} />
                    <Text style={styles.actionBtnTextLight}>Submit Review</Text>
                  </>
              }
            </TouchableOpacity>

            {/* Cancel */}
            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={() => setReviewModalVisible(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Claim Modal ── */}
      <Modal
        visible={claimModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setClaimModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            onPress={() => setClaimModalVisible(false)}
            activeOpacity={1}
          />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />

            {claimSuccess ? (
              <>
                <View style={styles.claimSuccessIcon}>
                  <Ionicons name="checkmark-circle" size={52} color={colors.success} />
                </View>
                <Text style={styles.claimSuccessTitle}>Request Submitted!</Text>
                <Text style={styles.claimSuccessBody}>
                  We'll review your claim for {selectedEstablishment?.name} and follow up via email.
                </Text>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnPrimary]}
                  onPress={() => setClaimModalVisible(false)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.actionBtnTextLight}>Done</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>Claim This Business</Text>
                {selectedEstablishment && (
                  <Text style={styles.modalSubtitle}>{selectedEstablishment.name}</Text>
                )}

                <Text style={styles.modalLabel}>Your name</Text>
                <TextInput
                  style={styles.claimInput}
                  placeholder="Full name"
                  placeholderTextColor={colors.mediumGray}
                  value={claimOwnerName}
                  onChangeText={setClaimOwnerName}
                  autoCapitalize="words"
                />

                <Text style={styles.modalLabel}>Business email</Text>
                <TextInput
                  style={styles.claimInput}
                  placeholder="you@yourbusiness.com"
                  placeholderTextColor={colors.mediumGray}
                  value={claimEmail}
                  onChangeText={setClaimEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <Text style={styles.modalLabel}>Phone number</Text>
                <TextInput
                  style={styles.claimInput}
                  placeholder="(555) 000-0000"
                  placeholderTextColor={colors.mediumGray}
                  value={claimPhone}
                  onChangeText={setClaimPhone}
                  keyboardType="phone-pad"
                />

                <TouchableOpacity
                  style={[
                    styles.actionBtn,
                    styles.actionBtnPrimary,
                    (!claimOwnerName.trim() || !claimEmail.trim() || !claimPhone.trim() || submittingClaim) && styles.actionBtnDisabled,
                  ]}
                  onPress={handleSubmitClaim}
                  disabled={!claimOwnerName.trim() || !claimEmail.trim() || !claimPhone.trim() || submittingClaim}
                  activeOpacity={0.85}
                >
                  {submittingClaim
                    ? <ActivityIndicator color={colors.white} />
                    : <Text style={styles.actionBtnTextLight}>Submit</Text>
                  }
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setClaimModalVisible(false)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  map:       { flex: 1 },

  centered:    { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.offWhite, padding: spacing.xl },
  loadingText: { marginTop: spacing.md, color: colors.textMedium, fontSize: 15 },
  permText:    { marginTop: spacing.md, fontSize: 18, fontWeight: '700', color: colors.darkBrown, textAlign: 'center' },
  permSubText: { marginTop: spacing.sm, fontSize: 14, color: colors.textMedium, textAlign: 'center', lineHeight: 20 },

  // Header pill
  header: { position: 'absolute', top: 16, alignSelf: 'center' },
  headerContent: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.white, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: borderRadius.full, ...shadows.card,
  },
  headerText: { fontSize: 14, fontWeight: '600', color: colors.darkBrown },

  // Filter bar
  filterBar:        { position: 'absolute', top: 60, left: 0, right: 0 },
  filterBarContent: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, gap: spacing.xs },
  filterPill:       { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: borderRadius.full, backgroundColor: colors.white, ...shadows.card },
  filterPillActive: { backgroundColor: colors.primary },
  filterPillText:   { fontSize: 13, fontWeight: '600', color: colors.darkBrown },
  filterPillTextActive: { color: colors.white },

  cityBar:        { position: 'absolute', top: 108, left: 0, right: 0 },
  cityBarContent: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, gap: spacing.xs },
  cityPill:       { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: borderRadius.full, backgroundColor: 'rgba(255,255,255,0.85)', borderWidth: 1, borderColor: '#E0E0E0', ...shadows.card },
  cityPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  cityPillText:   { fontSize: 12, fontWeight: '500', color: colors.darkBrown },
  cityPillTextActive: { color: colors.white, fontWeight: '600' },

  // Recenter
  recenterBtn: {
    position: 'absolute', top: 72, right: 16,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...shadows.card,
  },

  // Dog markers
  markerContainer: { alignItems: 'center' },
  markerAvatar:    { borderWidth: 2, borderColor: colors.primary },
  markerBubble:    { backgroundColor: colors.primary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: borderRadius.full, marginTop: 2 },
  markerName:      { color: colors.white, fontSize: 11, fontWeight: '700' },
  markerPawCount:  { color: colors.white, fontSize: 10, fontWeight: '700', marginTop: 1 },
  markerArrow:     { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: colors.primary },

  // Establishment markers
  estMarkerContainer: { alignItems: 'center' },
  estMarkerPin: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: colors.white, ...shadows.card,
  },
  estMarkerEmoji: { fontSize: 18 },
  estMarkerArrow: {
    width: 0, height: 0,
    borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    borderTopColor: colors.primary, marginTop: -1,
  },

  // Dev seed
  seedBtn: {
    position: 'absolute', top: 124, right: 16,
    backgroundColor: colors.darkBrown,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: borderRadius.full, minWidth: 44, alignItems: 'center', ...shadows.card,
  },
  seedBtnRunning: { opacity: 0.7 },
  seedBtnText:    { fontSize: 12, fontWeight: '700', color: colors.white },
  seedClearBtn: {
    position: 'absolute', top: 124, right: 16,
    backgroundColor: '#9B2335',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: borderRadius.full, alignItems: 'center', ...shadows.card,
  },
  seedClearText: { fontSize: 12, fontWeight: '700', color: colors.white },

  // Nearby strip
  nearbyStrip: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.white, borderTopLeftRadius: borderRadius.xl, borderTopRightRadius: borderRadius.xl,
    padding: spacing.lg, paddingBottom: spacing.xl, ...shadows.card,
  },
  nearbyStripTitle: { fontSize: 16, fontWeight: '800', color: colors.darkBrown, marginBottom: spacing.md },
  nearbyItem:  { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  nearbyInfo:  { flex: 1 },
  nearbyName:  { fontSize: 15, fontWeight: '700', color: colors.darkBrown },
  nearbyBreed: { fontSize: 12, color: colors.textLight },
  nearbyDist:  { fontSize: 12, color: colors.primary, fontWeight: '600' },

  // Backdrop
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)', zIndex: 10 },

  // Bottom sheet
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: SHEET_HEIGHT,
    backgroundColor: colors.white,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    zIndex: 20, ...shadows.card,
    shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 16,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border, alignSelf: 'center', marginTop: 12,
  },
  sheetCloseBtn: {
    position: 'absolute', top: 14, right: 16,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.lightGray, alignItems: 'center', justifyContent: 'center',
    zIndex: 10,
  },
  sheetContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl },

  // Dog sheet
  sheetTopRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.md },
  sheetPhotoWrapper: { position: 'relative' },
  vacBadge: {
    position: 'absolute', bottom: 0, right: -4,
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.white, borderWidth: 2, borderColor: colors.white,
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
  pawCountRow:  { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs },
  pawCountText: { fontSize: 12, fontWeight: '700', color: colors.primary },

  // Badges
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  badge: { paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs, borderRadius: borderRadius.full, backgroundColor: colors.lightGray },
  badgeGreen:      { backgroundColor: '#D1FAE5' },
  badgeYellow:     { backgroundColor: '#FEF3C7' },
  badgeText:       { fontSize: 12, fontWeight: '600', color: colors.textMedium },
  badgeTextGreen:  { color: '#065F46' },
  badgeTextYellow: { color: '#92400E' },

  tagCloud: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },

  // Action buttons
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    height: 52, borderRadius: borderRadius.full, marginBottom: spacing.sm, ...shadows.button,
  },
  actionBtnPrimary:    { backgroundColor: colors.primary },
  actionBtnSecondary:  { backgroundColor: colors.darkBrown },
  actionBtnOutline: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.primary,
    shadowOpacity: 0,
    elevation: 0,
  },
  actionBtnDisabled:   { opacity: 0.45 },
  actionBtnTextLight:  { fontSize: 16, fontWeight: '700', color: colors.white, letterSpacing: 0.2 },
  actionBtnTextOutline:{ fontSize: 16, fontWeight: '700', color: colors.primary, letterSpacing: 0.2 },

  // Establishment sheet
  estNameRow: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm,
    marginBottom: spacing.xs, marginTop: spacing.sm,
  },
  estName: { fontSize: 22, fontWeight: '800', color: colors.darkBrown, flexShrink: 1 },
  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#D1FAE5', paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  verifiedText:  { fontSize: 11, fontWeight: '700', color: '#065F46' },
  estCategoryBadge: {
    alignSelf: 'flex-start',
    backgroundColor: `${colors.primary}18`,
    paddingHorizontal: spacing.md, paddingVertical: 5,
    borderRadius: borderRadius.full, marginBottom: spacing.md,
  },
  estCategoryText:  { fontSize: 13, fontWeight: '700', color: colors.primary },
  estAddressRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: spacing.sm },
  estAddressText:   { fontSize: 13, color: colors.textMedium, flex: 1, lineHeight: 18 },
  estRatingRow:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md },
  estRatingText:    { fontSize: 14, fontWeight: '600', color: colors.darkBrown },
  amenityScroll:        { marginBottom: spacing.sm },
  amenityScrollContent: { gap: spacing.xs, paddingRight: spacing.sm },
  amenityChip: {
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: borderRadius.full,
    backgroundColor: `${colors.secondary}22`,
    borderWidth: 1, borderColor: `${colors.secondary}60`,
  },
  amenityChipText: { fontSize: 12, fontWeight: '600', color: colors.darkBrown },

  // Reviews section
  reviewsDivider: {
    height: 1, backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  reviewsHeader: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: spacing.sm,
  },
  reviewsTitle:    { fontSize: 16, fontWeight: '800', color: colors.darkBrown },
  noReviewsText:   { fontSize: 13, color: colors.textLight, marginBottom: spacing.md },

  reviewCard: {
    backgroundColor: colors.offWhite,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  reviewCardHeader: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs },
  reviewAvatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  reviewMeta:   { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  reviewAuthor: { fontSize: 13, fontWeight: '700', color: colors.darkBrown },
  visitedBadge: {
    backgroundColor: `${colors.success}22`,
    paddingHorizontal: 6, paddingVertical: 1,
    borderRadius: borderRadius.full,
  },
  visitedBadgeText: { fontSize: 10, fontWeight: '700', color: colors.success },
  reviewPawRow: { flexDirection: 'row', alignItems: 'center', gap: 1, marginTop: 2 },
  reviewPaw:      { fontSize: 11 },
  reviewPawEmpty: { opacity: 0.2 },
  reviewDate:   { fontSize: 11, color: colors.textLight, marginLeft: spacing.xs },
  reviewComment:{ fontSize: 13, color: colors.textMedium, lineHeight: 19 },

  reviewActionRow: { marginBottom: spacing.sm },
  alreadyReviewedBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  alreadyReviewedText: { fontSize: 13, color: colors.success, fontWeight: '600' },

  // Review modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  modalSheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    ...shadows.card,
    shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.15, shadowRadius: 16, elevation: 20,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border, alignSelf: 'center', marginVertical: 12,
  },
  modalTitle:    { fontSize: 20, fontWeight: '800', color: colors.darkBrown, marginBottom: 2 },
  modalSubtitle: { fontSize: 13, color: colors.textMedium, marginBottom: spacing.md },
  modalLabel:    { fontSize: 13, fontWeight: '700', color: colors.darkBrown, marginBottom: spacing.xs },

  pawRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xs },
  pawSelector:  { fontSize: 32 },
  pawSelected:  { opacity: 1 },
  pawUnselected:{ opacity: 0.2 },
  ratingLabel:  { fontSize: 13, fontWeight: '600', color: colors.primary, marginBottom: spacing.md },

  reviewInput: {
    height: 110,
    borderWidth: 1.5, borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: 14, color: colors.darkBrown,
    backgroundColor: colors.offWhite,
    marginBottom: spacing.xs,
  },
  charCountRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  charCountHint:{ fontSize: 11, color: colors.primary },
  charCount:    { fontSize: 11, color: colors.textLight },
  charCountWarn:{ color: colors.error },

  modalCancelBtn: { alignItems: 'center', paddingVertical: spacing.sm },
  modalCancelText:{ fontSize: 15, color: colors.textMedium, fontWeight: '600' },

  // Sponsored — map pin
  sponsoredPinPill: {
    backgroundColor: '#EA580C',
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: borderRadius.full,
    marginBottom: 3,
  },
  sponsoredPinText: { fontSize: 9, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
  estMarkerPinSponsored:   { borderColor: '#EA580C' },
  estMarkerArrowSponsored: { borderTopColor: '#EA580C' },

  // Sponsored — bottom sheet
  sponsoredSheetPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#EA580C',
    paddingHorizontal: spacing.sm + 2, paddingVertical: 4,
    borderRadius: borderRadius.full,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  sponsoredSheetText: { fontSize: 11, fontWeight: '800', color: '#fff', letterSpacing: 0.4 },

  // Claim button
  actionBtnClaim: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#EA580C',
    shadowOpacity: 0,
    elevation: 0,
  },
  actionBtnTextClaim: { fontSize: 16, fontWeight: '700', color: '#EA580C', letterSpacing: 0.2 },

  // Claim modal
  claimInput: {
    height: 48,
    borderWidth: 1.5, borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    fontSize: 14, color: colors.darkBrown,
    backgroundColor: colors.offWhite,
    marginBottom: spacing.md,
  },
  claimSuccessIcon:  { alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.sm },
  claimSuccessTitle: { fontSize: 20, fontWeight: '800', color: colors.darkBrown, textAlign: 'center', marginBottom: spacing.sm },
  claimSuccessBody:  { fontSize: 14, color: colors.textMedium, textAlign: 'center', lineHeight: 21, marginBottom: spacing.lg },
});

// ─── Warm map style ────────────────────────────────────────────────────────────
const mapStyle = [
  { elementType: 'geometry',            stylers: [{ color: '#f5f0e8' }] },
  { elementType: 'labels.text.fill',    stylers: [{ color: '#6B5B4E' }] },
  { featureType: 'road',    elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'water',   elementType: 'geometry', stylers: [{ color: '#c9e8f0' }] },
  { featureType: 'park',    elementType: 'geometry', stylers: [{ color: '#d8f0d0' }] },
];
