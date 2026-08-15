import { GoogleGenAI } from '@google/genai';
import { searchPinecone } from './pinecone';
import { checkGoogleFactCheckAPI } from './googleFactCheck';
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

Your job is to determine whether the user's CLAIM is supported, contradicted, mixed, or not sufficiently supported by the provided evidence.

USER CLAIM:
"${query}"

LOCAL KNOWLEDGE BASE EVIDENCE:
${JSON.stringify(sources, null, 2)}

GOOGLE FACT CHECK RESULTS:
${JSON.stringify(factCheckResults, null, 2)}

IMPORTANT EVIDENCE RULES:

1. ONLY use the provided evidence. Do not rely on your own world knowledge.

2. Relevance is critical.
   A retrieved document or fact-check is NOT evidence merely because it contains similar words, people, countries, organizations, or entities.

3. Distinguish between:
   - an EXACT claim matching the user's claim,
   - a closely related claim,
   - and a merely topical or semantic match.

4. A Google Fact Check result reviews a particular claim. Its rating applies to THAT reviewed claim.
   Do NOT automatically treat the rating as proof of the user's broader claim.

   Example:

   User claim:
   "Person X is dead."

   Fact check:
   "A video falsely claims that Person X was killed."

   The fact check being FALSE means the video claim was false.
   It does NOT automatically prove that Person X is alive.

5. Likewise, a fact check saying that a video shows a person dismissing death rumors does not automatically prove the person's current status.

6. Consider publication and review dates when they are available.
   For time-sensitive claims, newer relevant evidence can supersede older evidence.
   Do not treat an old fact check as proof of the current state of the world.

7. Pinecone retrieval and reranking scores represent relevance, not truth.
   A high retrieval score does not automatically mean that a source supports the claim.

8. If evidence is weak, unrelated, contradictory, outdated, or insufficient to establish the claim, return:
   "INSUFFICIENT EVIDENCE"

9. Do NOT manufacture certainty.
   Only return TRUE or FALSE when the provided evidence actually establishes the claim or its contradiction.

10. MIXED should only be used when the provided evidence contains meaningful and relevant support for BOTH sides of the user's claim.

11. Confidence must represent the strength of the QUALIFIED evidence supporting the final verdict, not merely the number of retrieved results.

${isInitial
      ? `12. This is an INITIAL RAPID PASS.
The evidence may be incomplete. Treat the result as provisional and be conservative.`
      : `12. This is the FINAL ANALYSIS.
Use all relevant evidence provided, but ignore evidence that does not actually address the user's claim.`
    }

Return ONLY a strict JSON object using exactly this structure:

{
  "verdict": "TRUE" | "FALSE" | "MIXED" | "INSUFFICIENT EVIDENCE",
  "confidence": number,
  "analysis": "concise journalistic explanation",
  "supportingEvidenceIds": ["id1", "id2"],
  "contradictingEvidenceIds": ["id3"]
}

Additional requirements:

