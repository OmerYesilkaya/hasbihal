import type {
  ApiError,
  InviteInfo,
  RecoverRequest,
  SignInRequest,
  SignUpRequest,
  User,
} from '@hasbihal/protocol';
import type { DeepLink } from './deep-link.ts';

/** Information the main process hands to the renderer at startup. */
export interface AppInfo {
  appVersion: string;
  platform: 'darwin' | 'win32' | 'linux';
  /** Base URL of the Hasbihal server, e.g. https://hasbihal.duckdns.org */
  serverUrl: string;
}

/** An error as the UI sees it: the server's `ApiError`, or `unavailable` when it can't be reached. */
export type AuthError = ApiError['error'];

export type AuthResult<T> = { ok: true; value: T } | { ok: false; error: AuthError };

/**
 * The session lives in the main process (ARCHITECTURE §9): it signs in, keeps the refresh token
 * encrypted with safeStorage, and refreshes. The renderer only ever sees short-lived access tokens.
 */
export interface AuthBridge {
  /** At startup: the stored session's user, or null when there is none (or it has ended). */
  restore(): Promise<AuthResult<User | null>>;
  inviteInfo(token: string): Promise<AuthResult<InviteInfo>>;
  signUp(request: Omit<SignUpRequest, 'deviceName'>): Promise<AuthResult<User>>;
  signIn(request: Omit<SignInRequest, 'deviceName'>): Promise<AuthResult<User>>;
  recover(request: Omit<RecoverRequest, 'deviceName'>): Promise<AuthResult<User>>;
  /**
   * A valid access token, refreshed when needed (or when `refresh` is set, after the server
   * rejected the current one). `unauthorized` means the session has ended.
   */
  accessToken(refresh?: boolean): Promise<AuthResult<string>>;
  signOut(): Promise<void>;
  /** Called when the session ends without the user signing out (revoked elsewhere, expired). */
  onSessionEnded(listener: () => void): () => void;
}

export interface DeepLinkBridge {
  /** A link that arrived before the UI was ready (e.g. the one that launched the app). */
  takePending(): Promise<DeepLink | null>;
  onLink(listener: (link: DeepLink) => void): () => void;
}

/** System facts the renderer needs. */
export interface SystemBridge {
  /** Whether the computer is idle now (10 minutes without input, or a locked screen). */
  isIdle(): Promise<boolean>;
  onIdleChanged(listener: (idle: boolean) => void): () => void;
}

export const IPC = {
  getAppInfo: 'app:get-info',
  authRestore: 'auth:restore',
  authInviteInfo: 'auth:invite-info',
  authSignUp: 'auth:sign-up',
  authSignIn: 'auth:sign-in',
  authRecover: 'auth:recover',
  authAccessToken: 'auth:access-token',
  authSignOut: 'auth:sign-out',
  authSessionEnded: 'auth:session-ended',
  deepLinkTakePending: 'deep-link:take-pending',
  deepLinkReceived: 'deep-link:received',
  systemIsIdle: 'system:is-idle',
  systemIdleChanged: 'system:idle-changed',
} as const;
