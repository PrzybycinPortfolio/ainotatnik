import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { SUPPORTED_UPLOAD_MIME_TYPES } from '../lib/documentExtract';
import { processInvoiceFile } from '../lib/invoiceProcessing';

const files = new Hono<AppBindings>();

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const STORAGE_BUCKET = 'uploads';

files.get('/', async (c) => {
  const { data, error } = await c
    .get('supabase')
    .from('files')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

files.post('/', async (c) => {
  const supabase = c.get('supabase');
  const userId = c.get('userId');

  const formData = await c.req.formData().catch(() => null);
  const file = formData?.get('file') as File | null | undefined;
  if (!file) {
    return c.json({ error: 'missing "file" field in multipart form data' }, 400);
  }

  if (!SUPPORTED_UPLOAD_MIME_TYPES.includes(file.type)) {
    return c.json({ error: `unsupported file type: ${file.type}` }, 400);
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return c.json({ error: 'file too large (max 10MB)' }, 400);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Storage keys reject many non-ASCII chars (e.g. Polish diacritics); the original name stays in files.filename.
  const safeName = file.name.normalize('NFKD').replace(/[^\w.-]+/g, '_');
  const storagePath = `${userId}/${crypto.randomUUID()}-${safeName}`;

  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, bytes, { contentType: file.type });
  if (uploadErr) return c.json({ error: uploadErr.message }, 500);

  const { data: fileRow, error: insertErr } = await supabase
    .from('files')
    .insert({ user_id: userId, filename: file.name, mime_type: file.type, storage_path: storagePath, status: 'pending' })
    .select()
    .single();
  if (insertErr) return c.json({ error: insertErr.message }, 500);

  // Respond immediately; keep processing after the response is sent. The
  // request's own RLS-scoped client is reused — the user's JWT stays valid
  // for the short time this takes (text extraction + two Gemini calls).
  c.executionCtx.waitUntil(processInvoiceFile(fileRow.id, bytes, file.type, supabase, userId, c.env.GEMINI_API_KEY));

  return c.json(fileRow, 202);
});

// Deletes the stored object, the invoices extracted from it and the file row.
// RLS scopes every query to the caller, so another user's id simply 404s.
files.delete('/:id', async (c) => {
  const supabase = c.get('supabase');
  const id = c.req.param('id');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: 'invalid file id' }, 400);

  const { data: fileRow, error: selectErr } = await supabase
    .from('files')
    .select('id, storage_path')
    .eq('id', id)
    .maybeSingle();
  if (selectErr) return c.json({ error: selectErr.message }, 500);
  if (!fileRow) return c.json({ error: 'file not found' }, 404);

  const { error: storageErr } = await supabase.storage.from(STORAGE_BUCKET).remove([fileRow.storage_path]);
  if (storageErr) return c.json({ error: storageErr.message }, 500);

  const { error: invoicesErr } = await supabase.from('invoices').delete().eq('file_id', id);
  if (invoicesErr) return c.json({ error: invoicesErr.message }, 500);

  const { error: deleteErr } = await supabase.from('files').delete().eq('id', id);
  if (deleteErr) return c.json({ error: deleteErr.message }, 500);

  return c.body(null, 204);
});

export default files;
