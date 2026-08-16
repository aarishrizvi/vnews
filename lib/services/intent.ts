import { GoogleGenAI } from '@google/genai';

export interface IntentCheckResult {
  isValidClaim: boolean;
  verifiable: boolean;
  type: string;
  claim: string;
  subject?: string;
  event?: string | null;
  location?: string | null;
  temporalContext?: string;
  message?: string;
}

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

const MODEL = 'gemma-4-31b-it';

function fallback(query: string): IntentCheckResult {
  return {
    isValidClaim: true,
    verifiable: true,
    type: 'FACTUAL_CLAIM',
    claim: query.trim(),
    subject: query.trim(),
    event: null,
    temporalContext: 'unknown',
  };
}

export async function checkQueryIntent(query: string): Promise<IntentCheckResult> {
  const cleaned = query.replace(/\s+/g, ' ').trim();

  if (!cleaned) {
    return {
      isValidClaim: false,
      verifiable: false,
      type: 'NOT_VERIFIABLE',
      claim: '',
      message: 'Give me a claim to verify.',
    };
  }

  if (!ai) {
    console.warn('[Intent] GEMINI_API_KEY missing; using safe fallback');
    return fallback(cleaned);
  }

  const prompt = `You are the intent and claim-understanding engine for VNews.

Your job is to understand what the user actually typed. Do NOT use keyword rules.

Classify the input into one of these:
- GREETING
- PERSONAL_QUESTION
- CASUAL_CONVERSATION
- WRITING_REQUEST
- GENERAL_QUESTION
- FACTUAL_CLAIM
- AMBIGUOUS
- NOT_VERIFIABLE

A factual claim is something whose truth can be checked against evidence from the web, fact-check databases, or a knowledge base.

Examples:
"hello" -> GREETING
"hi" -> GREETING
"what is my name?" -> PERSONAL_QUESTION
"how are you?" -> CASUAL_CONVERSATION
"write me a poem" -> WRITING_REQUEST
"what is photosynthesis?" -> GENERAL_QUESTION
"the Moon is larger than Earth" -> FACTUAL_CLAIM
"Chandrayaan-3 landed on Mars" -> FACTUAL_CLAIM
"Ravish Kumar joined AAP" -> FACTUAL_CLAIM

For FACTUAL_CLAIM:
- isValidClaim = true
- verifiable = true
- extract subject, event, location, temporalContext
- claimType should describe the claim category
- preserve names, dates, locations, and comparison targets
- do not invent facts

For non-verifiable inputs:
- isValidClaim = false
- verifiable = false
- give a short useful message
- do not send the input to evidence retrieval

Return ONLY JSON:

{
  "isValidClaim": boolean,
  "verifiable": boolean,
  "type": "string",
  "claim": "string",
  "subject": "string",
  "event": "string or null",
  "location": "string or null",
  "temporalContext": "string",
  "claimType": "string",
  "message": "string or null"
}

User input:
"${cleaned}"`;

  try {
    console.log(`[Intent] Using model: ${MODEL}`);

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const result = JSON.parse(response.text?.trim() || '{}');

    return {
      isValidClaim: Boolean(result.isValidClaim),
      verifiable: Boolean(result.verifiable),
      type: result.type || 'AMBIGUOUS',
      claim: result.claim || cleaned,
      subject: result.subject || undefined,
      event: result.event ?? null,
      location: result.location ?? null,
      temporalContext: result.temporalContext || 'unknown',
      message: result.message || undefined,
    };
  } catch (error) {
    console.error('[Intent] Gemma request failed:', error);
    return fallback(cleaned);
  }
}