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
  const storagePath = `${userId}/${crypto.randomUUID()}-${file.name}`;

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

export default files;
