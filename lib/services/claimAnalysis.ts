import { GoogleGenAI } from '@google/genai';
import { ClaimContext } from '../types';

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    })
  : null;

export async function analyzeClaim(claim: string): Promise<ClaimContext> {
  if (!ai) {
    return {
      subject: claim,
      event: '',
    };
  }

  const prompt = `You are a claim analysis engine for a news verification platform.
Analyze the following claim and extract structured information.

Claim: "${claim}"

Extract:
- subject: The main person, organization, or entity the claim is about.
- event: The core action or event (e.g., "death", "resignation", "announcement", "arrest").
- location: The location if mentioned or strongly implied, otherwise omit.
- temporalContext: E.g., "current", "past", "future", or a specific date.
- claimType: A short category (e.g., "death", "politics", "conflict", "financial", "health").

Return ONLY a strict JSON object with these keys. No markdown wrapping.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const result = JSON.parse(response.text || '{}') as ClaimContext;
    return {
      subject: result.subject || claim,
      event: result.event || '',
      location: result.location,
      temporalContext: result.temporalContext,
      claimType: result.claimType,
    };
  } catch (error) {
    console.error('Claim analysis failed:', error);
    return {
      subject: claim,
      event: '',
    };
  }
}
