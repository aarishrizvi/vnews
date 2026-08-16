import { GoogleGenAI } from '@google/genai';
import { searchPinecone } from './pinecone';
import { checkGoogleFactCheckAPI } from './googleFactCheck';
import { searchWeb } from './webSearch';
import { analyzeClaim } from './claimAnalysis';
import { checkQueryIntent } from './intent';
import {
  VerificationResult,
  Source,
  VerificationVerdict,
  ExternalFactCheck,
  ClaimContext,
} from '../types';

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

type EvidencePolarity = 'SUPPORTS' | 'CONTRADICTS' | 'CONTEXT' | 'UNKNOWN';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'of', 'for', 'to', 'in', 'on', 'at', 'by', 'and', 'or', 'with',
  'from', 'that', 'this', 'these', 'those', 'has', 'have', 'had',
  'does', 'did', 'do', 'will', 'would', 'could', 'should', 'can',
  'may', 'might', 'claim', 'claims', 'according', 'said', 'says',
]);

const TRUST: Record<string, number> = {
  HIGH: 1,
  MEDIUM: 0.8,
  LOW: 0.5,
  UNKNOWN: 0.35,
};

const EXCLUSIVE_PAIRS: Array<[RegExp, RegExp]> = [
  [/\bmoon\b/i, /\bmars\b/i],
  [/\bmars\b/i, /\bmoon\b/i],
  [/\balive\b/i, /\bdead\b/i],
  [/\bdead\b/i, /\balive\b/i],
  [/\bauthentic\b/i, /\bfake\b/i],
  [/\bgenuine\b/i, /\bfake\b/i],
  [/\bauthentic\b/i, /\bai[- ]generated\b/i],
  [/\bgenuine\b/i, /\bai[- ]generated\b/i],
  [/\bauthentic\b/i, /\bdigitally altered\b/i],
  [/\bgenuine\b/i, /\bdigitally altered\b/i],
  [/\bwon\b/i, /\blost\b/i],
  [/\blost\b/i, /\bwon\b/i],
];

const NEGATIVE_SOURCE_PATTERNS = [
  /\bfalse\b/i,
  /\bfake\b/i,
  /\bfabricated\b/i,
  /\bdebunk(?:ed|s)?\b/i,
  /\bmisleading\b/i,
  /\bincorrect\b/i,
  /\bnot true\b/i,
  /\bno evidence\b/i,
  /\bdoes not show\b/i,
  /\bdid not\b/i,
  /\bnever happened\b/i,
  /\bai[- ]generated\b/i,
  /\bdigitally altered\b/i,
  /\bmanipulated\b/i,
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(/\s+/)
      .map((token) => token.replace(/^-+|-+$/g, ''))
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
  );
}

function similarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection++;
  }

  return intersection / Math.max(left.size, right.size);
}

function hasExclusiveConflict(claim: string, evidence: string): boolean {
  return EXCLUSIVE_PAIRS.some(([a, b]) => a.test(claim) && b.test(evidence));
}

function domainOf(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function sourceKey(source: Source): string {
  const origin = String(source.metadata?.origin || '').toLowerCase();

  if (origin === 'knowledge-base') {
    return `kb:${String(source.metadata?.documentId || source.id)}`;
  }

  return (
    domainOf(source.url) ||
    String(
      source.metadata?.source ||
      source.metadata?.publisher ||
      source.title ||
      source.id
    )
      .trim()
      .toLowerCase()
  );
}

function independentCount(sources: Source[]): number {
  return new Set(sources.map(sourceKey).filter(Boolean)).size;
}

function factCheckSourceId(index: number, factCheck: ExternalFactCheck): string {
  const base = `${factCheck.publisher}|${factCheck.claim}|${factCheck.url}|${index}`;
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = (hash * 31 + base.charCodeAt(i)) | 0;
  }
  return `factcheck-${Math.abs(hash)}`;
}

