import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Image,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { formatDistance } from '../utils/distance';
import Button from '../components/Button';
import Tag from '../components/Tag';
import { colors, spacing, borderRadius, shadows } from '../config/theme';

const { width } = Dimensions.get('window');

export default function DogProfileCard({ route, navigation }) {
  const { dog } = route.params;
  const [ownerName, setOwnerName] = useState('');
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'owners', dog.ownerId));
        if (snap.exists()) setOwnerName(snap.data().name);
      } catch (_) {}
    })();
  }, [dog.ownerId]);

  async function handleRequestPlaydate() {
    setRequesting(true);
    try {
      await addDoc(collection(db, 'playdateRequests'), {
        fromOwnerId: auth.currentUser.uid,
        toOwnerId: dog.ownerId,
        dogId: dog.id,
        dogName: dog.name,
        status: 'pending',
        createdAt: serverTimestamp(),
      });
      Alert.alert(
        'Request Sent!',
        `Your playdate request for ${dog.name} has been sent to ${ownerName || 'their owner'}.`,
        [{ text: 'Great!', onPress: () => navigation.goBack() }]
      );
    } catch (err) {
      Alert.alert('Error', 'Could not send request. Please try again.');
    } finally {
      setRequesting(false);
    }
  }

  function openChat() {
    navigation.navigate('Messages', {
      screen: 'ChatThread',
      params: {
        otherOwnerId: dog.ownerId,
        otherOwnerName: ownerName || 'Owner',
        dogName: dog.name,
      },
    });
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      {/* Dog photo */}
      <View style={styles.photoContainer}>
        {dog.photoUri ? (
          <Image source={{ uri: dog.photoUri }} style={styles.photo} resizeMode="cover" />
        ) : (
          <View style={styles.photoPlaceholder}>
            <Ionicons name="paw" size={72} color={colors.secondary} />
          </View>
        )}
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={22} color={colors.darkBrown} />
        </TouchableOpacity>
      </View>

      {/* Info card */}
      <View style={styles.card}>
        {/* Name + distance */}
        <View style={styles.nameRow}>
          <Text style={styles.dogName}>{dog.name}</Text>
          {dog.distance !== undefined && (
            <View style={styles.distBadge}>
              <Ionicons name="location" size={12} color={colors.primary} />
              <Text style={styles.distText}>{formatDistance(dog.distance)}</Text>
            </View>
          )}
        </View>

        <Text style={styles.breed}>
          {dog.breed} · {dog.age} {dog.age === 1 ? 'yr' : 'yrs'} old · {dog.size}
        </Text>

        {ownerName ? (
          <View style={styles.ownerRow}>
            <Ionicons name="person-outline" size={14} color={colors.textLight} />
            <Text style={styles.ownerText}>Owner: {ownerName}</Text>
          </View>
        ) : null}

        {/* Temperament tags */}
        {dog.temperament?.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Personality</Text>
            <View style={styles.tagCloud}>
              {dog.temperament.map((t) => (
                <Tag key={t} label={t} selected />
              ))}
            </View>
          </View>
        )}

        {/* Action buttons */}
        <Button
          title="Request Playdate"
          onPress={handleRequestPlaydate}
          loading={requesting}
          style={styles.primaryBtn}
        />
        <Button
          title="Send a Message"
          variant="outline"
          onPress={openChat}
          style={styles.secondaryBtn}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.offWhite },
  container: { paddingBottom: spacing.xxl },
  photoContainer: {
    width: '100%',
    height: width * 0.85,
    backgroundColor: colors.lightGray,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF3E0',
  },
  backBtn: {
    position: 'absolute',
    top: 52,
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  card: {
    margin: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    ...shadows.card,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  dogName: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.darkBrown,
  },
  distBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FFF3E0',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  distText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },
  breed: {
    fontSize: 15,
    color: colors.textMedium,
    marginBottom: spacing.sm,
  },
  ownerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: spacing.md,
  },
  ownerText: {
    fontSize: 13,
    color: colors.textLight,
  },
  section: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.darkBrown,
    marginBottom: spacing.sm,
  },
  tagCloud: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  primaryBtn: {
    marginTop: spacing.lg,
  },
  secondaryBtn: {
    marginTop: spacing.sm,
  },
});
