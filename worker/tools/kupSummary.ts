import { z } from 'zod';
import { SchemaType } from '@google/generative-ai';
import type { Tool } from './types';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const inputSchema = z.object({
  date_from: dateString,
  date_to: dateString,
  basis: z.enum(['net', 'gross']).optional(),
});

type Input = z.infer<typeof inputSchema>;
type Basis = 'net' | 'gross';

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  vendor_name: string | null;
  issue_date: string | null;
  net_amount: number | null;
  vat_amount: number | null;
  gross_amount: number | null;
  category: string | null;
}

interface Output {
  invoices: InvoiceRow[];
  // Which amounts the KUP total is built from, and why.
  basis: Basis | 'unknown';
  basis_source: 'requested' | 'profile' | 'not_set';
  vat_payer: boolean | null;
  total_kup: number | null;
  total_net_amount: number;
  total_vat_amount: number;
  total_gross_amount: number;
  count: number;
  // Invoices whose amount for the chosen basis couldn't be read (left out of total_kup).
  missing_amount_count: number;
  excluded_count: number;
  instructions: string;
  disclaimer: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Gross is often missing on receipts that only state net + VAT; derive it when possible.
function grossOf(r: InvoiceRow): number | null {
  if (r.gross_amount != null) return r.gross_amount;
  if (r.net_amount != null && r.vat_amount != null) return r.net_amount + r.vat_amount;
  return null;
}

// Deterministic SQL aggregation — the model never computes this sum itself,
// it only picks the date range (and optionally the basis) and reads back the result.
// Every invoice counts unless the user excluded it.
export const kupSummaryTool: Tool<Input, Output> = {
  name: 'calculate_kup_summary',
  description:
    "Calculate the total tax-deductible cost (koszt uzyskania przychodu) from the user's uploaded invoices for a date range. All invoices count except those the user excluded. The basis depends on the user's VAT status: active VAT payers (czynny podatnik VAT) deduct input VAT, so KUP = net amounts; non-VAT payers (e.g. zwolnieni z VAT) cannot deduct it, so KUP = gross amounts. Leave `basis` empty to use the status saved in the user's profile; set it only if the user explicitly asks for net or gross. This is a bookkeeping aid — it does NOT model partial VAT deduction (e.g. 50% on passenger cars) or other category-specific limits, and must be verified by an accountant before filing.",
  inputSchema,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      date_from: { type: SchemaType.STRING, description: 'Start date, ISO format YYYY-MM-DD' },
      date_to: { type: SchemaType.STRING, description: 'End date, ISO format YYYY-MM-DD' },
      basis: {
        type: SchemaType.STRING,
        format: 'enum',
        enum: ['net', 'gross'],
        description: 'Only if the user explicitly asks: "net" (netto) or "gross" (brutto). Otherwise omit.',
      },
    },
    required: ['date_from', 'date_to'],
  },
  async execute(input, ctx) {
    const { data, error } = await ctx.supabase
      .from('invoices')
      .select('id, invoice_number, vendor_name, issue_date, net_amount, vat_amount, gross_amount, category')
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

    const { data: profile, error: profileErr } = await ctx.supabase
      .from('user_profiles')
      .select('vat_payer')
      .eq('user_id', ctx.userId)
      .maybeSingle();
    if (profileErr) throw new Error(`calculate_kup_summary: ${profileErr.message}`);
    const vatPayer: boolean | null = profile?.vat_payer ?? null;

    let basis: Basis | 'unknown';
    let basisSource: Output['basis_source'];
    if (input.basis) {
      basis = input.basis;
      basisSource = 'requested';
    } else if (vatPayer !== null) {
      basis = vatPayer ? 'net' : 'gross';
      basisSource = 'profile';
    } else {
      basis = 'unknown';
      basisSource = 'not_set';
    }

    const rows = (data ?? []) as InvoiceRow[];
    const totalNet = rows.reduce((s, r) => s + (r.net_amount ?? 0), 0);
    const totalVat = rows.reduce((s, r) => s + (r.vat_amount ?? 0), 0);
    const totalGross = rows.reduce((s, r) => s + (grossOf(r) ?? 0), 0);

    const amountFor = (r: InvoiceRow) => (basis === 'gross' ? grossOf(r) : r.net_amount);
    const missing = basis === 'unknown' ? 0 : rows.filter((r) => amountFor(r) == null).length;
    const totalKup = basis === 'unknown' ? null : basis === 'net' ? totalNet : totalGross;

    const instructions =
      basisSource === 'not_set'
        ? 'The user has not set their VAT status. Show BOTH totals (KUP netto for active VAT payers, KUP brutto for non-VAT payers), ask which applies, and mention they can save it in "Faktury" → "Rozliczenie VAT".'
        : `Report total_kup as KUP ${basis === 'net' ? 'netto' : 'brutto'} and say why (${
            basisSource === 'requested'
              ? 'the user asked for it'
              : vatPayer
                ? 'active VAT payer — VAT is deducted, so it is not a cost'
                : 'not a VAT payer — VAT cannot be deducted, so it is part of the cost'
          }).${missing > 0 ? ` ${missing} invoice(s) had no readable amount and are not in the total — list them.` : ''}`;

    return {
      invoices: rows,
      basis,
      basis_source: basisSource,
      vat_payer: vatPayer,
      total_kup: totalKup == null ? null : round2(totalKup),
      total_net_amount: round2(totalNet),
      total_vat_amount: round2(totalVat),
      total_gross_amount: round2(totalGross),
      count: rows.length,
      missing_amount_count: missing,
      excluded_count: excludedCount ?? 0,
      instructions,
      disclaimer:
        'Suma to prosta agregacja kwot z faktur (bez wykluczonych). Nie uwzględnia częściowego odliczenia VAT (np. 50% przy samochodach osobowych) ani innych limitów kosztów — zweryfikuj z księgowym przed złożeniem deklaracji.',
    };
  },
};
