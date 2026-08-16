import { GoogleGenAI } from '@google/genai';
import { searchPinecone } from './pinecone';
import { checkGoogleFactCheckAPI } from './googleFactCheck';
import { searchWeb } from './webSearch';
import { analyzeClaim } from './claimAnalysis';
import {
  VerificationResult,
  Source,
  VerificationVerdict,
  ExternalFactCheck,
} from '../types';

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    })
  : null;

function generatePrompt(
  query: string,
  sources: Source[],
  factCheckResults: ExternalFactCheck[],
  isInitial: boolean = false
) {
  return `You are the core evidence-analysis engine for VNews Lab, an AI news verification platform.

Your job is to determine whether the user's CLAIM is supported, contradicted, mixed, or not sufficiently supported by the provided QUALIFIED evidence.

USER CLAIM:
"${query}"

QUALIFIED EVIDENCE:
${JSON.stringify(sources, null, 2)}

GOOGLE FACT CHECK RESULTS:
${JSON.stringify(factCheckResults, null, 2)}

IMPORTANT EVIDENCE RULES:

1. ONLY use the provided evidence. Do not rely on your own world knowledge.

2. A Google Fact Check result reviews a particular claim. Its rating applies to THAT reviewed claim.
   Do NOT automatically treat the rating as absolute proof of the user's broader claim.
   Example:
   User claim: "Person X is dead."
   Fact check: "A video falsely claims that Person X was killed."
   The fact check being FALSE means the video claim was false.
   It does NOT automatically prove that Person X is alive.

3. Consider publication and review dates when they are available.
   For time-sensitive claims, newer relevant evidence supersedes older evidence.

4. If evidence is weak, unrelated, contradictory, outdated, or insufficient to establish the claim, return:
   "INSUFFICIENT EVIDENCE"

5. Do NOT manufacture certainty.
   Only return TRUE or FALSE when the provided evidence actually establishes the claim or its contradiction.

6. MIXED should only be used when the provided evidence contains meaningful and relevant support for BOTH sides of the user's claim.

${isInitial
      ? `7. This is an INITIAL RAPID PASS.
The evidence may be incomplete. Treat the result as provisional and be conservative.`
      : `7. This is the FINAL ANALYSIS.
Use all relevant evidence provided, but ignore evidence that does not actually address the user's claim.`
    }

Return ONLY a strict JSON object using exactly this structure:

{
  "verdict": "TRUE" | "FALSE" | "MIXED" | "INSUFFICIENT EVIDENCE",
  "analysis": "concise journalistic explanation",
  "supportingEvidenceIds": ["id1", "id2"],
  "contradictingEvidenceIds": ["id3"]
}

