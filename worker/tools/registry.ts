import type { FunctionDeclaration } from '@google/generative-ai';
import type { Tool, ToolContext } from './types';
import { semanticSearchTool } from './semanticSearch';
import { keywordSearchTool } from './keywordSearch';
import { kupSummaryTool } from './kupSummary';
import { findInvoicesTool } from './findInvoices';
import { excludeInvoicesTool } from './excludeInvoices';
import { legalSearchTool } from './legalSearch';

// Single place a new capability gets wired in. Each tool is self-contained
// (worker/tools/*.ts) and validated independently — this file only lists and
// dispatches them, it never contains business logic itself.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tools: Tool<any, any>[] = [
  semanticSearchTool,
  keywordSearchTool,
  kupSummaryTool,
  findInvoicesTool,
  excludeInvoicesTool,
  legalSearchTool,
];

// Tool names whose output requires a disclaimer in the final chat response.
// Enforced in routes/chat.ts regardless of whether the model remembers to
// include one, so the guarantee doesn't depend on prompt compliance.
export const DISCLAIMER_REQUIRED_TOOLS = new Set([legalSearchTool.name, kupSummaryTool.name]);

const toolsByName = new Map(tools.map((t) => [t.name, t]));

export function getFunctionDeclarations(): FunctionDeclaration[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

export async function executeTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<unknown> {
  const tool = toolsByName.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);

  const parsed = tool.inputSchema.safeParse(rawArgs);
  if (!parsed.success) throw new Error(`Invalid arguments for ${name}: ${parsed.error.message}`);

  return tool.execute(parsed.data, ctx);
}
