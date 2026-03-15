/**
 * seedTestDogs — inserts 3 fake dog + owner docs near San Francisco for
 * testing map markers and the bottom sheet.
 *
 * Dogs are tagged with _isTestData: true so they're easy to clean up from
 * the Firebase Console (filter where _isTestData == true → delete all).
 *
 * Safe to call multiple times — each call checks for existing test docs
 * before writing, so you won't end up with duplicates.
 */

import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../config/firebase';

// ─── SF center: 37.7749, -122.4194 ──────────────────────────────────────────
// Offsets are within ~0.3 miles of center.
const TEST_DOGS = [
  {
    id:    'test-dog-buddy',
    owner: { id: 'test-owner-sarah', name: 'Sarah Mitchell', email: 'sarah@test.wagpals' },
    dog: {
      name:        'Buddy',
      breed:       'Golden Retriever',
      age:         3,
      size:        'L',
      energyLevel: 'High',
      temperament: ['Friendly', 'Playful'],
      photoUri:    null,
      location:    { latitude: 37.7769, longitude: -122.4172 }, // ~0.15 mi NE
    },
  },
  {
    id:    'test-dog-luna',
    owner: { id: 'test-owner-james', name: 'James Park', email: 'james@test.wagpals' },
    dog: {
      name:        'Luna',
      breed:       'French Bulldog',
      age:         2,
      size:        'S',
      energyLevel: 'Medium',
      temperament: ['Gentle', 'Shy'],
      photoUri:    null,
      location:    { latitude: 37.7731, longitude: -122.4215 }, // ~0.14 mi SW
    },
  },
  {
    id:    'test-dog-max',
    owner: { id: 'test-owner-priya', name: 'Priya Sharma', email: 'priya@test.wagpals' },
    dog: {
      name:        'Max',
      breed:       'Siberian Husky',
      age:         4,
      size:        'M',
      energyLevel: 'High',
      temperament: ['Playful', 'Dominant'],
      photoUri:    null,
      location:    { latitude: 37.7755, longitude: -122.4148 }, // ~0.25 mi E
    },
  },
];

const HEALTH_ALL_CURRENT = {
  rabiesVaccine:        'Yes',
  bordetellaVaccine:    'Yes',
  dhppVaccine:          'Yes',
  fleaTickPrevention:   'Yes',
  aggressionHistory:    'No',
  biteHistory:          'No',
  contagiousConditions: 'No',
  contagiousDetails:    '',
};

export async function seedTestDogs() {
  // Check which test dogs already exist so we don't duplicate
  const existing = new Set();
  const existingSnap = await getDocs(
    query(collection(db, 'dogs'), where('_isTestData', '==', true))
  );
  existingSnap.forEach((d) => existing.add(d.id));

  const results = { created: 0, skipped: 0 };

  for (const { id, owner, dog } of TEST_DOGS) {
    if (existing.has(id)) {
      console.log(`[seed] Skipping ${dog.name} — already exists`);
      results.skipped++;
      continue;
    }

    const now = new Date().toISOString();

    // Write owner doc
    await setDoc(doc(db, 'owners', owner.id), {
      name:        owner.name,
      email:       owner.email,
      dogs:        [id],
      createdAt:   now,
      _isTestData: true,
    });

    // Write dog doc (with deterministic ID for easy cleanup)
    await setDoc(doc(db, 'dogs', id), {
      ...dog,
      ownerId:     owner.id,
      health:      HEALTH_ALL_CURRENT,
      createdAt:   now,
      updatedAt:   now,
      _isTestData: true,
    });

    console.log(`[seed] Created ${dog.name} (${id}) at`, dog.location);
    results.created++;
  }

  return results;
}

export async function clearTestDogs() {
  const { deleteDoc } = await import('firebase/firestore');

  const dogSnap = await getDocs(
    query(collection(db, 'dogs'), where('_isTestData', '==', true))
  );
  const ownerSnap = await getDocs(
    query(collection(db, 'owners'), where('_isTestData', '==', true))
  );

  const deletes = [
    ...dogSnap.docs.map((d) => deleteDoc(doc(db, 'dogs',   d.id))),
    ...ownerSnap.docs.map((d) => deleteDoc(doc(db, 'owners', d.id))),
  ];
  await Promise.all(deletes);
  console.log(`[seed] Cleared ${dogSnap.size} dogs, ${ownerSnap.size} owners`);
  return { dogs: dogSnap.size, owners: ownerSnap.size };
}
