import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../types';

const profile = new Hono<AppBindings>();

// vat_payer decides the KUP basis: true → net, false → gross, null → not set.
const updateSchema = z.object({ vat_payer: z.boolean().nullable() });

profile.get('/', async (c) => {
  const { data, error } = await c
    .get('supabase')
    .from('user_profiles')
    .select('vat_payer')
    .eq('user_id', c.get('userId'))
    .maybeSingle();

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ vat_payer: data?.vat_payer ?? null });
});

profile.put('/', async (c) => {
  const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const { data, error } = await c
    .get('supabase')
    .from('user_profiles')
    .upsert({ user_id: c.get('userId'), vat_payer: parsed.data.vat_payer, updated_at: new Date().toISOString() })
    .select('vat_payer')
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ vat_payer: data.vat_payer });
});

export default profile;
