import * as dotenv from 'dotenv';
import { generateMissingEmbeddings } from '../services/embeddingService';

dotenv.config();

const userId = process.argv[2] ?? process.env.DEFAULT_USER_ID;

if (!userId) {
  console.error('Usage: ts-node scripts/generateEmbeddings.ts <user_id>');
  console.error('Or set DEFAULT_USER_ID in .env');
  process.exit(1);
}

async function main() {
  console.log(`Generating embeddings for user: ${userId}\n`);
  const count = await generateMissingEmbeddings(userId!);
  console.log(`\nDone. Generated ${count} embedding(s).`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