function factCheckRelevance(
  query: string,
  factCheck: ExternalFactCheck
): 'DIRECT' | 'RELATED' | 'TOPICAL' {
  const reviewed = `${factCheck.claim} ${factCheck.title}`;
  const score = similarity(query, reviewed);

  if (score >= 0.28 || hasExclusiveConflict(query, reviewed)) {
    return 'DIRECT';
  }

  if (score >= 0.10) return 'RELATED';
  return 'TOPICAL';
}

function factCheckPolarity(
  query: string,
  factCheck: ExternalFactCheck
): EvidencePolarity {
  const reviewed = `${factCheck.claim} ${factCheck.title}`;
  const rating = normalize(factCheck.rating);

  const sameClaim =
    similarity(query, reviewed) >= 0.45 ||
    hasExclusiveConflict(query, reviewed);

  if (!sameClaim) return 'CONTEXT';

  const positive =
    /\b(true|correct|accurate|verified|confirmed|mostly true)\b/i.test(
      factCheck.rating
    );

  const negative =
    /\b(false|fake|misleading|incorrect|debunked|mostly false|pants on fire)\b/i.test(
      factCheck.rating
    );

  if (!positive && !negative) return 'UNKNOWN';

  /*
   * A fact-check rating describes the REVIEWED claim.
   *
   * If the reviewed claim itself contains a negation/conflict relative to
   * the user's proposition, invert the review rating.
   */
  const polarityConflict =
    hasExclusiveConflict(query, reviewed) ||
    /\bnot\b|\bnever\b|\bfalse\b|\bfake\b|\bmisleading\b/i.test(
      reviewed
    );

  if (positive) {
    return polarityConflict ? 'CONTRADICTS' : 'SUPPORTS';
  }

  if (negative) {
    return polarityConflict ? 'SUPPORTS' : 'CONTRADICTS';
  }

  void rating;
  return 'UNKNOWN';
}

function convertFactChecksToSources(
  query: string,
  factChecks: ExternalFactCheck[]
): Source[] {
  return factChecks
    .map((factCheck, index) => ({
      id: factCheckSourceId(index, factCheck),
      title: factCheck.title,
      snippet:
        `Reviewed claim: ${factCheck.claim}\n` +
        `Publisher: ${factCheck.publisher}\n` +
        `Rating: ${factCheck.rating}`,
      url: factCheck.url,
      publicationDate: factCheck.reviewDate,
      relevance: factCheckRelevance(query, factCheck),
      sourceQuality: 'HIGH' as const,
      metadata: {
        origin: 'fact-check',
        publisher: factCheck.publisher,
        rating: factCheck.rating,
        reviewedClaim: factCheck.claim,
        polarity: factCheckPolarity(query, factCheck),
        externalFactCheckIndex: index,
      },
    }))
    .filter((source) => source.relevance !== 'TOPICAL');
}

function evidenceScore(source: Source): number {
  const trust = TRUST[source.sourceQuality || 'UNKNOWN'] ?? 0.35;
  const relevance =
    source.relevance === 'DIRECT'
      ? 1
      : source.relevance === 'RELATED'
        ? 0.55
        : 0.2;

  const retrieval =
    typeof source.retrievalScore === 'number'
      ? Math.max(0.25, Math.min(1, source.retrievalScore))
      : 1;

  return trust * relevance * retrieval;
}

function sourceLooksContradictory(source: Source, query: string): boolean {
  const text = `${source.title || ''} ${source.snippet || ''}`;

  if (source.metadata?.origin === 'fact-check') {
    const polarity = source.metadata?.polarity as EvidencePolarity | undefined;
    return polarity === 'CONTRADICTS';
  }

  if (hasExclusiveConflict(query, text)) return true;

  return NEGATIVE_SOURCE_PATTERNS.some((pattern) => pattern.test(text));
}

function sourceLooksSupportive(source: Source, query: string): boolean {
  if (source.metadata?.origin === 'fact-check') {
    const polarity = source.metadata?.polarity as EvidencePolarity | undefined;
    return polarity === 'SUPPORTS';
  }

  if (sourceLooksContradictory(source, query)) return false;

  return source.relevance === 'DIRECT';
}