Additional requirements:
- supportingEvidenceIds may ONLY contain IDs from QUALIFIED EVIDENCE.
- contradictingEvidenceIds may ONLY contain IDs from QUALIFIED EVIDENCE.
- Never invent evidence IDs.
- Do not put Google Fact Check IDs into those arrays.
- If no retrieved evidence is directly relevant, return empty arrays.
`;
}

function createInsufficientResult(
  verificationId: string,
  query: string,
  factCheckResults: ExternalFactCheck[],
  timestamp: number,
  analysis: string,
  status: string = 'SUCCESS',
  metadata: any = {}
): VerificationResult {
  return {
    id: verificationId,
    claim: query,
    verdict: 'INSUFFICIENT EVIDENCE',
    confidence: 0,
    analysis,
    supportingEvidence: [],
    contradictingEvidence: [],
    externalFactChecks: factCheckResults,
    isProvisional: true,
    timestamp,
    status,
    metadata
  };
}

function calculateSystemConfidence(
  supporting: Source[],
  contradicting: Source[],
  factChecks: ExternalFactCheck[]
): number {
  // Base calculation without relying on LLM self-confidence
  let confidence = 0;
  
  const strongSupporting = supporting.filter(s => s.relevance === 'DIRECT').length;
  const strongContradicting = contradicting.filter(s => s.relevance === 'DIRECT').length;

  // Simple heuristic
  if (strongSupporting > 0 && strongContradicting === 0) {
    confidence = Math.min(1.0, 0.70 + (strongSupporting * 0.10) + (factChecks.length * 0.05));
  } else if (strongContradicting > 0 && strongSupporting === 0) {
    confidence = Math.min(1.0, 0.70 + (strongContradicting * 0.10) + (factChecks.length * 0.05));
  } else if (strongSupporting > 0 && strongContradicting > 0) {
    // Mixed
    confidence = Math.min(0.9, 0.50 + ((strongSupporting + strongContradicting) * 0.05));
  } else if (supporting.length > 0 || contradicting.length > 0) {
    // Only related/topical evidence
    confidence = 0.3;
  }
  
  return confidence;
}

export async function runProgressiveVerification(
  query: string,
  emit: (event: string, data: any) => void
): Promise<void> {
  const startTime = Date.now();
  const timestamp = startTime;
  const verificationId = `vnl-${timestamp}`;

  emit('verification_started', { verificationId, query });

  emit('status', { message: 'Analyzing claim intent...' });
  const claimContext = await analyzeClaim(query);
  emit('claim_analysis_completed', claimContext);

  emit('status', { message: 'Retrieving evidence sources...' });

  const factCheckPromise = checkGoogleFactCheckAPI(query);
  const pineconePromise = searchPinecone(query, 8); // Deep search
  const webSearchPromise = searchWeb(claimContext);

  const retrievalStart = Date.now();

  // Fast Pass: Fact Checks
  const factCheckResults = await factCheckPromise;
  
  let initialResult: VerificationResult;
  if (factCheckResults.length > 0 && ai) {
    emit('status', { message: 'Analyzing initial fact checks...' });
    const prompt = generatePrompt(query, [], factCheckResults, true);
    
    try {
      const response = await ai.models.generateContent({
        model: 'gemma-4-31b-it',
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });
      const llmResult = JSON.parse(response.text || '{}');
      const verdict = llmResult.verdict || 'INSUFFICIENT EVIDENCE';

      initialResult = {
        id: verificationId,
        claim: query,
        verdict,
        confidence: factCheckResults.length > 0 ? 0.6 : 0,
        analysis: llmResult.analysis || 'Initial fact-check analysis.',
        supportingEvidence: [],
        contradictingEvidence: [],
        externalFactChecks: factCheckResults,
        isProvisional: true,
        timestamp,
        status: 'SUCCESS'
      };
    } catch (e) {
      initialResult = createInsufficientResult(verificationId, query, factCheckResults, timestamp, 'Initial analysis failed.');
    }
  } else {
    initialResult = createInsufficientResult(verificationId, query, factCheckResults, timestamp, 'Awaiting deep evidence retrieval.');
  }

  emit('initial_result', initialResult);

  // Deep Pass: Web and Knowledge Base
  emit('status', { message: 'Deep evidence retrieval in progress...' });
  
  const [pineconeRes, webRes] = await Promise.all([pineconePromise, webSearchPromise]);
  emit('news_search_completed', { 
    count: webRes.results.length, 
    status: webRes.status,
    durationMs: Date.now() - retrievalStart 
  });
  
  emit('knowledge_search_completed', { 
    count: pineconeRes.results.length, 
    status: pineconeRes.status,
    durationMs: Date.now() - retrievalStart 
  });

  const hasInfrastructureError = pineconeRes.status === 'ERROR' && webRes.status === 'ERROR';
  
  if (hasInfrastructureError) {
    emit('status', { message: 'System infrastructure error.' });
    emit('final_result', {
      ...initialResult,
      verdict: 'SYSTEM ERROR',
      confidence: 0,
      analysis: 'Verification infrastructure failed or is temporarily unavailable. Could not retrieve evidence securely.',
      isProvisional: false,
      status: 'ERROR'
    });
    return;
  }

  const sources: Source[] = pineconeRes.results.map((result) => ({
    id: result.id,
    title: result.metadata.title as string || 'Document Extract',
    snippet: result.text,
    url: result.metadata.url as string || undefined,
    publicationDate: result.metadata.date as string || undefined,
    retrievalScore: result.score,
    relevance: 'RELATED', // Base assumption for Pinecone matches above threshold
    metadata: { origin: 'knowledge-base', type: result.metadata.type }
  }));

  const webSources: Source[] = webRes.results.map((result, index) => ({
    id: `web-${index}`,
    title: result.title,
    snippet: result.snippet,
    url: result.url,
    publicationDate: result.publishedDate,
    relevance: result.relevance,
    metadata: { origin: 'live-news', source: result.source || '' },
  }));

  const retrievedSources: Source[] = [...sources, ...webSources];
  const qualifiedEvidence = retrievedSources.filter(s => s.relevance === 'DIRECT' || s.relevance === 'RELATED');

  emit('evidence_qualified', { qualifiedCount: qualifiedEvidence.length });

  if (qualifiedEvidence.length === 0) {
    emit('status', { message: 'No qualifying evidence found.' });
    
    // No evidence, but not an error.
    emit('final_result', {
      ...initialResult,
      verdict: 'INSUFFICIENT EVIDENCE',
      confidence: 0,
      analysis: 'No directly relevant or strongly related evidence was found to evaluate the claim definitively.',
      isProvisional: false,
      status: 'SUCCESS',
      metadata: { sourcesChecked: retrievedSources.length, sourcesQualified: 0, durationMs: Date.now() - startTime }
    });
    return;
  }

  emit('status', { message: 'Performing final deep analysis...' });

  if (ai) {
    try {
      const prompt = generatePrompt(query, qualifiedEvidence, factCheckResults, false);
      const response = await ai.models.generateContent({
        model: 'gemma-4-31b-it',
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });

      const llmResult = JSON.parse(response.text || '{}');
      const rawVerdict = llmResult.verdict || 'INSUFFICIENT EVIDENCE';
      
      const supportingIds = Array.isArray(llmResult.supportingEvidenceIds) ? llmResult.supportingEvidenceIds : [];
      const contradictingIds = Array.isArray(llmResult.contradictingEvidenceIds) ? llmResult.contradictingEvidenceIds : [];

      // Validate that every evidence ID returned by the AI actually exists in the retrieved evidence set.
      const retrievedSourceIds = new Set(retrievedSources.map((s) => s.id));
      const validSupportingIds = supportingIds.filter((id: string) => {
        const exists = retrievedSourceIds.has(id);
        if (!exists) {
          console.warn(`AI returned invalid supporting evidence ID: ${id}`);
        }
        return exists;
      });
      const validContradictingIds = contradictingIds.filter((id: string) => {
        const exists = retrievedSourceIds.has(id);
        if (!exists) {
          console.warn(`AI returned invalid contradicting evidence ID: ${id}`);
        }
        return exists;
      });

      const supportingEvidence = qualifiedEvidence.filter((source) => validSupportingIds.includes(source.id));
      const contradictingEvidence = qualifiedEvidence.filter((source) => validContradictingIds.includes(source.id));

      // Guardrail: Calculate normalizedVerdict based on evidence rules
      let normalizedVerdict: VerificationVerdict = 'INSUFFICIENT EVIDENCE';

      const hasSupport = supportingEvidence.length > 0;
      const hasContradict = contradictingEvidence.length > 0;

      if (rawVerdict === 'INSUFFICIENT EVIDENCE') {
        normalizedVerdict = 'INSUFFICIENT EVIDENCE';
        supportingEvidence.length = 0;
        contradictingEvidence.length = 0;
      } else if (hasSupport && hasContradict) {
        normalizedVerdict = 'MIXED';
      } else if (hasSupport) {
        normalizedVerdict = 'TRUE';
      } else if (hasContradict) {
        normalizedVerdict = 'FALSE';
      } else {
        normalizedVerdict = 'INSUFFICIENT EVIDENCE';
      }

      // Calculate confidence using system rules
      const finalConfidence = calculateSystemConfidence(supportingEvidence, contradictingEvidence, factCheckResults);

      const finalResult: VerificationResult = {
        id: verificationId,
        claim: query,
        verdict: normalizedVerdict,
        confidence: finalConfidence,
        analysis: llmResult.analysis || 'Comprehensive evidence analysis complete.',
        supportingEvidence,
        contradictingEvidence,
        externalFactChecks: factCheckResults,
        isProvisional: false,
        timestamp,
        status: 'SUCCESS',
        metadata: {
          sourcesChecked: retrievedSources.length,
          sourcesQualified: qualifiedEvidence.length,
          durationMs: Date.now() - startTime
        }
      };

      emit('analysis_completed', { verdict: normalizedVerdict, confidence: finalConfidence });
      emit('final_result', finalResult);
    } catch (error) {
      console.error('Final evaluation failed:', error);
      emit('final_result', {
        ...initialResult,
        verdict: 'SYSTEM ERROR',
        confidence: 0,
        analysis: 'Final evidence analysis failed due to an AI processing error.',
        isProvisional: false,
        status: 'ERROR'
      });
    }
  } else {
    emit('final_result', {
      ...initialResult,
      verdict: 'SYSTEM ERROR',
      confidence: 0,
      analysis: 'The AI analysis engine is unavailable.',
      isProvisional: false,
      status: 'ERROR'
    });
  }
}

export async function runVerification(query: string): Promise<VerificationResult> {
  let result: VerificationResult | null = null;
  await runProgressiveVerification(query, (event, data) => {
    if (event === 'final_result') {
      result = data;
    }
  });
  if (!result) {
    throw new Error('Failed to generate verification result');
  }
  return result;
}