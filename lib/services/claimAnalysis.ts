import { GoogleGenAI } from '@google/genai';
import { ClaimContext } from '../types';

export interface AnalyzedClaimContext extends ClaimContext {
  searchQueries?: string[];
  isVerifiableClaim?: boolean;
  claimType?: string;
}

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

const MODEL = 'gemma-4-31b-it';

export async function analyzeClaim(
  claim: string
): Promise<AnalyzedClaimContext> {
  if (!ai) {
    console.warn('[ClaimAnalysis] GEMINI_API_KEY missing');
    return {
      subject: claim,
      event: '',
      searchQueries: [claim],
      isVerifiableClaim: true,
    };
  }

  const prompt = `You are the claim-analysis and search-planning engine for VNews.

Understand the user's factual claim semantically. Do NOT use hard-coded keyword rules.

Claim:
"${claim}"

Extract the actual proposition and create search queries that would find evidence for or against it.

Important:
- Preserve exact entities and names.
- Understand comparisons.
  Example: "The Moon is larger than Earth" means the proposition is Moon > Earth in size, and BOTH Moon and Earth are essential entities.
- Understand historical claims.
  Example: "The 2024 Summer Olympics were held in Paris" means event=2024 Summer Olympics, location=Paris, time=2024.
- Understand negation.
  Example: "Chandrayaan-3 did not land on Mars" must preserve the negative proposition.
- Understand relationships, not just keywords.
- Search queries should be natural, concise, and evidence-oriented.
- Create 3 to 5 different queries.
- Include at least one query that searches for the claim itself.
- Include at least one query that searches for authoritative confirmation or contradiction.
- Do not invent facts.

Return ONLY JSON:

{
  "isVerifiableClaim": true,
  "subject": "main entity or entities",
  "event": "core event/action/relationship",
  "location": "location or null",
  "temporalContext": "date/year/time period or unknown",
  "claimType": "category",
  "searchQueries": [
    "query 1",
    "query 2",
    "query 3"
  ]
}`;

  try {
    console.log(`[ClaimAnalysis] Using model: ${MODEL}`);

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const result = JSON.parse(response.text?.trim() || '{}');

    const queries = Array.isArray(result.searchQueries)
      ? result.searchQueries
          .filter((q: unknown): q is string => typeof q === 'string')
          .map((q: string) => q.trim())
          .filter(Boolean)
          .slice(0, 5)
      : [];

    return {
      subject: result.subject || claim,
      event: result.event || '',
      location: result.location || undefined,
      temporalContext: result.temporalContext || undefined,
      claimType: result.claimType || undefined,
      searchQueries: queries.length ? queries : [claim],
      isVerifiableClaim: result.isVerifiableClaim !== false,
    };
  } catch (error) {
    console.error('[ClaimAnalysis] Gemma request failed:', error);

    return {
      subject: claim,
      event: '',
      searchQueries: [claim],
      isVerifiableClaim: true,
    };
  }
}