import { GoogleGenAI } from '@google/genai';

// We initialize the client if API key is present
const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export interface IntentCheckResult {
  isValidClaim: boolean;
  message?: string;
}

const PLAYFUL_REJECTIONS = [
  "Bro 😭 what are we verifying here?",
  "Gng... this doesn't need the RAG treatment.",
  "No Pinecone required for this one. Give me a news claim.",
  "This is VNews Lab, not ChatGPT. Hit me with a real headline.",
  "I'm an investigation lab, not a casual chat bot. What claim are we verifying?",
];

const AMBIGUOUS_RESPONSES = [
  "That's a bit vague. Can you give me the specific claim or headline?",
  "I need more to go on. What exactly did they announce?",
  "Which specific part of that should I verify?",
];

export async function checkQueryIntent(query: string): Promise<IntentCheckResult> {
  // Simple heuristic checks first to save API calls
  const lowerQuery = query.toLowerCase().trim();
  
  if (lowerQuery.startsWith("what is my name") || 
      lowerQuery.startsWith("who are you") ||
      lowerQuery.startsWith("tell me a joke") ||
      lowerQuery.startsWith("write me a poem")) {
    return {
      isValidClaim: false,
      message: PLAYFUL_REJECTIONS[Math.floor(Math.random() * PLAYFUL_REJECTIONS.length)]
    };
  }

  if (!ai) {
    // If no API key is provided during dev, let it pass to test the UI flow
    console.warn("No GEMINI_API_KEY found, skipping AI intent check.");
    return { isValidClaim: true };
  }

  try {
    const prompt = `You are the intent gatekeeper for VNews Lab, a strict AI news verification platform.
Your job is to determine if the user's input is a factual claim, news headline, or event that requires verification via RAG (retrieval-augmented generation).

User Input: "${query}"

Rules:
1. Return "VALID" if it is a specific claim, news headline, or event (e.g., "India has banned 500 notes", "Did the government announce free electricity?").
2. Return "AMBIGUOUS" if it references news but is too vague to verify (e.g., "Modi announced something yesterday", "Did something happen in London?").
3. Return "INVALID" if it is a general knowledge question (e.g., "What is the capital of India?"), casual chat ("How are you?"), or request for content generation ("Write a poem").

Return ONLY the single word: VALID, AMBIGUOUS, or INVALID.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const result = response.text?.trim().toUpperCase() || 'VALID';

    if (result === 'INVALID') {
      return {
        isValidClaim: false,
        message: PLAYFUL_REJECTIONS[Math.floor(Math.random() * PLAYFUL_REJECTIONS.length)]
      };
    } else if (result === 'AMBIGUOUS') {
      return {
        isValidClaim: false,
        message: AMBIGUOUS_RESPONSES[Math.floor(Math.random() * AMBIGUOUS_RESPONSES.length)]
      };
    }

    return { isValidClaim: true };
  } catch (error) {
    console.error("Error checking intent:", error);
    // Fail open if the LLM fails, to not block the user entirely
    return { isValidClaim: true };
  }
}
