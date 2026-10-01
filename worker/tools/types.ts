import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import type { FunctionDeclarationSchema } from '@google/generative-ai';

export interface ToolContext {
  supabase: SupabaseClient;
  userId: string;
  geminiApiKey: string;
}

// Every capability the chat can invoke implements this shape. The chat layer
// never knows about individual tools — it only talks to the registry
// (worker/tools/registry.ts), so adding a new one means adding a new file
// here and one line in the registry, not touching routes/chat.ts.
export interface Tool<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  // Validates and types the raw args Gemini returns for a function call.
  inputSchema: z.ZodType<Input>;
  // Gemini-facing JSON schema describing the same shape as inputSchema.
  // Kept separate (not derived from Zod) so both stay simple and explicit.
  parameters: FunctionDeclarationSchema;
  execute: (input: Input, ctx: ToolContext) => Promise<Output>;
}
