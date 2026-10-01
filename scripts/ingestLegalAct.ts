import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { supabase } from '../config/supabase';
import { generateEmbedding } from '../ai/embeddings';

dotenv.config();

// legal_acts/legal_chunks are shared reference data with no user_id, writable
// only via the service-role key — this script is the only writer, run by the
// app owner from a terminal, never exposed through the public API.

interface LegalChunk {
  articleNumber: string | null;
  content: string;
}

function chunkLegalText(text: string): LegalChunk[] {
  const parts = text.split(/(?=Art\.\s*\d+[a-zA-Z]?\.)/g).map((p) => p.trim()).filter(Boolean);

  return parts.map((part) => {
    const match = part.match(/^Art\.\s*(\d+[a-zA-Z]?)\./);
    return { articleNumber: match ? `art. ${match[1]}` : null, content: part };
  });
}

async function main() {
  const [filePath, actName, legalStatusDate] = process.argv.slice(2);

  if (!filePath || !actName || !legalStatusDate) {
    console.error('Usage: ts-node scripts/ingestLegalAct.ts <path-to-txt> <act-name> <legal-status-date YYYY-MM-DD>');
    console.error('Example: ts-node scripts/ingestLegalAct.ts ./kodeks-karny.txt "Kodeks karny" 2026-01-01');
    process.exit(1);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(legalStatusDate)) {
    console.error('legal-status-date must be in YYYY-MM-DD format');
    process.exit(1);
  }

  const text = fs.readFileSync(filePath, 'utf-8');
  const chunks = chunkLegalText(text);

  if (chunks.length === 0) {
    console.error('No "Art. N." boundaries found — nothing to ingest. Is this the right document?');
    process.exit(1);
  }

  console.log(`Parsed ${chunks.length} article chunk(s) from "${actName}".`);

  const { data: act, error: actErr } = await supabase
    .from('legal_acts')
    .insert({ act_name: actName, legal_status_date: legalStatusDate })
    .select()
    .single();

  if (actErr) {
    console.error(`Failed to create legal_acts row: ${actErr.message}`);
    process.exit(1);
  }

  let inserted = 0;
  for (const chunk of chunks) {
    try {
      const embedding = await generateEmbedding(chunk.content);
      const { error } = await supabase.from('legal_chunks').insert({
        legal_act_id: act.id,
        article_number: chunk.articleNumber,
        content: chunk.content,
        embedding: JSON.stringify(embedding),
      });
      if (error) throw new Error(error.message);
      inserted++;
      console.log(`  ✓ ${chunk.articleNumber ?? '(no article number)'} — ${inserted}/${chunks.length}`);
    } catch (err) {
      console.error(`  ✗ Failed on ${chunk.articleNumber ?? '(unknown)'}:`, err);
    }
  }

  console.log(`\nDone. Ingested ${inserted}/${chunks.length} chunks for "${actName}" (legal_act_id: ${act.id}).`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
