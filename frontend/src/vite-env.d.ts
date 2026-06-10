/// <reference types="vite/client" />

declare module 'firebase/app' {
  export type FirebaseApp = any;
  export function initializeApp(config: Record<string, string>): any;
  export function getApps(): any[];
}

declare module 'firebase/auth' {
  export type Auth = any;
  export type User = any;
  export class GoogleAuthProvider {}
  export function getAuth(app?: any): any;
  export function onAuthStateChanged(auth: any, callback: (user: any) => void): () => void;
  export function signInWithPopup(auth: any, provider: any): Promise<any>;
  export function signOut(auth: any): Promise<void>;
}
