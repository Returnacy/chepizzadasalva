/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_FRONTEND_BASE_URL?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** 'true' turns "Accedi con Google" on for a non-Che-Pizza brand. */
  readonly VITE_GOOGLE_LOGIN_ENABLED?: string;
  readonly VITE_BRAND_NAME?: string;
  // other env vars...
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
