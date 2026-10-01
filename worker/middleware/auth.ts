import type { Context, Next } from 'hono';
import { createClient } from '@supabase/supabase-js';
import type { AppBindings } from '../types';

// Scopes the Supabase client to the caller's own JWT instead of the service-role
// key, so every query below runs as that user and is enforced by RLS — the API
// never has to filter `user_id` by hand or trust a client-supplied id.
export async function authMiddleware(c: Context<AppBindings>, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing bearer token' }, 401);
  }
  const token = authHeader.slice('Bearer '.length);

  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  c.set('supabase', supabase);
  c.set('userId', data.user.id);
  await next();
}
