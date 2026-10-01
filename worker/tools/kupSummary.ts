import { z } from 'zod';
import { SchemaType } from '@google/generative-ai';
import type { Tool } from './types';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const inputSchema = z.object({
  date_from: dateString,
  date_to: dateString,
});

type Input = z.infer<typeof inputSchema>;

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  vendor_name: string | null;
  issue_date: string | null;
  net_amount: number | null;
  category: string | null;
}

interface Output {
  invoices: InvoiceRow[];
  total_net_amount: number;
  count: number;
  excluded_count: number;
  disclaimer: string;
}

// Deterministic SQL aggregation — the model never computes this sum itself,
// it only picks the date range and reads back the result. Only invoices
// classified `is_business = true` and not `excluded` are counted.
export const kupSummaryTool: Tool<Input, Output> = {
  name: 'calculate_kup_summary',
  description:
    "Calculate the total tax-deductible cost (koszt uzyskania przychodu) from the user's uploaded invoices for a date range. Only includes invoices classified as business-related and not excluded by the user. This is a bookkeeping aid based on a simple sum of net amounts — it does NOT model category-specific tax exceptions (e.g. partial vehicle or representation cost limits) and must be verified by an accountant before filing.",
  inputSchema,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      date_from: { type: SchemaType.STRING, description: 'Start date, ISO format YYYY-MM-DD' },
      date_to: { type: SchemaType.STRING, description: 'End date, ISO format YYYY-MM-DD' },
    },
    required: ['date_from', 'date_to'],
  },
  async execute(input, ctx) {
    const { data, error } = await ctx.supabase
      .from('invoices')
      .select('id, invoice_number, vendor_name, issue_date, net_amount, category')
      .eq('is_business', true)
      .eq('excluded', false)
      .gte('issue_date', input.date_from)
      .lte('issue_date', input.date_to)
      .order('issue_date', { ascending: true });

    if (error) throw new Error(`calculate_kup_summary: ${error.message}`);

    const { count: excludedCount, error: excludedErr } = await ctx.supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('excluded', true)
      .gte('issue_date', input.date_from)
      .lte('issue_date', input.date_to);

    if (excludedErr) throw new Error(`calculate_kup_summary: ${excludedErr.message}`);

    const rows = data ?? [];
    const total = rows.reduce((sum, r) => sum + (r.net_amount ?? 0), 0);

    return {
      invoices: rows,
      total_net_amount: Math.round(total * 100) / 100,
      count: rows.length,
      excluded_count: excludedCount ?? 0,
      disclaimer:
        'Suma to prosta agregacja kwot netto faktur zaklasyfikowanych jako biznesowe. Nie uwzględnia wyjątków podatkowych (np. limitów na samochody osobowe czy koszty reprezentacji) — zweryfikuj z księgowym przed złożeniem deklaracji.',
    };
  },
};
