interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface DemoLoginCredentials {
  readonly email: string;
  readonly password: string;
}

declare const __DEMO_LOGIN__: DemoLoginCredentials | null;
