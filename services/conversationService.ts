import * as db from '../db/queries';
import { generateResponse, messagesToHistory } from '../ai/gemini';
import { buildContextPrompt } from '../ai/prompts';
import { searchBySemantic } from './noteService';
import { log } from '../langsmithLogger';
import type { Conversation, Message } from '../types';

export async function startConversation(userId: string): Promise<Conversation> {
  return db.createConversation(userId);
}

export async function getConversations(userId: string): Promise<Conversation[]> {
  return db.getConversationsByUser(userId);
}

export async function getHistory(conversationId: string): Promise<Message[]> {
  return db.getMessagesByConversation(conversationId);
}

export async function chat(
  conversationId: string,
  userId: string,
  userMessage: string
): Promise<string> {
  log('chat.start', { conversationId, userId, messageLength: userMessage.length });

  await db.addMessage(conversationId, 'user', userMessage);

  const history = await db.getMessagesByConversation(conversationId);
  const pastMessages = history.slice(0, -1);

  const relevantNotes = await searchBySemantic(userId, userMessage, 0.6, 5);
  log('chat.contextNotes', { count: relevantNotes.length });

  const contextPrompt = buildContextPrompt(relevantNotes);
  const geminiHistory = messagesToHistory(pastMessages);
  const response = await generateResponse(userMessage, geminiHistory, contextPrompt);

  await db.addMessage(conversationId, 'model', response);
  log('chat.done', { responseLength: response.length });
  return response;
}
