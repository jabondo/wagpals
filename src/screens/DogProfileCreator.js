import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { collection, addDoc, doc, updateDoc, setDoc, arrayUnion } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, db, storage } from '../config/firebase';
import Button from '../components/Button';
import Input from '../components/Input';
import Tag from '../components/Tag';
import { colors, spacing, borderRadius, shadows } from '../config/theme';

// ─── Constants ──────────────────────────────────────────────────────────────

const SIZES = [
  { label: 'XS', desc: '<10 lbs' },
  { label: 'S',  desc: '10–25' },
  { label: 'M',  desc: '25–60' },
  { label: 'L',  desc: '60–90' },
  { label: 'XL', desc: '90+ lbs' },
];

const ENERGY_LEVELS = [
  { label: 'Low',    icon: '🐾' },
  { label: 'Medium', icon: '⚡' },
  { label: 'High',   icon: '🔥' },
];

const TEMPERAMENTS = ['Friendly', 'Playful', 'Shy', 'Gentle', 'Dominant'];

const HEALTH_QUESTIONS = [
  {
    key: 'rabiesVaccine',
    label: 'Is your dog up to date on rabies vaccination?',
  },
  {
    key: 'bordetellaVaccine',
    label: 'Is your dog up to date on Bordetella (kennel cough)?',
  },
  {
    key: 'dhppVaccine',
    label: 'Is your dog up to date on DHPP (distemper/parvo)?',
  },
  {
    key: 'fleaTickPrevention',
    label: 'Is your dog currently on flea and tick prevention?',
  },
  {
    key: 'aggressionHistory',
    label: 'Has your dog ever shown aggression toward other dogs?',
    warningIfYes:
      'Please ensure your dog is leashed and supervised at all playdates.',
  },
  {
    key: 'biteHistory',
    label: 'Has your dog ever bitten another dog or person?',
    blockIfYes: true,
  },
  {
    key: 'contagiousConditions',
    label: 'Does your dog have any contagious conditions we should know about?',
    detailsIfYes: true,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function YesNoToggle({ value, onChange }) {
  return (
    <View style={ynStyles.row}>
      {['Yes', 'No'].map((opt) => (
        <TouchableOpacity
          key={opt}
          style={[
            ynStyles.btn,
            value === opt && (opt === 'Yes' ? ynStyles.yesActive : ynStyles.noActive),
          ]}
          onPress={() => onChange(opt)}
          activeOpacity={0.75}
        >
          <Text
            style={[
              ynStyles.label,
              value === opt && ynStyles.labelActive,
            ]}
          >
            {opt}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const ynStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  btn: {
    flex: 1,
    height: 40,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  yesActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  noActive:  { backgroundColor: colors.darkBrown, borderColor: colors.darkBrown },
  label:       { fontSize: 14, fontWeight: '700', color: colors.textMedium },
  labelActive: { color: colors.white },
});

// ─── Main component ───────────────────────────────────────────────────────────

export default function DogProfileCreator({ navigation, route, onDogCreated }) {
  const existingDog = route?.params?.dog ?? null;
  const isEditing   = Boolean(existingDog?.id);
  // When rendered as the root 'DogSetup' screen (new user flow), navigate.replace to Main
  const isOnboarding = route?.name === 'DogSetup';

  // ── Step state ──
  const [step, setStep] = useState(1); // 1 = Basics, 2 = Health

  // ── Basics ──
  const [dogName,     setDogName]     = useState(existingDog?.name        ?? '');
  const [breed,       setBreed]       = useState(existingDog?.breed       ?? '');
  const [age,         setAge]         = useState(existingDog?.age ? String(existingDog.age) : '');
  const [size,        setSize]        = useState(existingDog?.size        ?? '');
  const [energyLevel, setEnergyLevel] = useState(existingDog?.energyLevel ?? '');
  const [temperament, setTemperament] = useState(existingDog?.temperament ?? []);
  const [photoUri,    setPhotoUri]    = useState(existingDog?.photoUri    ?? null);

  // ── Health ──
  const initHealth = (key) => existingDog?.health?.[key] ?? null;
  const [rabiesVaccine,       setRabiesVaccine]       = useState(initHealth('rabiesVaccine'));
  const [bordetellaVaccine,   setBordetellaVaccine]   = useState(initHealth('bordetellaVaccine'));
  const [dhppVaccine,         setDhppVaccine]         = useState(initHealth('dhppVaccine'));
  const [fleaTickPrevention,  setFleaTickPrevention]  = useState(initHealth('fleaTickPrevention'));
  const [aggressionHistory,   setAggressionHistory]   = useState(initHealth('aggressionHistory'));
  const [biteHistory,         setBiteHistory]         = useState(initHealth('biteHistory'));
  const [contagiousConditions,setContagiousConditions]= useState(initHealth('contagiousConditions'));
  const [contagiousDetails,   setContagiousDetails]   = useState(existingDog?.health?.contagiousDetails ?? '');

  const healthSetters = {
    rabiesVaccine:       setRabiesVaccine,
    bordetellaVaccine:   setBordetellaVaccine,
    dhppVaccine:         setDhppVaccine,
    fleaTickPrevention:  setFleaTickPrevention,
    aggressionHistory:   setAggressionHistory,
    biteHistory:         setBiteHistory,
    contagiousConditions:setContagiousConditions,
  };
  const healthValues = {
    rabiesVaccine, bordetellaVaccine, dhppVaccine, fleaTickPrevention,
    aggressionHistory, biteHistory, contagiousConditions,
  };

  const [loading, setLoading] = useState(false);
  const [errors,  setErrors]  = useState({});

  // ── Photo picker ──
  async function pickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo library access to add a dog photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  }

  // ── Validation ──
  function validateBasics() {
    const e = {};
    if (!dogName.trim())  e.dogName     = "Dog's name is required";
    if (!breed.trim())    e.breed       = 'Breed is required';
    if (!size)            e.size        = 'Please select a size';
    if (!energyLevel)     e.energyLevel = 'Please select an energy level';
    if (!age.trim() || isNaN(Number(age)) || Number(age) <= 0)
                          e.age         = 'Enter a valid age in years';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function validateHealth() {
    const e = {};
    HEALTH_QUESTIONS.forEach(({ key }) => {
      if (healthValues[key] === null) e[key] = 'Please answer this question';
    });
    if (contagiousConditions === 'Yes' && !contagiousDetails.trim()) {
      e.contagiousDetails = 'Please describe the condition';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleNextStep() {
    if (!validateBasics()) return;
    setErrors({});
    setStep(2);
  }

  // ── Save ──
  async function handleSave() {
    if (!validateHealth()) return;

    // Block if bite history
    if (biteHistory === 'Yes') {
      Alert.alert(
        'Profile Cannot Be Created',
        'For the safety of our community, dogs with a bite history cannot be registered at this time.',
        [{ text: 'OK' }]
      );
      return;
    }

    setLoading(true);
    try {
      const uid = auth.currentUser.uid;
      const dogData = {
        name:        dogName.trim(),
        breed:       breed.trim(),
        age:         Number(age),
        size,
        energyLevel,
        temperament,
        photoUri:    photoUri ?? null,
        ownerId:     uid,
        updatedAt:   new Date().toISOString(),
        health: {
          rabiesVaccine,
          bordetellaVaccine,
          dhppVaccine,
          fleaTickPrevention,
          aggressionHistory,
          biteHistory,
          contagiousConditions,
          contagiousDetails: contagiousConditions === 'Yes' ? contagiousDetails.trim() : '',
        },
      };

      let dogId;
      if (isEditing) {
        dogId = existingDog.id;
        await updateDoc(doc(db, 'dogs', dogId), dogData);
      } else {
        dogData.createdAt = new Date().toISOString();
        const dogRef = await addDoc(collection(db, 'dogs'), dogData);
        dogId = dogRef.id;
        await setDoc(doc(db, 'owners', uid), { dogs: arrayUnion(dogId) }, { merge: true });
      }

      // Upload photo to Storage if the current URI is a local file (not already a remote URL)
      if (photoUri && !photoUri.startsWith('https://')) {
        const response = await fetch(photoUri);
        const blob = await response.blob();
        const storageRef = ref(storage, `dogPhotos/${uid}/${dogId}.jpg`);
        await uploadBytes(storageRef, blob);
        const downloadURL = await getDownloadURL(storageRef);
        // Save photoURL (canonical) and update photoUri for backward-compat with existing map code
        await updateDoc(doc(db, 'dogs', dogId), { photoURL: downloadURL, photoUri: downloadURL });
      }

      if (isOnboarding) {
        onDogCreated?.();
        navigation.replace('Main');
      } else {
        navigation.goBack();
      }
    } catch (err) {
      Alert.alert('Error', 'Could not save dog profile. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function toggleTemperament(tag) {
    setTemperament((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Step indicator */}
      <View style={styles.stepBar}>
        <StepDot number={1} label="Dog Basics" active={step === 1} done={step > 1} onPress={() => step > 1 && setStep(1)} />
        <View style={[styles.stepLine, step > 1 && styles.stepLineDone]} />
        <StepDot number={2} label="Health & Safety" active={step === 2} done={false} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {step === 1 ? (
          <BasicsStep
            dogName={dogName}      setDogName={setDogName}
            breed={breed}          setBreed={setBreed}
            age={age}              setAge={setAge}
            size={size}            setSize={setSize}
            energyLevel={energyLevel} setEnergyLevel={setEnergyLevel}
            temperament={temperament} toggleTemperament={toggleTemperament}
            photoUri={photoUri}    pickPhoto={pickPhoto}
            errors={errors}
            isEditing={isEditing}
            isOnboarding={isOnboarding}
            onNext={handleNextStep}
            onSkip={() => { onDogCreated?.(); navigation.replace('Main'); }}
          />
        ) : (
          <HealthStep
            healthValues={healthValues}
            healthSetters={healthSetters}
            contagiousDetails={contagiousDetails}
            setContagiousDetails={setContagiousDetails}
            errors={errors}
            loading={loading}
            isEditing={isEditing}
            onBack={() => { setErrors({}); setStep(1); }}
            onSave={handleSave}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Step indicator dot ────────────────────────────────────────────────────

function StepDot({ number, label, active, done, onPress }) {
  return (
    <TouchableOpacity style={styles.stepDotWrapper} onPress={onPress} activeOpacity={onPress ? 0.7 : 1}>
      <View style={[styles.stepDot, active && styles.stepDotActive, done && styles.stepDotDone]}>
        {done
          ? <Ionicons name="checkmark" size={14} color={colors.white} />
          : <Text style={[styles.stepDotNum, (active || done) && styles.stepDotNumActive]}>{number}</Text>
        }
      </View>
      <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Step 1: Basics ────────────────────────────────────────────────────────

function BasicsStep({
  dogName, setDogName, breed, setBreed, age, setAge,
  size, setSize, energyLevel, setEnergyLevel,
  temperament, toggleTemperament, photoUri, pickPhoto,
  errors, isEditing, isOnboarding, onNext, onSkip,
}) {
  return (
    <>
      <Text style={styles.stepTitle}>{isEditing ? 'Edit Your Dog' : 'Add Your Dog'}</Text>
      <Text style={styles.stepSubtitle}>Tell the pack about your pup!</Text>

      {/* Photo */}
      <TouchableOpacity onPress={pickPhoto} style={styles.photoPicker} activeOpacity={0.8}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.photoImage} />
        ) : (
          <View style={styles.photoPlaceholder}>
            <Ionicons name="camera" size={36} color={colors.primary} />
            <Text style={styles.photoPlaceholderText}>Add Photo</Text>
          </View>
        )}
        <View style={styles.photoEditBadge}>
          <Ionicons name="pencil" size={12} color={colors.white} />
        </View>
      </TouchableOpacity>

      <Input
        label="Dog's Name"
        value={dogName}
        onChangeText={setDogName}
        placeholder="e.g. Biscuit"
        autoCapitalize="words"
        error={errors.dogName}
      />

      <Input
        label="Breed"
        value={breed}
        onChangeText={setBreed}
        placeholder="e.g. Golden Retriever"
        autoCapitalize="words"
        error={errors.breed}
      />

      <Input
        label="Age (years)"
        value={age}
        onChangeText={setAge}
        placeholder="e.g. 2"
        keyboardType="decimal-pad"
        error={errors.age}
      />

      {/* Size */}
      <SectionLabel label="Size" error={errors.size} />
      <View style={styles.toggleRow}>
        {SIZES.map((s) => (
          <TouchableOpacity
            key={s.label}
            style={[styles.sizeBtn, size === s.label && styles.sizeBtnActive]}
            onPress={() => setSize(s.label)}
            activeOpacity={0.75}
          >
            <Text style={[styles.sizeBtnLabel, size === s.label && styles.sizeBtnLabelActive]}>
              {s.label}
            </Text>
            <Text style={[styles.sizeBtnDesc, size === s.label && styles.sizeBtnDescActive]}>
              {s.desc}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Energy */}
      <SectionLabel label="Energy Level" error={errors.energyLevel} />
      <View style={styles.energyRow}>
        {ENERGY_LEVELS.map(({ label, icon }) => (
          <TouchableOpacity
            key={label}
            style={[styles.energyBtn, energyLevel === label && styles.energyBtnActive]}
            onPress={() => setEnergyLevel(label)}
            activeOpacity={0.75}
          >
            <Text style={[styles.energyLabel, energyLevel === label && styles.energyLabelActive]}>
              {icon} {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Temperament */}
      <SectionLabel label="Temperament" hint="Select all that apply" />
      <View style={styles.tagCloud}>
        {TEMPERAMENTS.map((t) => (
          <Tag
            key={t}
            label={t}
            selected={temperament.includes(t)}
            onPress={() => toggleTemperament(t)}
          />
        ))}
      </View>

      <Button title="Next: Health & Safety →" onPress={onNext} style={styles.actionBtn} />

      {isOnboarding && (
        <TouchableOpacity onPress={onSkip} style={styles.skipBtn} activeOpacity={0.7}>
          <Text style={styles.skipText}>Skip for now → Go to Map</Text>
        </TouchableOpacity>
      )}
    </>
  );
}

// ─── Step 2: Health questionnaire ─────────────────────────────────────────

function HealthStep({
  healthValues, healthSetters,
  contagiousDetails, setContagiousDetails,
  errors, loading, isEditing, onBack, onSave,
}) {
  return (
    <>
      <Text style={styles.stepTitle}>Health & Safety</Text>
      <Text style={styles.stepSubtitle}>All questions are required to protect the community.</Text>

      {HEALTH_QUESTIONS.map(({ key, label, warningIfYes, blockIfYes, detailsIfYes }) => {
        const value = healthValues[key];
        return (
          <View key={key} style={styles.questionBlock}>
            <Text style={styles.questionLabel}>{label}</Text>
            <YesNoToggle value={value} onChange={(v) => healthSetters[key](v)} />
            {errors[key] && <Text style={styles.errorText}>{errors[key]}</Text>}

            {/* Aggression warning */}
            {warningIfYes && value === 'Yes' && (
              <View style={styles.warningBanner}>
                <Ionicons name="warning-outline" size={16} color="#B45309" />
                <Text style={styles.warningText}>{warningIfYes}</Text>
              </View>
            )}

            {/* Bite history block warning */}
            {blockIfYes && value === 'Yes' && (
              <View style={styles.blockBanner}>
                <Ionicons name="close-circle-outline" size={16} color={colors.error} />
                <Text style={styles.blockText}>
                  For the safety of our community, dogs with a bite history cannot be registered at this time.
                </Text>
              </View>
            )}

            {/* Contagious condition details */}
            {detailsIfYes && value === 'Yes' && (
              <View style={{ marginTop: spacing.sm }}>
                <TextInput
                  style={styles.detailsInput}
                  value={contagiousDetails}
                  onChangeText={setContagiousDetails}
                  placeholder="Please describe the condition..."
                  placeholderTextColor={colors.textLight}
                  multiline
                  numberOfLines={3}
                />
                {errors.contagiousDetails && (
                  <Text style={styles.errorText}>{errors.contagiousDetails}</Text>
                )}
              </View>
            )}
          </View>
        );
      })}

      {/* Disclaimer */}
      <View style={styles.disclaimer}>
        <Ionicons name="information-circle-outline" size={16} color={colors.textLight} />
        <Text style={styles.disclaimerText}>
          By creating this profile, you confirm that all health information provided is accurate.
          WagPals is not responsible for injuries or illness resulting from dog interactions.
        </Text>
      </View>

      <View style={styles.twoButtons}>
        <Button title="← Back" variant="outline" onPress={onBack} style={{ flex: 1 }} />
        <Button
          title={isEditing ? 'Save Changes' : 'Create Profile'}
          onPress={onSave}
          loading={loading}
          style={{ flex: 2 }}
        />
      </View>
    </>
  );
}

// ─── Small helpers ──────────────────────────────────────────────────────────

function SectionLabel({ label, error, hint }) {
  return (
    <>
      <Text style={styles.sectionLabel}>{label}</Text>
      {hint  && <Text style={styles.sectionHint}>{hint}</Text>}
      {error && <Text style={styles.errorText}>{error}</Text>}
    </>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll:     { flex: 1, backgroundColor: colors.offWhite },
  container:  { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },

  // Step bar
  stepBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  stepDotWrapper: { alignItems: 'center', gap: 4 },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  stepDotDone:   { borderColor: colors.success,  backgroundColor: colors.success },
  stepDotNum:       { fontSize: 13, fontWeight: '700', color: colors.textLight },
  stepDotNumActive: { color: colors.white },
  stepLabel:        { fontSize: 11, fontWeight: '600', color: colors.textLight },
  stepLabelActive:  { color: colors.primary },
  stepLine:         { flex: 1, height: 2, backgroundColor: colors.border, marginHorizontal: spacing.sm, marginBottom: 16 },
  stepLineDone:     { backgroundColor: colors.success },

  // Step header
  stepTitle:    { fontSize: 24, fontWeight: '800', color: colors.darkBrown, textAlign: 'center', marginTop: spacing.lg },
  stepSubtitle: { fontSize: 13, color: colors.textMedium, textAlign: 'center', marginBottom: spacing.lg, marginTop: spacing.xs },

  // Photo
  photoPicker: { alignSelf: 'center', width: 110, height: 110, borderRadius: 55, marginBottom: spacing.xl, ...shadows.card },
  photoImage:  { width: 110, height: 110, borderRadius: 55 },
  photoPlaceholder: {
    width: 110, height: 110, borderRadius: 55,
    backgroundColor: '#FFF3E0', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.secondary, borderStyle: 'dashed',
  },
  photoPlaceholderText: { marginTop: 4, fontSize: 12, color: colors.primary, fontWeight: '600' },
  photoEditBadge: {
    position: 'absolute', bottom: 4, right: 4,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.white,
  },

  // Section labels
  sectionLabel: { fontSize: 15, fontWeight: '700', color: colors.darkBrown, marginBottom: spacing.xs, marginTop: spacing.sm },
  sectionHint:  { fontSize: 12, color: colors.textLight, marginBottom: spacing.sm, marginTop: -2 },
  errorText:    { fontSize: 12, color: colors.error, marginTop: spacing.xs },

  // Tag cloud
  tagCloud: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },

  // Size toggle
  toggleRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md },
  sizeBtn: {
    flex: 1, alignItems: 'center', paddingVertical: spacing.sm,
    borderRadius: borderRadius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.white,
  },
  sizeBtnActive:       { backgroundColor: colors.primary, borderColor: colors.primary },
  sizeBtnLabel:        { fontSize: 15, fontWeight: '800', color: colors.textMedium },
  sizeBtnLabelActive:  { color: colors.white },
  sizeBtnDesc:         { fontSize: 9, color: colors.textLight, marginTop: 2 },
  sizeBtnDescActive:   { color: 'rgba(255,255,255,0.8)' },

  // Energy toggle
  energyRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  energyBtn: {
    flex: 1, alignItems: 'center', paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.white,
  },
  energyBtnActive:   { backgroundColor: colors.primary, borderColor: colors.primary },
  energyLabel:       { fontSize: 13, fontWeight: '700', color: colors.textMedium },
  energyLabelActive: { color: colors.white },

  // Health questionnaire
  questionBlock: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  questionLabel: { fontSize: 14, fontWeight: '600', color: colors.darkBrown, marginBottom: spacing.sm, lineHeight: 20 },

  warningBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs,
    marginTop: spacing.sm, backgroundColor: '#FEF3C7',
    borderRadius: borderRadius.md, padding: spacing.sm,
  },
  warningText: { flex: 1, fontSize: 13, color: '#92400E', lineHeight: 18 },

  blockBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs,
    marginTop: spacing.sm, backgroundColor: '#FEE2E2',
    borderRadius: borderRadius.md, padding: spacing.sm,
  },
  blockText: { flex: 1, fontSize: 13, color: colors.error, lineHeight: 18 },

  detailsInput: {
    backgroundColor: colors.offWhite, borderRadius: borderRadius.md,
    borderWidth: 1.5, borderColor: colors.border,
    padding: spacing.md, fontSize: 14, color: colors.textDark,
    minHeight: 80, textAlignVertical: 'top',
  },

  // Disclaimer
  disclaimer: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs,
    backgroundColor: colors.lightGray, borderRadius: borderRadius.md,
    padding: spacing.md, marginTop: spacing.sm, marginBottom: spacing.lg,
  },
  disclaimerText: { flex: 1, fontSize: 12, color: colors.textMedium, lineHeight: 18 },

  // Buttons
  actionBtn:  { marginTop: spacing.md },
  twoButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  skipBtn:    { alignSelf: 'center', marginTop: spacing.lg, padding: spacing.sm },
  skipText:   { fontSize: 13, color: colors.textLight, textDecorationLine: 'underline' },
});
