import { GoogleGenerativeAI, type Content } from '@google/generative-ai';
import * as dotenv from 'dotenv';
import { SYSTEM_PROMPT } from './prompts';
import { traceable, log } from '../langsmithLogger';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export function createChatModel() {
  return genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: SYSTEM_PROMPT,
  });
}

async function _generateResponse(
  userMessage: string,
  history: Content[] = [],
  contextPrompt = ''
): Promise<string> {
  log('generateResponse', { messageLength: userMessage.length, historyLength: history.length });

  const model = createChatModel();
  const chat = model.startChat({ history });

  const messageWithContext = contextPrompt
    ? `${userMessage}${contextPrompt}`
    : userMessage;

  const result = await chat.sendMessage(messageWithContext);
  return result.response.text();
}

async function _generateText(prompt: string): Promise<string> {
  log('generateText', { promptLength: prompt.length });
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

export const generateResponse = traceable(_generateResponse as (...args: unknown[]) => Promise<unknown>, {
  name: 'gemini.generateResponse',
  runType: 'llm',
}) as typeof _generateResponse;

export const generateText = traceable(_generateText as (...args: unknown[]) => Promise<unknown>, {
  name: 'gemini.generateText',
  runType: 'llm',
}) as typeof _generateText;

export function messagesToHistory(
  messages: { role: 'user' | 'model'; content: string }[]
): Content[] {
  return messages.map((m) => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));
}
