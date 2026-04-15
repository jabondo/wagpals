import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import * as Facebook from 'expo-auth-session/providers/facebook';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  FacebookAuthProvider,
  OAuthProvider,
  signInWithCredential,
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { colors, borderRadius, spacing } from '../config/theme';

WebBrowser.maybeCompleteAuthSession();

export default function OnboardingScreen() {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState(null); // 'google' | 'facebook' | 'apple' | null
  const [appleAvailable, setAppleAvailable] = useState(false);

  // Refs
  const appleSigningIn = useRef(false); // guard against double-tap on native Apple button
  const nameHeight = useRef(new Animated.Value(0)).current;
  const nameOpacity = useRef(new Animated.Value(0)).current;

  // ── Shared helper: create owners doc on first sign-in ──
  // Safe to call for any provider — no-ops if doc already exists.
  async function ensureOwnerDoc(userCredential, overrides = {}) {
    const uid = userCredential.user.uid;
    const ownerRef = doc(db, 'owners', uid);
    const ownerSnap = await getDoc(ownerRef);
    if (!ownerSnap.exists()) {
      await setDoc(ownerRef, {
        name: overrides.name || userCredential.user.displayName || 'WagPals User',
        email: overrides.email || userCredential.user.email || '',
        createdAt: serverTimestamp(),
        dogs: [],
      });
    }
  }

  // Check if Sign In with Apple is available on this device
  useEffect(() => {
    if (Platform.OS === 'ios') {
      AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
    }
  }, []);

  // ── Google OAuth ──
  // Add your Google OAuth Web Client ID from Firebase Console →
  // Authentication → Sign-in method → Google → Web client ID
  const [googleRequest, googleResponse, promptGoogleAsync] = Google.useAuthRequest({
    clientId: '754058448612-f0u9uqvcva3s8arqmrc1vkiuvije9u16.apps.googleusercontent.com',
  });

  useEffect(() => {
    if (googleResponse?.type === 'success') {
      const { id_token } = googleResponse.params;
      const credential = GoogleAuthProvider.credential(id_token);
      setSocialLoading('google');
      signInWithCredential(auth, credential)
        .then(async (userCredential) => {
          try {
            await ensureOwnerDoc(userCredential);
          } catch (firestoreErr) {
            console.error('[Google] Firestore owners doc failed:', firestoreErr.code, firestoreErr.message);
            setErrors({ general: 'Signed in, but profile setup failed. Some features may be limited.' });
          }
        })
        .catch(err => {
          console.error('[Google auth error]', err.code, err.message);
          const msg = friendlyError(err.code, err.message);
          if (msg) setErrors({ general: msg });
        })
        .finally(() => setSocialLoading(null));
    }
  }, [googleResponse]);

  // ── Facebook OAuth ──
  const [fbRequest, fbResponse, promptFacebookAsync] = Facebook.useAuthRequest({
    clientId: '26395565846746803',
  });

  useEffect(() => {
    if (fbResponse?.type === 'success') {
      const { access_token } = fbResponse.params;
      const credential = FacebookAuthProvider.credential(access_token);
      setSocialLoading('facebook');
      signInWithCredential(auth, credential)
        .then(async (userCredential) => {
          try {
            await ensureOwnerDoc(userCredential);
          } catch (firestoreErr) {
            console.error('[Facebook] Firestore owners doc failed:', firestoreErr.code, firestoreErr.message);
            setErrors({ general: 'Signed in, but profile setup failed. Some features may be limited.' });
          }
        })
        .catch(err => {
          console.error('[Facebook auth error]', err.code, err.message);
          const msg = friendlyError(err.code, err.message);
          if (msg) setErrors({ general: msg });
        })
        .finally(() => setSocialLoading(null));
    }
  }, [fbResponse]);

  // ── Apple Sign-In ──
  async function handleAppleSignIn() {
    // Prevent double-tap: the native Apple button ignores the `disabled` prop
    if (appleSigningIn.current) return;
    appleSigningIn.current = true;
    setSocialLoading('apple');
    try {
      // Generate a random nonce; Apple requires a SHA-256 hash of it,
      // but Firebase needs the raw version to verify the token.
      const rawNonce = Array.from(
        { length: 16 },
        () => Math.random().toString(36)[2]
      ).join('');
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce
      );

      const appleCredential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });

      const provider = new OAuthProvider('apple.com');
      const firebaseCredential = provider.credential({
        idToken: appleCredential.identityToken,
        rawNonce,
      });

      const userCredential = await signInWithCredential(auth, firebaseCredential);

      // Apple only sends name/email on the very first sign-in — capture them now.
      // Use a separate try/catch so a Firestore failure doesn't look like an auth failure.
      const firstName = appleCredential.fullName?.givenName ?? '';
      const lastName = appleCredential.fullName?.familyName ?? '';
      const displayName = [firstName, lastName].filter(Boolean).join(' ');
      try {
        await ensureOwnerDoc(userCredential, {
          name: displayName || undefined,
          email: appleCredential.email || undefined,
        });
      } catch (firestoreErr) {
        // Auth succeeded — user is signed in. Profile creation failed (network blip,
        // Firestore rules, etc.). Log it but don't block the user; the app can
        // re-attempt doc creation on next sign-in via ensureOwnerDoc's exists() check.
        console.error('[Apple] Firestore owners doc failed:', firestoreErr.code, firestoreErr.message);
        setErrors({ general: 'Signed in, but profile setup failed. Some features may be limited.' });
      }
    } catch (err) {
      if (err.code === 'ERR_REQUEST_CANCELED') {
        // User dismissed the Apple sheet — no error needed
      } else {
        console.error('[Apple auth error]', err.code, err.message);
        const msg = friendlyError(err.code, err.message);
        if (msg) setErrors({ general: msg });
      }
    } finally {
      appleSigningIn.current = false;
      setSocialLoading(null);
    }
  }

  function switchMode(next) {
    setErrors({});
    setMode(next);
    if (next === 'signup') {
      Animated.parallel([
        Animated.spring(nameHeight, { toValue: 60, useNativeDriver: false, tension: 60, friction: 10 }),
        Animated.timing(nameOpacity, { toValue: 1, duration: 250, useNativeDriver: false }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.spring(nameHeight, { toValue: 0, useNativeDriver: false, tension: 80, friction: 12 }),
        Animated.timing(nameOpacity, { toValue: 0, duration: 150, useNativeDriver: false }),
      ]).start();
    }
  }

  function validate() {
    const e = {};
    if (mode === 'signup' && !name.trim()) e.name = 'Name is required';
    if (!email.trim()) e.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) e.email = 'Enter a valid email';
    if (!password) e.password = 'Password is required';
    else if (password.length < 6) e.password = 'Min 6 characters';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    setLoading(true);
    try {
      if (mode === 'signup') {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        try {
          await setDoc(doc(db, 'owners', cred.user.uid), {
            name: name.trim(),
            email: email.trim(),
            createdAt: serverTimestamp(),
            dogs: [],
          });
        } catch (firestoreErr) {
          // Account was created — don't block the user, but surface a warning.
          console.error('[Email signup] Firestore owners doc failed:', firestoreErr.code, firestoreErr.message);
          setErrors({ general: 'Account created, but profile setup failed. Some features may be limited.' });
        }
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (err) {
      console.error('[Auth error]', err.code, err.message);
      const msg = friendlyError(err.code, err.message);
      if (msg) setErrors({ general: msg });
    } finally {
      setLoading(false);
    }
  }

  function friendlyError(code, message) {
    const map = {
      'auth/email-already-in-use': 'That email is already registered.',
      'auth/user-not-found': 'No account found with that email.',
      'auth/wrong-password': 'Incorrect password.',
      'auth/invalid-credential': 'Invalid email or password.',
      'auth/too-many-requests': 'Too many attempts. Try again later.',
      'auth/network-request-failed': 'Network error — check your connection.',
      'auth/operation-not-allowed': 'This sign-in method is not enabled. Please contact support.',
      'auth/user-disabled': 'This account has been disabled. Please contact support.',
      'auth/account-exists-with-different-credential': 'An account already exists with this email using a different sign-in method.',
      'auth/popup-closed-by-user': null, // silent — user closed it intentionally
      'auth/cancelled-popup-request': null, // silent — duplicate popup
      'ERR_REQUEST_UNKNOWN': 'Apple sign-in failed. Please try again.',
    };
    const friendly = map[code];
    if (friendly === null) return null; // caller should suppress display
    return friendly ?? `Something went wrong (${code ?? 'unknown'}). Please try again.`;
  }

  return (
    <ImageBackground
      source={require('../../assets/banner.jpg')}
      style={styles.bg}
      resizeMode="cover"
    >
      {/* Full-screen dark overlay */}
      <View style={styles.overlay} />

      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Main container: logo at top, form at bottom */}
        <View style={styles.container}>

          {/* ── BOTTOM: Form ── */}
          <View style={styles.formSection}>

            {/* Name field — signup only */}
            <Animated.View style={{ height: nameHeight, opacity: nameOpacity, overflow: 'hidden', width: '85%', alignSelf: 'center' }}>
              <FormInput
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                autoCapitalize="words"
                error={errors.name}
              />
            </Animated.View>

            {/* Email */}
            <FormInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              keyboardType="email-address"
              error={errors.email}
            />

            {/* Password */}
            <FormInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              secureTextEntry={!showPassword}
              error={errors.password}
              rightIcon={
                <TouchableOpacity onPress={() => setShowPassword(v => !v)} hitSlop={8}>
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color="rgba(255,255,255,0.5)"
                  />
                </TouchableOpacity>
              }
            />

            {errors.general ? (
              <Text style={styles.errorText}>{errors.general}</Text>
            ) : null}

            {/* Log In button */}
            <TouchableOpacity
              style={styles.loginBtn}
              onPress={handleSubmit}
              activeOpacity={0.85}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color={colors.white} />
                : <Text style={styles.loginBtnText}>
                    {mode === 'login' ? 'Log In' : 'Create Account'}
                  </Text>
              }
            </TouchableOpacity>

            {/* ── "or" divider ── */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Continue with Google */}
            <TouchableOpacity
              style={styles.googleBtn}
              onPress={() => promptGoogleAsync()}
              activeOpacity={0.85}
              disabled={socialLoading !== null || !googleRequest}
            >
              {socialLoading === 'google'
                ? <ActivityIndicator color="#3D2B1F" />
                : <>
                    <FontAwesome5 name="google" size={18} color="#4285F4" style={styles.socialIcon} />
                    <Text style={styles.googleBtnText}>Continue with Google</Text>
                  </>
              }
            </TouchableOpacity>

            {/* Sign in with Apple — iOS only */}
            {Platform.OS === 'ios' && appleAvailable && (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={27}
                style={styles.appleBtn}
                onPress={handleAppleSignIn}
              />
            )}

            {/* Continue with Facebook */}
            <TouchableOpacity
              style={styles.facebookBtn}
              onPress={() => promptFacebookAsync()}
              activeOpacity={0.85}
              disabled={socialLoading !== null || !fbRequest}
            >
              {socialLoading === 'facebook'
                ? <ActivityIndicator color="#fff" />
                : <>
                    <FontAwesome5 name="facebook" size={18} color="#fff" style={styles.socialIcon} />
                    <Text style={styles.facebookBtnText}>Continue with Facebook</Text>
                  </>
              }
            </TouchableOpacity>

            {/* Sign up / Log in toggle */}
            {mode === 'login' ? (
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>Don't have an account? </Text>
                <TouchableOpacity onPress={() => switchMode('signup')} hitSlop={8}>
                  <Text style={styles.toggleLink}>Sign Up</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>Already have an account? </Text>
                <TouchableOpacity onPress={() => switchMode('login')} hitSlop={8}>
                  <Text style={styles.toggleLink}>Log In</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

        </View>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}

function FormInput({ value, onChangeText, placeholder, secureTextEntry,
  keyboardType, autoCapitalize, error, rightIcon }) {
  return (
    <View style={inputStyles.wrapper}>
      <View style={[inputStyles.field, error && inputStyles.fieldError]}>
        <TextInput
          style={inputStyles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="rgba(255,255,255,0.45)"
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize ?? 'none'}
          autoCorrect={false}
          selectionColor={colors.secondary}
        />
        {rightIcon}
      </View>
      {error ? <Text style={inputStyles.error}>{error}</Text> : null}
    </View>
  );
}

const inputStyles = StyleSheet.create({
  wrapper: {
    width: '85%',
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: spacing.md,
  },
  fieldError: {
    borderColor: '#FF8A80',
  },
  input: {
    flex: 1,
    height: '100%',
    fontSize: 15,
    color: colors.white,
  },
  error: {
    marginTop: 4,
    marginLeft: 4,
    fontSize: 12,
    color: '#FF8A80',
  },
});

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  kav: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  formSection: {
    paddingBottom: 50,
  },
  errorText: {
    width: '85%',
    alignSelf: 'center',
    color: '#FF8A80',
    fontSize: 13,
    marginBottom: spacing.sm,
    marginLeft: 4,
  },
  loginBtn: {
    width: '85%',
    alignSelf: 'center',
    height: 54,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  loginBtnText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  divider: {
    width: '85%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  dividerText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    marginHorizontal: spacing.sm,
  },
  googleBtn: {
    width: '85%',
    alignSelf: 'center',
    height: 54,
    backgroundColor: '#ffffff',
    borderRadius: borderRadius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  googleBtnText: {
    color: colors.darkBrown,
    fontSize: 15,
    fontWeight: '600',
  },
  appleBtn: {
    width: '85%',
    alignSelf: 'center',
    height: 54,
    marginBottom: spacing.sm,
  },
  facebookBtn: {
    width: '85%',
    alignSelf: 'center',
    height: 54,
    backgroundColor: '#1877F2',
    borderRadius: borderRadius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    shadowColor: '#1877F2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 3,
  },
  facebookBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  socialIcon: {
    marginRight: spacing.sm,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
  },
  toggleLink: {
    color: colors.secondary,
    fontSize: 14,
    fontWeight: '700',
  },
});
