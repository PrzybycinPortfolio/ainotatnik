import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { withModelFallback } from './gemini';

export interface ExtractedInvoice {
  invoice_number: string | null;
  vendor_name: string | null;
  issue_date: string | null; // ISO 8601, YYYY-MM-DD
  net_amount: number | null;
  vat_amount: number | null;
  gross_amount: number | null;
  category: string | null;
}

const invoiceExtractionSchema = {
  type: SchemaType.OBJECT,
  properties: {
    invoice_number: { type: SchemaType.STRING, nullable: true },
    vendor_name: { type: SchemaType.STRING, nullable: true },
    issue_date: { type: SchemaType.STRING, description: 'ISO 8601 date (YYYY-MM-DD)', nullable: true },
    net_amount: { type: SchemaType.NUMBER, nullable: true },
    vat_amount: { type: SchemaType.NUMBER, nullable: true },
    gross_amount: { type: SchemaType.NUMBER, nullable: true },
    category: {
      type: SchemaType.STRING,
      description: 'Short category label, e.g. "paliwo", "materiały biurowe", "usługi IT"',
      nullable: true,
    },
  },
  required: [],
};

// Clients are created per call, same reasoning as worker/lib/gemini.ts: Workers
// only expose secrets through the request's env, never as module-load globals.
export async function extractInvoiceFields(apiKey: string, documentText: string): Promise<ExtractedInvoice> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const prompt = `Extract invoice fields from the following document text. Use null for any field you cannot find — never guess a value.\n\n${documentText}`;
  return withModelFallback(async (modelName) => {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { responseMimeType: 'application/json', responseSchema: invoiceExtractionSchema },
    });
    const result = await model.generateContent(prompt);
    return JSON.parse(result.response.text()) as ExtractedInvoice;
  });
}

export interface InvoiceClassification {
  is_business: boolean;
  reason: string;
}

const classificationSchema = {
  type: SchemaType.OBJECT,
  properties: {
    is_business: { type: SchemaType.BOOLEAN },
    reason: { type: SchemaType.STRING, description: 'Short justification shown to the user for auditability' },
  },
  required: ['is_business', 'reason'],
};

export async function classifyInvoice(
  apiKey: string,
  businessDescription: string,
  invoice: ExtractedInvoice
): Promise<InvoiceClassification> {
  const genAI = new GoogleGenerativeAI(apiKey);

  const prompt = `User's business activity: ${businessDescription || '(not provided — be conservative)'}

Invoice data: ${JSON.stringify(invoice)}

Does this invoice plausibly relate to the user's business activity (true), or does it look personal/unrelated (false)?
If unsure, prefer false and explain why in "reason". This classification affects a tax deduction decision, so do not guess favorably.`;

  return withModelFallback(async (modelName) => {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { responseMimeType: 'application/json', responseSchema: classificationSchema },
    });
    const result = await model.generateContent(prompt);
    return JSON.parse(result.response.text()) as InvoiceClassification;
  });
}
