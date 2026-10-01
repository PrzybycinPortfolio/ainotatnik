import type { SupabaseClient } from '@supabase/supabase-js';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  GEMINI_API_KEY: string;
  ALLOWED_ORIGIN?: string;
}

export interface Variables {
  supabase: SupabaseClient;
  userId: string;
}

export type AppBindings = { Bindings: Env; Variables: Variables };