function buildDeterministicFallback(
  query: string,
  sources: Source[],
): {
  verdict: VerificationVerdict;
  supporting: Source[];
  contradicting: Source[];
  confidence: number;
  independentSources: number;
  analysis: string;
} {
  const usable = sources.filter(
    (source) => source.relevance !== 'TOPICAL' && source.relevance !== 'IRRELEVANT'
  );

  const supporting = usable
    .filter((source) => sourceLooksSupportive(source, query))
    .map((source) => ({ ...source, relevance: 'DIRECT' as const }));

  const contradicting = usable
    .filter((source) => sourceLooksContradictory(source, query))
    .map((source) => ({ ...source, relevance: 'DIRECT' as const }));

  const supportIndependent = independentCount(supporting);
  const contradictionIndependent = independentCount(contradicting);

  if (
    supporting.length > 0 &&
    contradicting.length > 0 &&
    supportIndependent >= 2 &&
    contradictionIndependent >= 2
  ) {
    return {
      verdict: 'MIXED',
      supporting: supporting.slice(0, 8),
      contradicting: contradicting.slice(0, 8),
      confidence: 0.80,
      independentSources: supportIndependent + contradictionIndependent,
      analysis: 'Independent evidence exists on both sides of the claim.',
    };
  }

  if (contradictionIndependent >= 3 && supportIndependent === 0) {
    return {
      verdict: 'FALSE',
      supporting: [],
      contradicting: contradicting.slice(0, 8),
      confidence: 0.80,
      independentSources: contradictionIndependent,
      analysis:
        'Three or more independent evidence sources contradict the claim.',
    };
  }

  if (supportIndependent >= 3 && contradictionIndependent === 0) {
    return {
      verdict: 'TRUE',
      supporting: supporting.slice(0, 8),
      contradicting: [],
      confidence: 0.80,
      independentSources: supportIndependent,
      analysis:
        'Three or more independent evidence sources support the claim.',
    };
  }

  /*
   * A single first-class fact-check can be enough if it directly reviews
   * the same claim. We only use this when the fact-check itself has already
   * been polarity-classified.
   */
  const directFactChecks = usable.filter(
    (source) =>
      source.metadata?.origin === 'fact-check' &&
      source.metadata?.polarity === 'SUPPORTS'
  );

  const directFactContradictions = usable.filter(
    (source) =>
      source.metadata?.origin === 'fact-check' &&
      source.metadata?.polarity === 'CONTRADICTS'
  );

  const factSupportPublishers = independentCount(directFactChecks);
  const factContradictionPublishers = independentCount(
    directFactContradictions
  );

  if (
    factContradictionPublishers >= 2 &&
    factSupportPublishers === 0
  ) {
    return {
      verdict: 'FALSE',
      supporting: [],
      contradicting: directFactContradictions.slice(0, 8),
      confidence: 0.80,
      independentSources: factContradictionPublishers,
      analysis:
        'Multiple independent external fact-check publishers contradict the claim.',
    };
  }

  if (
    factSupportPublishers >= 2 &&
    factContradictionPublishers === 0
  ) {
    return {
      verdict: 'TRUE',
      supporting: directFactChecks.slice(0, 8),
      contradicting: [],
      confidence: 0.80,
      independentSources: factSupportPublishers,
      analysis:
        'Multiple independent external fact-check publishers support the claim.',
    };
  }

  return {
    verdict: 'UNVERIFIED',
    supporting: [],
    contradicting: [],
    confidence: 0,
    independentSources: Math.max(
      supportIndependent,
      contradictionIndependent,
      factSupportPublishers,
      factContradictionPublishers
    ),
    analysis:
      'No reliable factual verdict could be established. UNVERIFIED is a reminder, not a factual verdict.',
  };
}

