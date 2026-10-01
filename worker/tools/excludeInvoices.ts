import { z } from 'zod';
import { SchemaType } from '@google/generative-ai';
import type { Tool } from './types';

const inputSchema = z.object({
  invoice_ids: z.array(z.string().uuid()).min(1).max(50),
  reason: z.string().min(1).max(300),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  excluded: { id: string; vendor_name: string | null; issue_date: string | null }[];
}

export const excludeInvoicesTool: Tool<Input, Output> = {
  name: 'exclude_invoices',
  description:
    "Mark specific invoices as excluded from KUP calculations (e.g. because they are personal, not business-related). Requires exact invoice ids — always call find_invoices first and confirm the specific invoice (vendor + date) with the user before calling this, since it changes their tax calculation.",
  inputSchema,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      invoice_ids: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING },
        description: 'Exact invoice UUIDs to exclude, from a prior find_invoices result',
      },
      reason: { type: SchemaType.STRING, description: 'Why these invoices are being excluded' },
    },
    required: ['invoice_ids', 'reason'],
  },
  async execute(input, ctx) {
    const { data, error } = await ctx.supabase
      .from('invoices')
      .update({ excluded: true, excluded_reason: input.reason })
      .in('id', input.invoice_ids)
      .select('id, vendor_name, issue_date');

    if (error) throw new Error(`exclude_invoices: ${error.message}`);
    return { excluded: data ?? [] };
  },
};
