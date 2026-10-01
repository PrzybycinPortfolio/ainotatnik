import { extractText, getDocumentProxy } from 'unpdf';
import JSZip from 'jszip';

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

// .docx is a zip of XML parts. We only need the text runs (<w:t>) from the
// main document body — pulling them via regex avoids a full OOXML parser
// dependency, which matters on Workers where every extra Node-oriented
// package is a risk for the runtime's limited compatibility shims.
export async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) throw new Error('Invalid .docx file: missing word/document.xml');

  const withParagraphBreaks = documentXml.replace(/<\/w:p>/g, '\n');
  const textRuns = [...withParagraphBreaks.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)];
  return textRuns.map((m) => m[1]).join('').trim();
}

export async function extractDocumentText(mimeType: string, bytes: Uint8Array): Promise<string> {
  if (mimeType === PDF_MIME) return extractPdfText(bytes);
  if (mimeType === DOCX_MIME) return extractDocxText(bytes);
  if (mimeType.startsWith('text/')) return new TextDecoder().decode(bytes);
  throw new Error(`Unsupported file type: ${mimeType}`);
}

export const SUPPORTED_UPLOAD_MIME_TYPES = [PDF_MIME, DOCX_MIME, 'text/plain', 'text/markdown'];
