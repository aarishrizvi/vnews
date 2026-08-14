import { GoogleGenAI } from '@google/genai';
import { generateEmbedding, searchPinecone } from './pinecone';
import { checkGoogleFactCheckAPI } from './googleFactCheck';
import { VerificationResult, Source, VerificationVerdict } from '../types';

const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

export async function runVerification(query: string): Promise<VerificationResult> {
  const timestamp = Date.now();
  
  // 1. Generate Embedding
  const embedding = await generateEmbedding(query);
  
  // 2. Parallel Data Gathering (Pinecone + Google Fact Check)
  const [pineconeResults, factCheckResults] = await Promise.all([
    searchPinecone(embedding, 5),
    checkGoogleFactCheckAPI(query)
  ]);

  // Transform Pinecone results into Source format
  const sources: Source[] = pineconeResults.map(r => ({
    id: r.id,
    title: (r.metadata.title as string) || 'Document Extract',
    snippet: r.text,
    url: r.metadata.url as string,
    publicationDate: r.metadata.date as string,
    retrievalScore: r.score
  }));

  // If no AI available (dev mode without key), return mock data
  if (!ai) {
    return {
      id: `vnl-${timestamp}`,
      claim: query,
      verdict: 'MIXED',
      confidence: 0.5,
      analysis: "This is a mock analysis because GEMINI_API_KEY is not set. Real analysis will be generated here.",
      supportingEvidence: sources.slice(0, 2),
      contradictingEvidence: sources.slice(2, 4),
      externalFactChecks: factCheckResults,
      timestamp
    };
  }

  // 3. LLM Analysis
  const prompt = `You are the core analysis engine for VNews Lab, an advanced AI news verification platform.
Your task is to analyze a user's claim against the provided evidence and determine its veracity.

User Claim: "${query}"

Local Knowledge Base Evidence:
${JSON.stringify(sources, null, 2)}

External Fact Checks (Google):
${JSON.stringify(factCheckResults, null, 2)}

Instructions:
1. Determine the verdict based ONLY on the provided evidence. Supported verdicts: TRUE, FALSE, MIXED, INSUFFICIENT EVIDENCE.
2. If there is not enough strong evidence, do NOT force TRUE or FALSE. Return INSUFFICIENT EVIDENCE.
3. Determine a confidence score between 0.0 and 1.0 representing how strongly the evidence supports the verdict.
4. Write a concise, journalistic analysis explaining how the verdict was reached.
5. Separate the local evidence IDs into 'supporting' and 'contradicting' arrays based on how they relate to the claim.

Return the result as a strict JSON object with this structure:
{
  "verdict": "TRUE" | "FALSE" | "MIXED" | "INSUFFICIENT EVIDENCE",
  "confidence": number,
  "analysis": "string",
  "supportingEvidenceIds": ["id1", "id2"],
  "contradictingEvidenceIds": ["id3"]
}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    const llmResult = JSON.parse(response.text || '{}');
    
    // Map IDs back to full Source objects
    const supportingEvidence = sources.filter(s => (llmResult.supportingEvidenceIds || []).includes(s.id));
    const contradictingEvidence = sources.filter(s => (llmResult.contradictingEvidenceIds || []).includes(s.id));

    return {
      id: `vnl-${timestamp}`,
      claim: query,
      verdict: llmResult.verdict as VerificationVerdict || 'INSUFFICIENT EVIDENCE',
      confidence: llmResult.confidence || 0,
      analysis: llmResult.analysis || "Analysis generation failed.",
      supportingEvidence,
      contradictingEvidence,
      externalFactChecks: factCheckResults,
      timestamp
    };
  } catch (error) {
    console.error("LLM verification generation failed:", error);
    throw new Error("Failed to generate verification result");
  }
}
