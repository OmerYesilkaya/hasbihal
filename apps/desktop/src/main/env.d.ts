interface ImportMetaEnv {
  /** Server base URL baked in at build time; defaults to http://localhost:8080. */
  readonly MAIN_VITE_SERVER_URL?: string;
  /** The Google "Desktop app" OAuth client (A25). Without it, Google sign-in is off. */
  readonly MAIN_VITE_GOOGLE_CLIENT_ID?: string;
  readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
