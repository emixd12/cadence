/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Ticket 299: "1" turns on the hidden ChatGPT plan feature; unset in shipped builds. */
  readonly VITE_CADENCE_CHATGPT_PLAN?: string;
}
