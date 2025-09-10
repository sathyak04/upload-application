/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  // You can add more environment variables here if you need them
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}