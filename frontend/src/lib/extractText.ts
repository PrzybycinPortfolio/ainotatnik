// Text extraction runs in the browser: parsing PDFs on the Worker blows the
// free plan's CPU limit, and this way a chat attachment never leaves the
// user's machine as a file — only its text is sent.

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_TEXT_CHARS = 60_000;

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: PDF_MIME,
  docx: DOCX_MIME,
  txt: 'text/plain',
  md: 'text/markdown',
};

// Windows often reports an empty type for .md files, so fall back to the extension.
export function detectMimeType(file: File): string {
  return file.type || MIME_BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''] || '';
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  // Lazy-loaded: pdf.js is large and only needed when a PDF is picked.
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

async function extractDocx(bytes: Uint8Array): Promise<string> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) throw new Error('Nieprawidłowy plik .docx');

  const withParagraphBreaks = documentXml.replace(/<\/w:p>/g, '\n');
  const textRuns = [...withParagraphBreaks.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)];
  const doc = new DOMParser().parseFromString(`<x>${textRuns.map((m) => m[1]).join('')}</x>`, 'text/html');
  return doc.body.textContent ?? '';
}

export async function extractFileText(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new Error('Plik jest za duży (max 10 MB).');

  const mimeType = detectMimeType(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  if (mimeType === PDF_MIME) text = await extractPdf(bytes);
  else if (mimeType === DOCX_MIME) text = await extractDocx(bytes);
  else if (mimeType.startsWith('text/')) text = new TextDecoder().decode(bytes);
  else throw new Error('Nieobsługiwany typ pliku. Dozwolone: PDF, DOCX, TXT, MD.');

  text = text.trim();
  if (!text) throw new Error('Nie udało się odczytać tekstu z pliku (może to skan bez warstwy tekstowej?).');
  return text.slice(0, MAX_TEXT_CHARS);
}