- confidence must be between 0.0 and 1.0.
- supportingEvidenceIds may ONLY contain IDs from LOCAL KNOWLEDGE BASE EVIDENCE.
- contradictingEvidenceIds may ONLY contain IDs from LOCAL KNOWLEDGE BASE EVIDENCE.
- Never invent evidence IDs.
- Do not put Google Fact Check IDs into those arrays because Google results do not have local evidence IDs.
- If no local evidence is relevant, return empty arrays.
`;
}

function createInsufficientResult(
  verificationId: string,
  query: string,
  factCheckResults: ExternalFactCheck[],
  timestamp: number,
  analysis: string
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
  };
}

export async function runProgressiveVerification(
  query: string,
  emit: (event: string, data: any) => void
): Promise<void> {
  const timestamp = Date.now();
  const verificationId = `vnl-${timestamp}`;

  emit('status', {
    message: 'Checking fast available evidence...',
  });

  /*
   * Start both retrieval paths in parallel.
   *
   * Google Fact Check:
   *     rapid external evidence
   *
   * Pinecone:
   *     deeper local knowledge-base retrieval
   *
   * IMPORTANT:
   * Pinecone now receives the CLAIM TEXT directly.
   * Pinecone's integrated embedding model handles
   * query embedding internally.
   */
  const factCheckPromise = checkGoogleFactCheckAPI(query);

  const pineconePromise = searchPinecone(query, 5);

  /*
   * ---------------------------------------------------------
   * FAST PASS
   * ---------------------------------------------------------
   */

  const factCheckResults = await factCheckPromise;

  let initialResult: VerificationResult;

  if (factCheckResults.length > 0 && ai) {
    emit('status', {
      message: 'Analyzing initial evidence...',
    });

    const prompt = generatePrompt(
      query,
      [],
      factCheckResults,
      true
    );

    try {
      const response = await ai.models.generateContent({
        model: 'gemma-4-31b-it',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const llmResult = JSON.parse(
        response.text || '{}'
      );

      const verdict: VerificationVerdict =
        llmResult.verdict === 'TRUE' ||
          llmResult.verdict === 'FALSE' ||
          llmResult.verdict === 'MIXED' ||
          llmResult.verdict === 'INSUFFICIENT EVIDENCE'
          ? llmResult.verdict
          : 'INSUFFICIENT EVIDENCE';

      const confidence =
        typeof llmResult.confidence === 'number'
          ? Math.min(
            Math.max(llmResult.confidence, 0),
            1
          )
          : 0;

      initialResult = {
        id: verificationId,
        claim: query,
        verdict,
        confidence,
        analysis:
          typeof llmResult.analysis === 'string'
            ? llmResult.analysis
            : 'Initial evidence analysis complete.',
        supportingEvidence: [],
        contradictingEvidence: [],
        externalFactChecks: factCheckResults,
        isProvisional: true,
        timestamp,
      };
    } catch (error) {
      console.error(
        'Initial evidence analysis failed:',
        error
      );

      initialResult = createInsufficientResult(
        verificationId,
        query,
        factCheckResults,
        timestamp,
        'Initial evidence analysis could not be completed. Awaiting deeper evidence retrieval.'
      );
    }
  } else {
    initialResult = createInsufficientResult(
      verificationId,
      query,
      factCheckResults,
      timestamp,
      factCheckResults.length > 0
        ? 'Related fact-check results were found, but they require deeper evidence analysis.'
        : 'No external fact-check evidence was found. Awaiting deeper knowledge-base retrieval.'
    );
  }

  /*
   * Emit the provisional result.
   */
  emit('initial_result', initialResult);

  /*
   * ---------------------------------------------------------
   * DEEP PASS
   * ---------------------------------------------------------
   */

  emit('status', {
    message: 'Enriching evidence from Knowledge Base...',
  });

  let pineconeResults;

  try {
    pineconeResults = await pineconePromise;
  } catch (error) {
    console.error(
      'Knowledge Base retrieval failed:',
      error
    );

    emit('status', {
      message:
        'Knowledge Base retrieval failed. Finalizing with available evidence...',
    });

    /*
     * Retrieval failure is NOT evidence.
     */
    emit('final_result', {
      ...initialResult,
      verdict: 'INSUFFICIENT EVIDENCE',
      confidence: 0,
      analysis:
        'The knowledge base could not be queried, so there is insufficient evidence to make a definitive determination.',
      supportingEvidence: [],
      contradictingEvidence: [],
      isProvisional: false,
    });

    return;
  }

  const sources: Source[] = pineconeResults.map(
    (result) => ({
      id: result.id,

      title:
        (result.metadata.title as string) ||
        'Document Extract',

      snippet: result.text,

      url:
        (result.metadata.url as string) ||
        undefined,

      publicationDate:
        (result.metadata.date as string) ||
        undefined,

      retrievalScore: result.score,
    })
  );

  /*
   * ---------------------------------------------------------
   * NO QUALIFYING LOCAL EVIDENCE
   * ---------------------------------------------------------
   */

  if (sources.length === 0) {
    emit('status', {
      message:
        'No sufficiently relevant Knowledge Base evidence found. Performing final evidence assessment...',
    });

    if (!ai) {
      emit('final_result', {
        ...initialResult,
        verdict: 'INSUFFICIENT EVIDENCE',
        confidence: 0,
        analysis:
          'No sufficiently relevant local evidence was retrieved, so the available evidence is insufficient for a definitive verdict.',
        supportingEvidence: [],
        contradictingEvidence: [],
        isProvisional: false,
      });

      return;
    }

    try {
      const finalPrompt = generatePrompt(
        query,
        [],
        factCheckResults,
        false
      );

      const response =
        await ai.models.generateContent({
          model: 'gemma-4-31b-it',
          contents: finalPrompt,
          config: {
            responseMimeType: 'application/json',
          },
        });

      const llmResult = JSON.parse(
        response.text || '{}'
      );

      const verdict: VerificationVerdict =
        llmResult.verdict === 'TRUE' ||
          llmResult.verdict === 'FALSE' ||
          llmResult.verdict === 'MIXED' ||
          llmResult.verdict === 'INSUFFICIENT EVIDENCE'
          ? llmResult.verdict
          : 'INSUFFICIENT EVIDENCE';

      const confidence =
        typeof llmResult.confidence === 'number'
          ? Math.min(
            Math.max(llmResult.confidence, 0),
            1
          )
          : 0;

      /*
       * There is no qualifying local evidence.
       *
       * Therefore local supporting/contradicting arrays
       * MUST remain empty.
       */
      const finalResult: VerificationResult = {
        id: verificationId,
        claim: query,
        verdict,
        confidence,
        analysis:
          typeof llmResult.analysis === 'string'
            ? llmResult.analysis
            : 'Final evidence assessment complete.',
        supportingEvidence: [],
        contradictingEvidence: [],
        externalFactChecks: factCheckResults,
        isProvisional: false,
        timestamp,
      };

      emit('final_result', finalResult);
    } catch (error) {
      console.error(
        'Final assessment without local evidence failed:',
        error
      );

      emit('final_result', {
        ...initialResult,
        verdict: 'INSUFFICIENT EVIDENCE',
        confidence: 0,
        analysis:
          'The available evidence could not be reliably analyzed. No sufficiently relevant local evidence was retrieved.',
        supportingEvidence: [],
        contradictingEvidence: [],
        isProvisional: false,
      });
    }

    return;
  }

  /*
   * ---------------------------------------------------------
   * FINAL DEEP ANALYSIS
   * ---------------------------------------------------------
   */

  emit('status', {
    message:
      'Re-evaluating with qualified Knowledge Base evidence...',
  });

  if (ai) {
    try {
      const prompt = generatePrompt(
        query,
        sources,
        factCheckResults,
        false
      );

      const response =
        await ai.models.generateContent({
          model: 'gemma-4-31b-it',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
          },
        });

      const llmResult = JSON.parse(
        response.text || '{}'
      );

      const verdict: VerificationVerdict =
        llmResult.verdict === 'TRUE' ||
          llmResult.verdict === 'FALSE' ||
          llmResult.verdict === 'MIXED' ||
          llmResult.verdict === 'INSUFFICIENT EVIDENCE'
          ? llmResult.verdict
          : 'INSUFFICIENT EVIDENCE';

      const confidence =
        typeof llmResult.confidence === 'number'
          ? Math.min(
            Math.max(llmResult.confidence, 0),
            1
          )
          : 0;

      const supportingIds =
        Array.isArray(
          llmResult.supportingEvidenceIds
        )
          ? llmResult.supportingEvidenceIds
          : [];

      const contradictingIds =
        Array.isArray(
          llmResult.contradictingEvidenceIds
        )
          ? llmResult.contradictingEvidenceIds
          : [];

      /*
       * Only allow IDs that actually exist in the
       * retrieved source set.
       */
      const supportingEvidence =
        sources.filter((source) =>
          supportingIds.includes(source.id)
        );

      const contradictingEvidence =
        sources.filter((source) =>
          contradictingIds.includes(source.id)
        );

      const finalResult: VerificationResult = {
        id: verificationId,
        claim: query,
        verdict,
        confidence,
        analysis:
          typeof llmResult.analysis === 'string'
            ? llmResult.analysis
            : 'Comprehensive evidence analysis complete.',
        supportingEvidence,
        contradictingEvidence,
        externalFactChecks: factCheckResults,
        isProvisional: false,
        timestamp,
      };

      emit('final_result', finalResult);
    } catch (error) {
      console.error(
        'Final evaluation failed:',
        error
      );

      /*
       * Never pretend the provisional result is definitive.
       */
      emit('final_result', {
        ...initialResult,
        verdict: 'INSUFFICIENT EVIDENCE',
        confidence: 0,
        analysis:
          'Final evidence analysis failed, so a definitive verdict cannot be established.',
        supportingEvidence: [],
        contradictingEvidence: [],
        isProvisional: false,
      });
    }
  } else {
    /*
     * No Gemini API key means we cannot perform actual
     * evidence reasoning.
     *
     * Never create a fake verdict.
     */
    emit('final_result', {
      ...initialResult,
      verdict: 'INSUFFICIENT EVIDENCE',
      confidence: 0,
      analysis:
        'The AI analysis engine is unavailable, so the available evidence cannot be reliably evaluated.',
      supportingEvidence: [],
      contradictingEvidence: [],
      isProvisional: false,
    });
  }
}

/*
 * Backward-compatible synchronous-style wrapper.
 */
export async function runVerification(
  query: string
): Promise<VerificationResult> {
  let result: VerificationResult | null = null;

  await runProgressiveVerification(
    query,
    (event, data) => {
      if (event === 'final_result') {
        result = data;
      }
    }
  );

  if (!result) {
    throw new Error(
      'Failed to generate verification result'
    );
  }

  return result;
}