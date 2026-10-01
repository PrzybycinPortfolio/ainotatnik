import { z } from 'zod';
import { SchemaType } from '@google/generative-ai';
import type { Tool } from './types';
import { escapeLikeValue } from '../lib/text';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const inputSchema = z.object({
  vendor_name: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  date_from: dateString.optional(),
  date_to: dateString.optional(),
});

type Input = z.infer<typeof inputSchema>;

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  vendor_name: string | null;
  issue_date: string | null;
  net_amount: number | null;
  category: string | null;
  is_business: boolean | null;
  excluded: boolean;
}

interface Output {
  invoices: InvoiceRow[];
}

// Lets the model locate a specific invoice (by vendor/date/category) before
// asking the user to confirm an exclusion — exclude_invoices only accepts
// ids, never free text, so this is the required first step of that flow.
export const findInvoicesTool: Tool<Input, Output> = {
  name: 'find_invoices',
  description:
    "Find invoices matching optional filters (vendor name, category, date range). Use this to identify a specific invoice by id before excluding it or discussing it further — never guess an invoice id.",
  inputSchema,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      vendor_name: { type: SchemaType.STRING, description: 'Partial or full vendor/seller name' },
      category: { type: SchemaType.STRING, description: 'Partial or full category label' },
      date_from: { type: SchemaType.STRING, description: 'Start date, ISO format YYYY-MM-DD' },
      date_to: { type: SchemaType.STRING, description: 'End date, ISO format YYYY-MM-DD' },
    },
    required: [],
  },
  async execute(input, ctx) {
    let query = ctx.supabase
      .from('invoices')
      .select('id, invoice_number, vendor_name, issue_date, net_amount, category, is_business, excluded');

    if (input.vendor_name) query = query.ilike('vendor_name', `%${escapeLikeValue(input.vendor_name)}%`);
    if (input.category) query = query.ilike('category', `%${escapeLikeValue(input.category)}%`);
    if (input.date_from) query = query.gte('issue_date', input.date_from);
    if (input.date_to) query = query.lte('issue_date', input.date_to);

    const { data, error } = await query.order('issue_date', { ascending: false }).limit(20);
    if (error) throw new Error(`find_invoices: ${error.message}`);

    return { invoices: data ?? [] };
  },
};
