import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import { appConfig, hasFirebaseConfig } from './config';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

export function getFirebaseAuth() {
  if (!hasFirebaseConfig) return { app: null, auth: null, provider: null };

  if (!app) {
    app = getApps()[0] ?? initializeApp(appConfig.firebase as Record<string, string>);
    auth = getAuth(app);
  }

  return { app, auth, provider: new GoogleAuthProvider() };
}
