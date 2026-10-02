import { Hono } from 'hono';
import { z } from 'zod';
import type { Content, GenerateContentResult } from '@google/generative-ai';
import type { AppBindings } from '../types';
import { generateNoteEmbedding, startToolChatSession, withModelFallback } from '../lib/gemini';
import { getFunctionDeclarations, executeTool, DISCLAIMER_REQUIRED_TOOLS } from '../tools/registry';

const chat = new Hono<AppBindings>();

// Hard cap on tool-call round trips per message so a confused model can't
// loop indefinitely (each round trip is a billed Gemini call).
const MAX_TOOL_ITERATIONS = 5;

const AI_UNAVAILABLE_MESSAGE =
  '⚠️ Asystent AI jest chwilowo niedostępny i nie mógł odpowiedzieć. Twoja wiadomość została zapisana — spróbuj ponownie za chwilę.';

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

// Optional local-file attachments (e.g. a batch of invoices): the browser
// extracts the text (parsing PDFs here exceeds the Workers CPU limit) and sends
// it with every message until detached. Nothing is stored except a "📎 names"
// marker on the user's message.
const MAX_ATTACHMENTS = 100;
const MAX_ATTACHMENTS_TOTAL_CHARS = 500_000; // ~125k tokens; the frontend trims files to fit
const attachmentSchema = z.object({
  name: z.string().min(1).max(255),
  text: z.string().min(1).max(60_000),
});
const messageSchema = z
  .object({
    message: z.string().min(1).max(4000),
    attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).optional(),
  })
  .refine((v) => (v.attachments ?? []).reduce((sum, a) => sum + a.text.length, 0) <= MAX_ATTACHMENTS_TOTAL_CHARS, {
    message: 'attachments too large in total',
  });

function attachmentMarker(names: string[]): string {
  if (names.length === 1) return `📎 ${names[0]}`;
  const shown = names.slice(0, 5).join(', ');
  return `📎 ${names.length} plików: ${shown}${names.length > 5 ? `, … (+${names.length - 5})` : ''}`;
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
  const parsed = messageSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const attachments = parsed.data.attachments ?? [];
  const hasAttachments = attachments.length > 0;
  const supabase = c.get('supabase');
  const userId = c.get('userId');
  const apiKey = c.env.GEMINI_API_KEY;
  const userMessage = parsed.data.message;
  const storedMessage = hasAttachments
    ? `${attachmentMarker(attachments.map((a) => a.name))}\n${userMessage}`
    : userMessage;
  const modelMessage = hasAttachments
    ? `${userMessage}\n\n` +
      attachments
        .map((a) => `<local_file name="${a.name.replace(/"/g, "'")}">\n${a.text}\n</local_file>`)
        .join('\n\n') +
      `\n\n(${attachments.length} attached document(s) above. Answer strictly from them. If the question is not ` +
      'about these documents or they do not contain the answer, say so instead of answering from general knowledge.)'
    : userMessage;
  // With documents attached the answer must come from them alone, so the model gets no tools:
  // it cannot pull in other legal acts, notes or saved invoices even if it ignores the prompt.
  const functionDeclarations = hasAttachments ? [] : getFunctionDeclarations();

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

  // Earlier failed turns leave user messages without a model reply; Gemini
  // expects alternating roles, so consecutive same-role messages are merged.
  const geminiHistory: Content[] = [];
  for (const m of (history ?? []).slice(0, -1) as { role: 'user' | 'model'; content: string }[]) {
    const last = geminiHistory[geminiHistory.length - 1];
    if (last?.role === m.role) last.parts.push({ text: m.content });
    else geminiHistory.push({ role: m.role, parts: [{ text: m.content }] });
  }

  let turnResult: GenerateContentResult;
  const toolsUsed = new Set<string>();
  try {
    // Only the first call falls back to another model: once a tool has run, retrying
    // the whole turn elsewhere could repeat its side effects.
    const session = await withModelFallback(async (model) => {
      const s = startToolChatSession(apiKey, model, functionDeclarations, geminiHistory);
      turnResult = await s.sendMessage(modelMessage);
      return s;
    });

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const calls = turnResult!.response.functionCalls();
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
    if (!turnResult!.response.text().trim()) throw new Error('empty model response');
  } catch (err) {
    // Details go to the logs only; the user gets a generic message, never the model name or raw error.
    console.error('Chat AI failure:', (err as Error).message);
    return c.json({ response: AI_UNAVAILABLE_MESSAGE, failed: true });
  }

  const response = ensureDisclaimer(turnResult!.response.text(), toolsUsed);

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
