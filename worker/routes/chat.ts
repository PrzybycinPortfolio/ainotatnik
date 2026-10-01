import { Hono } from 'hono';
import { z } from 'zod';
import type { Content } from '@google/generative-ai';
import type { AppBindings } from '../types';
import { generateNoteEmbedding, startToolChatSession } from '../lib/gemini';
import { getFunctionDeclarations, executeTool } from '../tools/registry';

const chat = new Hono<AppBindings>();

// Hard cap on tool-call round trips per message so a confused model can't
// loop indefinitely (each round trip is a billed Gemini call).
const MAX_TOOL_ITERATIONS = 5;

const messageSchema = z.object({ message: z.string().min(1).max(4000) });

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

  const supabase = c.get('supabase');
  const userId = c.get('userId');
  const apiKey = c.env.GEMINI_API_KEY;
  const userMessage = parsed.data.message;

  const { error: insertErr } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, role: 'user', content: userMessage });
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
  let turnResult = await session.sendMessage(userMessage);

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const calls = turnResult.response.functionCalls();
    if (!calls || calls.length === 0) break;

    const functionResponses = await Promise.all(
      calls.map(async (call) => {
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

  const response = turnResult.response.text();

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
