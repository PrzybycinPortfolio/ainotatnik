import { Hono } from 'hono';
import { z } from 'zod';
import type { Content } from '@google/generative-ai';
import type { AppBindings } from '../types';
import { generateNoteEmbedding, startToolChatSession } from '../lib/gemini';
import { getFunctionDeclarations, executeTool, DISCLAIMER_REQUIRED_TOOLS } from '../tools/registry';
import { extractDocumentText, SUPPORTED_UPLOAD_MIME_TYPES } from '../lib/documentExtract';

const chat = new Hono<AppBindings>();

// Hard cap on tool-call round trips per message so a confused model can't
// loop indefinitely (each round trip is a billed Gemini call).
const MAX_TOOL_ITERATIONS = 5;

const KUP_DISCLAIMER_MARKER = 'zweryfikuj z księgowym';
const LEGAL_DISCLAIMER_MARKER = 'nie zastępuje porady prawnika';
const FALLBACK_DISCLAIMER =
  '⚠️ Odpowiedź wygenerowana na podstawie narzędzi finansowych/prawnych tej aplikacji — to materiał pomocniczy, zweryfikuj z księgowym lub prawnikiem przed podjęciem działań.\n\n';

// Don't trust the model to always include the disclaimer text its own tool
// result returned — if a disclaimer-requiring tool ran this turn and the
// final response doesn't contain either known marker, prepend a fixed one.
function ensureDisclaimer(response: string, toolsUsed: Set<string>): string {
  const requiresDisclaimer = [...toolsUsed].some((name) => DISCLAIMER_REQUIRED_TOOLS.has(name));
  if (!requiresDisclaimer) return response;

  const lower = response.toLowerCase();
  if (lower.includes(KUP_DISCLAIMER_MARKER) || lower.includes(LEGAL_DISCLAIMER_MARKER)) return response;

  return FALLBACK_DISCLAIMER + response;
}

const messageSchema = z.object({ message: z.string().min(1).max(4000) });

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB, same as uploads
const MAX_ATTACHMENT_CHARS = 60_000;
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
};

type Attachment = { name: string; text: string };

// A local file sent with the message: its text is extracted in memory and
// passed to the model for this turn only. Nothing is written to Storage or
// the database except a "📎 name" marker on the user's message.
async function readAttachment(file: File): Promise<Attachment> {
  const mimeType = file.type || MIME_BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''] || '';
  if (!SUPPORTED_UPLOAD_MIME_TYPES.includes(mimeType)) throw new Error(`unsupported file type: ${file.type || file.name}`);
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('file too large (max 10MB)');

  const text = (await extractDocumentText(mimeType, new Uint8Array(await file.arrayBuffer()))).trim();
  if (!text) throw new Error('no text could be read from the file (scanned PDF?)');
  return { name: file.name, text: text.slice(0, MAX_ATTACHMENT_CHARS) };
}

// Accepts JSON {message} or multipart form data with "message" and an optional "file".
async function parseMessageRequest(req: Request): Promise<{ message: unknown; file: File | null }> {
  if (req.headers.get('content-type')?.startsWith('multipart/form-data')) {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    return { message: form?.get('message'), file: file instanceof File && file.size > 0 ? file : null };
  }
  const body = (await req.json().catch(() => null)) as { message?: unknown } | null;
  return { message: body?.message, file: null };
}

chat.post('/', async (c) => {
  const { data, error } = await c
    .get('supabase')
    .from('conversations')
    .insert({ user_id: c.get('userId') })
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data, 201);
});

chat.get('/', async (c) => {
  const { data, error } = await c
    .get('supabase')
    .from('conversations')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

// Messages are removed by ON DELETE CASCADE. RLS limits the delete to the
// caller's own conversations, so an id that isn't theirs deletes nothing → 404.
chat.delete('/:id', async (c) => {
  const { data, error } = await c
    .get('supabase')
    .from('conversations')
    .delete()
    .eq('id', c.req.param('id'))
    .select('id');

  if (error) return c.json({ error: error.message }, 500);
  if (!data || data.length === 0) return c.json({ error: 'conversation not found' }, 404);
  return c.body(null, 204);
});

chat.get('/:id/messages', async (c) => {
  const { data, error } = await c
    .get('supabase')
    .from('messages')
    .select('*')
    .eq('conversation_id', c.req.param('id'))
    .order('created_at', { ascending: true });

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

chat.post('/:id/messages', async (c) => {
  const conversationId = c.req.param('id');
  const request = await parseMessageRequest(c.req.raw);
  const parsed = messageSchema.safeParse({ message: request.message });
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  let attachment: Attachment | null = null;
  if (request.file) {
    try {
      attachment = await readAttachment(request.file);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  }

  const supabase = c.get('supabase');
  const userId = c.get('userId');
  const apiKey = c.env.GEMINI_API_KEY;
  const userMessage = parsed.data.message;
  const storedMessage = attachment ? `📎 ${attachment.name}\n${userMessage}` : userMessage;
  const modelMessage = attachment
    ? `${userMessage}\n\n<local_file name="${attachment.name.replace(/"/g, "'")}">\n${attachment.text}\n</local_file>`
    : userMessage;

  const { error: insertErr } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, role: 'user', content: storedMessage });
  if (insertErr) return c.json({ error: insertErr.message }, 500);

  const { data: history, error: histErr } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (histErr) return c.json({ error: histErr.message }, 500);

  const pastMessages = (history ?? []).slice(0, -1);
  const geminiHistory: Content[] = pastMessages.map((m: { role: 'user' | 'model'; content: string }) => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));

  const session = startToolChatSession(apiKey, getFunctionDeclarations(), geminiHistory);
  let turnResult = await session.sendMessage(modelMessage);
  const toolsUsed = new Set<string>();

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const calls = turnResult.response.functionCalls();
    if (!calls || calls.length === 0) break;

    const functionResponses = await Promise.all(
      calls.map(async (call) => {
        toolsUsed.add(call.name);
        try {
          const output = await executeTool(call.name, call.args, { supabase, userId, geminiApiKey: apiKey });
          return { functionResponse: { name: call.name, response: { result: output } } };
        } catch (err) {
          return { functionResponse: { name: call.name, response: { error: (err as Error).message } } };
        }
      })
    );

    turnResult = await session.sendMessage(functionResponses);
  }

  const response = ensureDisclaimer(turnResult.response.text(), toolsUsed);

  const actionMatch = response.match(/\[ACTION:CREATE_NOTE\]([\s\S]*?)\[\/ACTION\]/);
  if (actionMatch) {
    try {
      const { title, content } = JSON.parse(actionMatch[1]);
      const { data: note } = await supabase
        .from('notes')
        .insert({ user_id: userId, title, content })
        .select()
        .single();
      if (note) {
        const embedding = await generateNoteEmbedding(apiKey, note.title, note.content);
        await supabase.from('embeddings').upsert({ note_id: note.id, embedding: JSON.stringify(embedding) }, { onConflict: 'note_id' });
      }
    } catch (err) {
      console.warn('Failed to create note from action:', err);
    }
  }

  const cleanResponse = response.replace(/\[ACTION:CREATE_NOTE\][\s\S]*?\[\/ACTION\]\n?/g, '');
  await supabase.from('messages').insert({ conversation_id: conversationId, role: 'model', content: cleanResponse });

  return c.json({ response: cleanResponse });
});

export default chat;
