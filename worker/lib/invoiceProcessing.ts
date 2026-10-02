import type { SupabaseClient } from '@supabase/supabase-js';
import { extractInvoiceFields } from './geminiStructured';

// Every uploaded invoice counts as a business cost by default; the user excludes
// private ones explicitly (exclude_invoices tool), so no AI classification step.
const DEFAULT_CLASSIFICATION_REASON = 'Domyślnie uznana za firmową — wyklucz ją, jeśli to wydatek prywatny.';

const STORAGE_BUCKET = 'uploads';

async function rejectFile(supabase: SupabaseClient, fileId: string, message: string): Promise<void> {
  const { data: fileRow } = await supabase.from('files').select('storage_path').eq('id', fileId).maybeSingle();
  if (fileRow?.storage_path) {
    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([fileRow.storage_path]);
    if (error) console.error(`Could not remove rejected file ${fileId} from storage:`, error.message);
  }
  await supabase.from('files').update({ status: 'rejected', error_message: message }).eq('id', fileId);
}

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

    // Not an invoice (or one with no amount at all): never let it into KUP, and
    // don't keep the stored file — it could be anything the user picked by mistake.
    const hasAmount = [extracted.net_amount, extracted.vat_amount, extracted.gross_amount].some((v) => v != null);
    if (!extracted.is_invoice || !hasAmount) {
      const reason = !extracted.is_invoice
        ? extracted.not_invoice_reason || 'Dokument nie wygląda na fakturę ani rachunek.'
        : 'Nie znaleziono w dokumencie żadnej kwoty do zapłaty.';
      await rejectFile(supabase, fileId, `To nie jest faktura — ${reason.replace(/\.$/, '')}. Plik nie został zapisany.`);
      return;
    }

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
      is_business: true,
      classification_reason: DEFAULT_CLASSIFICATION_REASON,
      raw_extraction: extracted,
    });
    if (insertErr) throw new Error(insertErr.message);

    await supabase.from('files').update({ status: 'done' }).eq('id', fileId);
  } catch (err) {
    // Raw errors (model names, API details) stay in the logs; the UI shows a generic message.
    console.error(`Invoice processing failed for file ${fileId}:`, (err as Error).message);
    await supabase
      .from('files')
      .update({
        status: 'error',
        error_message: 'Asystent AI był chwilowo niedostępny. Aplikacja ponowi próbę automatycznie — możesz też kliknąć „Ponów”.',
      })
      .eq('id', fileId);
  }
}