function promptForEvidence(query: string, sources: Source[]): string {
  return `You are the final evidence judge for VNews Lab.

USER CLAIM:
"${query}"

EVIDENCE:
${JSON.stringify(sources, null, 2)}

Rules:
1. Use only the supplied evidence.
2. Retrieval similarity is not proof.
3. Read the actual title/snippet/metadata.
4. Google Fact Check entries are FIRST-CLASS evidence. They may be selected by ID.
5. A fact-check rating applies to the reviewed claim. Do not blindly equate a rating of "False" with the user's claim being false.
6. Determine whether each selected source SUPPORTS, CONTRADICTS, or only provides CONTEXT.
7. Only directly relevant evidence may be selected.
8. Three or more independent credible sources agreeing on the same factual proposition is strong evidence.
9. Sources from the same publisher/domain/document do not count as independent sources.
10. If evidence exists on both sides, use MIXED.
11. If there is not enough reliable evidence, use UNVERIFIED. This is a reminder/status, not a factual verdict.
12. Never invent an evidence ID.

Return ONLY JSON:
{
  "verdict": "TRUE" | "FALSE" | "MIXED" | "UNVERIFIED",
  "analysis": "concise explanation",
  "supportingEvidenceIds": ["id"],
  "contradictingEvidenceIds": ["id"]
}`;
}

function normalizeAiVerdict(
  raw: string,
  supporting: Source[],
  contradicting: Source[]
): VerificationVerdict {
  const verdict = String(raw || '').toUpperCase();

  if (verdict === 'TRUE' && supporting.length > 0 && contradicting.length === 0) {
    return 'TRUE';
  }

  if (
    verdict === 'FALSE' &&
    contradicting.length > 0 &&
    supporting.length === 0
  ) {
    return 'FALSE';
  }

  if (
    verdict === 'MIXED' &&
    supporting.length > 0 &&
    contradicting.length > 0
  ) {
    return 'MIXED';
  }

  return 'UNVERIFIED';
}

function createResult(
  verificationId: string,
  query: string,
  factChecks: ExternalFactCheck[],
  timestamp: number,
  patch: Partial<VerificationResult>
): VerificationResult {
  return {
    id: verificationId,
    claim: query,
    verdict: 'UNVERIFIED',
    confidence: 0,
    analysis: 'No reliable factual verdict could be established.',
    supportingEvidence: [],
    contradictingEvidence: [],
    externalFactChecks: factChecks,
    isProvisional: false,
    timestamp,
    status: 'SUCCESS',
    ...patch,
  };
}

