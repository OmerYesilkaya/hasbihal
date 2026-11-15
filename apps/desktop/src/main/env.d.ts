interface ImportMetaEnv {
  /** Server base URL baked in at build time; defaults to http://localhost:8080. */
  readonly MAIN_VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
