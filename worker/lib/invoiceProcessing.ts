import type { SupabaseClient } from '@supabase/supabase-js';
import { extractInvoiceFields, classifyInvoice } from './geminiStructured';

// Runs after the upload response has already been sent (via c.executionCtx.waitUntil),
// so failures here must update `files.status` rather than throw back to a caller.
export async function processInvoiceFile(
  fileId: string,
  text: string,
  supabase: SupabaseClient,
  userId: string,
  apiKey: string
): Promise<void> {
  try {
    await supabase.from('files').update({ status: 'processing' }).eq('id', fileId);

    const extracted = await extractInvoiceFields(apiKey, text);

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('business_description')
      .eq('user_id', userId)
      .maybeSingle();

    const classification = await classifyInvoice(apiKey, profile?.business_description ?? '', extracted);

    const { error: insertErr } = await supabase.from('invoices').insert({
      user_id: userId,
      file_id: fileId,
      invoice_number: extracted.invoice_number,
      vendor_name: extracted.vendor_name,
      issue_date: extracted.issue_date,
      net_amount: extracted.net_amount,
      vat_amount: extracted.vat_amount,
      gross_amount: extracted.gross_amount,
      category: extracted.category,
      is_business: classification.is_business,
      classification_reason: classification.reason,
      raw_extraction: extracted,
    });
    if (insertErr) throw new Error(insertErr.message);

    await supabase.from('files').update({ status: 'done' }).eq('id', fileId);
  } catch (err) {
    await supabase
      .from('files')
      .update({ status: 'error', error_message: (err as Error).message })
      .eq('id', fileId);
  }
}