export async function runProgressiveVerification(
  query: string,
  emit: (event: string, data: unknown) => void
): Promise<void> {
  const startedAt = Date.now();
  const verificationId = `vnl-${startedAt}`;

  emit('verification_started', { verificationId, query });

  const intent = await checkQueryIntent(query);

  if (!intent.isValidClaim) {
    emit(
      'final_result',
      createResult(
        verificationId,
        query,
        [],
        startedAt,
        {
          verdict: 'UNVERIFIED',
          confidence: 0,
          analysis:
            'This is not a verifiable factual claim. No factual verdict was issued.',
          metadata: {
            sourcesChecked: 0,
            sourcesQualified: 0,
            independentSources: 0,
            durationMs: Date.now() - startedAt,
          },
        }
      )
    );
    return;
  }

  emit('status', { message: 'Preparing evidence retrieval...' });

  let claimContext: ClaimContext;

  try {
    claimContext = await analyzeClaim(query);
  } catch {
    claimContext = {
      subject: query,
      event: query,
      claimType: 'factual',
    };
  }

  emit('claim_analysis_completed', claimContext);
  emit('status', { message: 'Retrieving evidence sources...' });

  /*
   * All retrieval systems run independently.
   * Gemini claim analysis is optional.
   */
  const [factChecks, pineconeRes, webRes] = await Promise.all([
    checkGoogleFactCheckAPI(query),
    searchPinecone(query, 8),
    searchWeb(claimContext),
  ]);

  const pineconeSources: Source[] = pineconeRes.results
    .filter((result) => {
      const score = typeof result.score === 'number' ? result.score : 0;
      // Ignore garbage KB matches, but never require Pinecone.
      return score >= 0.05;
    })
    .map((result) => ({
      id: result.id,
      title: String(result.metadata?.title || 'Knowledge Base Document'),
      snippet: result.text,
      url: result.metadata?.url
        ? String(result.metadata.url)
        : undefined,
      publicationDate: result.metadata?.date
        ? String(result.metadata.date)
        : undefined,
      retrievalScore: result.score,
      relevance: undefined,
      sourceQuality: 'HIGH' as const,
      metadata: {
        origin: 'knowledge-base',
        documentId: result.documentId,
        source: result.metadata?.source,
        type: result.metadata?.type,
      },
    }));

  const webSources: Source[] = webRes.results.map((result, index) => ({
    id: `web-${index}-${Math.abs(
      [...String(result.url || result.title)]
        .reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 0)
    )}`,
    title: result.title,
    snippet: result.snippet,
    url: result.url,
    publicationDate: result.publishedDate,
    relevance: result.relevance,
    sourceQuality: 'HIGH',
    metadata: {
      origin: 'live-news',
      source: result.source || '',
    },
  }));

  /*
   * THIS IS THE FIX:
   *
   * Fact checks are converted into the SAME Source[] pool as Pinecone
   * and NewsAPI. They are no longer a side-channel that Gemini can read
   * but the verdict engine cannot select.
   */
  const factCheckSources = convertFactChecksToSources(
    query,
    factChecks
  );

  const allSources = [
    ...pineconeSources,
    ...webSources,
    ...factCheckSources,
  ];

  const candidateEvidence = allSources.filter(
    (source) => source.relevance !== 'TOPICAL' && source.relevance !== 'IRRELEVANT'
  );

  console.log('[Verification] Unified evidence summary:', {
    pinecone: pineconeSources.length,
    news: webSources.length,
    externalFactChecks: factCheckSources.length,
    candidates: candidateEvidence.length,
    factCheckPublishers: new Set(
      factCheckSources.map((source) => source.metadata?.publisher)
    ).size,
  });

  candidateEvidence.slice(0, 20).forEach((source) => {
    console.log(
      `[Verification] Evidence id=${source.id} origin=${source.metadata?.origin} relevance=${source.relevance} title="${source.title}"`
    );
  });

  emit('news_search_completed', {
    count: webSources.length,
    status: webRes.status,
  });

  emit('knowledge_search_completed', {
    count: pineconeSources.length,
    status: pineconeRes.status,
  });

  emit('evidence_qualified', {
    qualifiedCount: candidateEvidence.length,
    candidateCount: allSources.length,
    externalFactChecks: factCheckSources.length,
  });

  /*
   * First deterministic pass.
   *
   * This means the system can still produce a verdict when Gemini is at
   * its free-tier quota.
   */
  const deterministic = buildDeterministicFallback(
    query,
    candidateEvidence
  );

  /*
   * If there is no AI available, deterministic evidence is the final answer.
   */
  if (!ai) {
    emit(
      'final_result',
      createResult(
        verificationId,
        query,
        factChecks,
        startedAt,
        {
          verdict: deterministic.verdict,
          confidence: deterministic.confidence,
          analysis: deterministic.analysis,
          supportingEvidence: deterministic.supporting,
          contradictingEvidence: deterministic.contradicting,
          metadata: {
            sourcesChecked: allSources.length,
            sourcesQualified: candidateEvidence.length,
            independentSources: deterministic.independentSources,
            durationMs: Date.now() - startedAt,
          },
        }
      )
    );
    return;
  }

  emit('status', { message: 'Analyzing unified evidence...' });

  try {
    const response = await Promise.race([
      ai.models.generateContent({
        model: 'gemma-4-31b-it',
        contents: promptForEvidence(query, candidateEvidence),
        config: { responseMimeType: 'application/json' },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('AI_ANALYSIS_TIMEOUT')), 90000)
      ),
    ]);

    const raw = JSON.parse(
      (response as { text?: string }).text || '{}'
    ) as {
      verdict?: string;
      analysis?: string;
      supportingEvidenceIds?: unknown;
      contradictingEvidenceIds?: unknown;
    };

    const ids = new Set(candidateEvidence.map((source) => source.id));

    const supportIds = Array.isArray(raw.supportingEvidenceIds)
      ? raw.supportingEvidenceIds.filter(
        (id): id is string => typeof id === 'string' && ids.has(id)
      )
      : [];

    const contradictionIds = Array.isArray(raw.contradictingEvidenceIds)
      ? raw.contradictingEvidenceIds.filter(
        (id): id is string => typeof id === 'string' && ids.has(id)
      )
      : [];

    const contradictionSet = new Set(contradictionIds);
    const supportSet = new Set(supportIds);

    const supportingEvidence = candidateEvidence
      .filter(
        (source) =>
          supportSet.has(source.id) && !contradictionSet.has(source.id)
      )
      .map((source) => ({
        ...source,
        relevance: 'DIRECT' as const,
      }));

    const contradictingEvidence = candidateEvidence
      .filter(
        (source) =>
          contradictionSet.has(source.id) && !supportSet.has(source.id)
      )
      .map((source) => ({
        ...source,
        relevance: 'DIRECT' as const,
      }));

    let verdict = normalizeAiVerdict(
      raw.verdict || 'UNVERIFIED',
      supportingEvidence,
      contradictingEvidence
    );

    let finalSupporting: Source[] = supportingEvidence;
    let finalContradicting: Source[] = contradictingEvidence;
    let confidence = 0;
    let independentSources = Math.max(
      independentCount(finalSupporting),
      independentCount(finalContradicting)
    );

    /*
     * If Gemma is conservative or fails to select enough evidence, use
     * deterministic corroboration. This is especially important when the
     * free Gemini quota is exhausted or the model misses a Fact Check ID.
     */
    if (verdict === 'UNVERIFIED') {
      if (deterministic.verdict !== 'UNVERIFIED') {
        verdict = deterministic.verdict;
        finalSupporting = deterministic.supporting;
        finalContradicting = deterministic.contradicting;
        confidence = deterministic.confidence;
        independentSources = deterministic.independentSources;
      }
    }

    if (verdict !== 'UNVERIFIED' && confidence === 0) {
      independentSources = Math.max(
        independentCount(finalSupporting),
        independentCount(finalContradicting)
      );

      confidence =
        independentSources >= 3
          ? 0.80
          : Math.min(
            0.95,
            0.68 +
            Math.min(
              0.20,
              (finalSupporting.length + finalContradicting.length) * 0.05
            )
          );
    }

    if (verdict === 'UNVERIFIED') {
      confidence = 0;
    }

    const result = createResult(
      verificationId,
      query,
      factChecks,
      startedAt,
      {
        verdict,
        confidence,
        analysis:
          raw.analysis ||
          (verdict === 'UNVERIFIED'
            ? 'No reliable factual verdict could be established. UNVERIFIED is a reminder, not a factual verdict.'
            : deterministic.analysis),
        supportingEvidence: finalSupporting,
        contradictingEvidence: finalContradicting,
        metadata: {
          sourcesChecked: allSources.length,
          sourcesQualified: candidateEvidence.length,
          independentSources,
          durationMs: Date.now() - startedAt,
        },
      }
    );

    emit('analysis_completed', {
      verdict,
      confidence,
      externalEvidenceUsed: finalSupporting.some(
        (source) => source.metadata?.origin === 'fact-check'
      ) ||
        finalContradicting.some(
          (source) => source.metadata?.origin === 'fact-check'
        ),
    });

    emit('final_result', result);
  } catch (error) {
    console.warn(
      '[Verification] Final AI unavailable. Using deterministic unified evidence:',
      error
    );

    emit(
      'final_result',
      createResult(
        verificationId,
        query,
        factChecks,
        startedAt,
        {
          verdict: deterministic.verdict,
          confidence: deterministic.confidence,
          analysis: deterministic.analysis,
          supportingEvidence: deterministic.supporting,
          contradictingEvidence: deterministic.contradicting,
          metadata: {
            sourcesChecked: allSources.length,
            sourcesQualified: candidateEvidence.length,
            independentSources: deterministic.independentSources,
            durationMs: Date.now() - startedAt,
          },
        }
      )
    );
  }
}

export async function runVerification(
  query: string
): Promise<VerificationResult> {
  let result: VerificationResult | null = null;

  await runProgressiveVerification(query, (event, data) => {
    if (event === 'final_result') {
      result = data as VerificationResult;
    }
  });

  if (!result) {
    throw new Error('Failed to generate verification result');
  }

  return result;
}