import { Hono } from 'hono';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppBindings } from '../types';
import { generateEmbedding, generateNoteEmbedding } from '../lib/gemini';
import { escapeLikeValue } from '../lib/text';

const notes = new Hono<AppBindings>();

async function upsertNoteEmbedding(
  supabase: SupabaseClient,
  apiKey: string,
  noteId: string,
  title: string,
  content: string
) {
  try {
    const embedding = await generateNoteEmbedding(apiKey, title, content);
    await supabase.from('embeddings').upsert({ note_id: noteId, embedding: JSON.stringify(embedding) }, { onConflict: 'note_id' });
  } catch (err) {
    console.warn(`Embedding generation failed for note ${noteId}:`, err);
  }
}

const createNoteSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(20000),
});

const updateNoteSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    content: z.string().min(1).max(20000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });

const semanticSearchSchema = z.object({
  query: z.string().min(1),
  match_threshold: z.number().min(0).max(1).optional(),
  match_count: z.number().int().positive().max(50).optional(),
});

notes.get('/', async (c) => {
  const page = Math.max(Number(c.req.query('page') ?? '0'), 0);
  const pageSize = Math.min(Math.max(Number(c.req.query('pageSize') ?? '20'), 1), 100);
  const from = page * pageSize;

  const { data, error } = await c
    .get('supabase')
    .from('notes')
    .select('*')
    .order('updated_at', { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

notes.get('/search', async (c) => {
  const q = c.req.query('q');
  if (!q) return c.json({ error: 'missing q query param' }, 400);

  const safe = escapeLikeValue(q);
  const { data, error } = await c
    .get('supabase')
    .from('notes')
    .select('*')
    .or(`title.ilike.%${safe}%,content.ilike.%${safe}%`)
    .order('updated_at', { ascending: false })
    .limit(50);

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

notes.post('/semantic-search', async (c) => {
  const parsed = semanticSearchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const embedding = await generateEmbedding(c.env.GEMINI_API_KEY, parsed.data.query);
  const { data, error } = await c.get('supabase').rpc('search_notes_by_embedding', {
    query_embedding: embedding,
    match_threshold: parsed.data.match_threshold ?? 0.7,
    match_count: parsed.data.match_count ?? 10,
    p_user_id: c.get('userId'),
  });

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

notes.post('/', async (c) => {
  const parsed = createNoteSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const supabase = c.get('supabase');
  const { data: note, error } = await supabase
    .from('notes')
    .insert({ user_id: c.get('userId'), title: parsed.data.title, content: parsed.data.content })
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);

  await upsertNoteEmbedding(supabase, c.env.GEMINI_API_KEY, note.id, note.title, note.content);
  return c.json(note, 201);
});

notes.patch('/:id', async (c) => {
  const parsed = updateNoteSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const supabase = c.get('supabase');
  const { data: note, error } = await supabase
    .from('notes')
    .update(parsed.data)
    .eq('id', c.req.param('id'))
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);

  await upsertNoteEmbedding(supabase, c.env.GEMINI_API_KEY, note.id, note.title, note.content);
  return c.json(note);
});

notes.delete('/:id', async (c) => {
  const { error } = await c.get('supabase').from('notes').delete().eq('id', c.req.param('id'));
  if (error) return c.json({ error: error.message }, 500);
  return c.body(null, 204);
});

export default notes;
