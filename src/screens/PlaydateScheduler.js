import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import Button from '../components/Button';
import Input from '../components/Input';
import { colors, spacing, borderRadius, shadows } from '../config/theme';

const SUGGESTED_LOCATIONS = [
  'Local Dog Park',
  'Beach / Waterfront',
  'Backyard',
  'Trail / Hiking Path',
  'Pet-friendly Cafe',
];

export default function PlaydateScheduler({ route, navigation }) {
  const { otherOwnerId, otherOwnerName, dogName } = route.params || {};

  const [date, setDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  function formatDate(d) {
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function formatTime(d) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function onDateChange(event, selected) {
    setShowDatePicker(Platform.OS === 'ios');
    if (selected) {
      const newDate = new Date(date);
      newDate.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
      setDate(newDate);
    }
  }

  function onTimeChange(event, selected) {
    setShowTimePicker(Platform.OS === 'ios');
    if (selected) {
      const newDate = new Date(date);
      newDate.setHours(selected.getHours(), selected.getMinutes());
      setDate(newDate);
    }
  }

  async function handleSchedule() {
    if (!location.trim()) {
      Alert.alert('Location needed', 'Please enter or select a meeting location.');
      return;
    }
    if (date < new Date()) {
      Alert.alert('Invalid time', 'Please pick a future date and time.');
      return;
    }
    setLoading(true);
    try {
      await addDoc(collection(db, 'playdates'), {
        fromOwnerId: auth.currentUser.uid,
        toOwnerId: otherOwnerId,
        dogName,
        scheduledAt: date.toISOString(),
        location: location.trim(),
        notes: notes.trim(),
        status: 'scheduled',
        createdAt: serverTimestamp(),
      });
      Alert.alert(
        'Playdate Scheduled!',
        `Your playdate with ${dogName} is set for ${formatDate(date)} at ${formatTime(date)} at ${location}.`,
        [{ text: 'Woohoo!', onPress: () => navigation.goBack() }]
      );
    } catch (err) {
      Alert.alert('Error', 'Could not schedule playdate. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Schedule a Playdate</Text>
      {dogName && (
        <Text style={styles.subtitle}>
          with <Text style={styles.dogName}>{dogName}</Text>
          {otherOwnerName ? ` & ${otherOwnerName}` : ''}
        </Text>
      )}

      {/* Date picker */}
      <View style={styles.pickerCard}>
        <Text style={styles.pickerLabel}>Date</Text>
        <TouchableOpacity
          style={styles.pickerRow}
          onPress={() => setShowDatePicker(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="calendar-outline" size={20} color={colors.primary} />
          <Text style={styles.pickerValue}>{formatDate(date)}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.mediumGray} />
        </TouchableOpacity>
        {showDatePicker && (
          <DateTimePicker
            value={date}
            mode="date"
            minimumDate={new Date()}
            onChange={onDateChange}
          />
        )}
      </View>

      {/* Time picker */}
      <View style={styles.pickerCard}>
        <Text style={styles.pickerLabel}>Time</Text>
        <TouchableOpacity
          style={styles.pickerRow}
          onPress={() => setShowTimePicker(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="time-outline" size={20} color={colors.primary} />
          <Text style={styles.pickerValue}>{formatTime(date)}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.mediumGray} />
        </TouchableOpacity>
        {showTimePicker && (
          <DateTimePicker
            value={date}
            mode="time"
            onChange={onTimeChange}
          />
        )}
      </View>

      {/* Location */}
      <Input
        label="Meeting Location"
        value={location}
        onChangeText={setLocation}
        placeholder="Enter a spot..."
        autoCapitalize="words"
      />
      <Text style={styles.suggestLabel}>Suggested spots</Text>
      <View style={styles.suggestRow}>
        {SUGGESTED_LOCATIONS.map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.suggestChip, location === s && styles.suggestChipActive]}
            onPress={() => setLocation(s)}
            activeOpacity={0.7}
          >
            <Text style={[styles.suggestText, location === s && styles.suggestTextActive]}>
              {s}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Notes */}
      <Input
        label="Notes (optional)"
        value={notes}
        onChangeText={setNotes}
        placeholder="Any special details..."
        autoCapitalize="sentences"
        multiline
        numberOfLines={3}
        style={{ marginTop: spacing.sm }}
      />

      <Button
        title="Confirm Playdate"
        onPress={handleSchedule}
        loading={loading}
        style={styles.confirmBtn}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.offWhite },
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.darkBrown,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: colors.textMedium,
    textAlign: 'center',
    marginBottom: spacing.xl,
    marginTop: spacing.xs,
  },
  dogName: {
    fontWeight: '700',
    color: colors.primary,
  },
  pickerCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  pickerLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textLight,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pickerValue: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: colors.darkBrown,
  },
  suggestLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textLight,
    marginBottom: spacing.sm,
    marginTop: -spacing.xs,
  },
  suggestRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  suggestChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    backgroundColor: colors.lightGray,
    borderRadius: borderRadius.full,
  },
  suggestChipActive: {
    backgroundColor: colors.primary,
  },
  suggestText: {
    fontSize: 13,
    color: colors.textMedium,
    fontWeight: '600',
  },
  suggestTextActive: {
    color: colors.white,
  },
  confirmBtn: {
    marginTop: spacing.lg,
  },
});
