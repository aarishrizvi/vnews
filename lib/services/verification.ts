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
} from '../types';

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    })
  : null;

const KNOWLEDGE_TRUST = {
  'VERY HIGH': 1.0,
  HIGH: 0.9,
  MEDIUM: 0.7,
  LOW: 0.35,
  UNKNOWN: 0.2,
};

const RELEVANCE_WEIGHT = {
  DIRECT: 1.0,
  RELATED: 0.72,
  TOPICAL: 0.25,
  IRRELEVANT: 0.05,
};

const TOKEN_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'of',
  'for',
  'to',
  'in',
  'on',
  'at',
  'and',
  'or',
  'this',
  'that',
]);

function normalizeDate(value?: string): number {
  if (!value) return 1;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 1;

  const now = Date.now();
  const daysAgo = Math.max(1, (now - date.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0.1, 1 / Math.sqrt(Math.max(daysAgo / 365, 1)));
}

function buildEvidenceScore(source: Source): number {
  const trust = KNOWLEDGE_TRUST[(source.sourceQuality || 'UNKNOWN') as keyof typeof KNOWLEDGE_TRUST] ?? 0.2;
  const relevance = RELEVANCE_WEIGHT[(source.relevance || 'IRRELEVANT') as keyof typeof RELEVANCE_WEIGHT] ?? 0.05;
  const directness =
    source.relevance === 'DIRECT'
      ? 1
      : source.relevance === 'RELATED'
        ? 0.55
        : 0.35;
  const temporal = normalizeDate(source.publicationDate);
  const corroboration = typeof source.corroborationScore === 'number' ? source.corroborationScore : 1;

  return trust * relevance * directness * temporal * corroboration;
}

function generatePrompt(
  query: string,
  sources: Source[],
  factCheckResults: ExternalFactCheck[],
  isInitial: boolean = false
) {
  return `You are the core evidence-analysis engine for VNews Lab.

USER CLAIM:
"${query}"

EVIDENCE CANDIDATES:
${JSON.stringify(sources, null, 2)}

GOOGLE FACT CHECK RESULTS:
${JSON.stringify(factCheckResults, null, 2)}

RULES:
1. Use ONLY the supplied evidence.
2. Pinecone/retrieval scores are NOT proof.
3. Judge the actual source text.
4. DIRECT means the source directly establishes or contradicts this exact claim.
5. RELATED means useful context but not proof.
6. Only DIRECT evidence may be selected in supportingEvidenceIds or contradictingEvidenceIds.
7. A decisive TRUE/FALSE/MIXED verdict must have corresponding evidence IDs, unless a closely matching Google Fact Check independently establishes it.
8. Never invent evidence IDs.
9. Google Fact Check ratings apply to the reviewed claim and must not be stretched beyond what the review establishes.
10. Three or more independent credible sources agreeing on the same factual proposition is strong corroboration.
11. If there is not enough evidence for a reliable factual verdict, return "UNVERIFIED". UNVERIFIED is a reminder/status, NOT a truth verdict.
12. Never manufacture certainty.

${isInitial
    ? 'This is an optional preliminary pass.'
    : 'This is the FINAL evidence analysis. Use the strongest evidence-backed verdict available.'}

Return ONLY:
{
  "verdict": "TRUE" | "FALSE" | "MIXED" | "UNVERIFIED",
  "analysis": "concise journalistic explanation",
  "supportingEvidenceIds": ["id1"],
  "contradictingEvidenceIds": ["id2"]
}

If evidence is insufficient, use UNVERIFIED and empty evidence arrays.`;
}

function createUnverifiedResult(
  verificationId: string,
  query: string,
  factCheckResults: ExternalFactCheck[],
  timestamp: number,
  analysis: string,
  status: string = 'SUCCESS',
  metadata: Record<string, unknown> = {}
): VerificationResult {
  return {
    id: verificationId,
    claim: query,
    verdict: 'UNVERIFIED',
    confidence: 0,
    analysis,
    supportingEvidence: [],
    contradictingEvidence: [],
    externalFactChecks: factCheckResults,
    isProvisional: true,
    timestamp,
    status,
    metadata,
  };
}

function validateAiVerdict(
  rawVerdict: string,
  supportingEvidence: Source[],
  contradictingEvidence: Source[],
  supportScore: number,
  contradictionScore: number
): VerificationVerdict {
  if (
    rawVerdict === 'TRUE' &&
    supportingEvidence.length > 0 &&
    contradictingEvidence.length === 0 &&
    supportScore >= 0.55
  ) {
    return 'TRUE';
  }

  if (
    rawVerdict === 'FALSE' &&
    contradictingEvidence.length > 0 &&
    supportingEvidence.length === 0 &&
    contradictionScore >= 0.55
  ) {
    return 'FALSE';
  }

  if (
    rawVerdict === 'MIXED' &&
    supportingEvidence.length > 0 &&
    contradictingEvidence.length > 0 &&
    supportScore >= 0.4 &&
    contradictionScore >= 0.4
  ) {
    return 'MIXED';
  }

  return 'UNVERIFIED';
}

function calculateSystemConfidence(
  supporting: Source[],
  contradicting: Source[],
  factChecks: ExternalFactCheck[],
  independentSources: number = 0
): number {
  const supportTotal = supporting.reduce((sum, s) => sum + buildEvidenceScore(s), 0);
  const contradictionTotal = contradicting.reduce((sum, s) => sum + buildEvidenceScore(s), 0);

  if (supporting.length > 0 && contradicting.length === 0) {
    return Math.min(
      0.99,
      0.62 + supportTotal * 0.22 + factChecks.length * 0.025 + (independentSources >= 3 ? 0.12 : 0)
    );
  }

  if (contradicting.length > 0 && supporting.length === 0) {
    return Math.min(
      0.99,
      0.62 + contradictionTotal * 0.22 + factChecks.length * 0.025 + (independentSources >= 3 ? 0.12 : 0)
    );
  }

  if (supporting.length > 0 && contradicting.length > 0) {
    return Math.min(0.92, 0.45 + (supportTotal + contradictionTotal) * 0.18);
  }

  return 0;
}

function calculateFactCheckConfidence(
  polarity: { support: number; contradiction: number },
  independentCount: number
): number {
  const strongest = Math.max(polarity.support, polarity.contradiction);
  if (strongest < 0.9) return 0;

  if (independentCount >= 3) {
    return 0.80;
  }

  return Math.min(0.95, 0.72 + strongest * 0.08);
}


function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !TOKEN_STOPWORDS.has(token));
}

function claimSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let overlap = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) overlap += 1;
  });

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function factCheckPolarityScore(query: string, factChecks: ExternalFactCheck[]): {
  support: number;
  contradiction: number;
} {
  let support = 0;
  let contradiction = 0;

  for (const fc of factChecks) {
    const claimText = `${fc.claim || ''} ${fc.title || ''}`.trim();
    if (!claimText) continue;

    const similarity = claimSimilarity(query, claimText);
    const explicitConflict = hasExplicitEntityConflict(query, claimText);

    if (similarity < 0.7 && !explicitConflict) continue;

    const rating = (fc.rating || '').toLowerCase();
    const isPositive = /\b(true|correct|mostly true|half true)\b/.test(rating);
    const isNegative = /\b(false|fake|misleading|incorrect|pants on fire|mostly false|half false)\b/.test(rating);

    // If the reviewed claim contains an explicitly mutually-exclusive entity
    // (for example Moon vs Mars), its rating is evidence against the user's claim.
    if (explicitConflict && (isPositive || isNegative)) {
      contradiction += 0.9;
      continue;
    }

    if (isPositive) {
      support += 0.9;
      continue;
    }

    if (isNegative) {
      contradiction += 0.9;
    }
  }

  return { support, contradiction };
}

const EXCLUSIVE_FACT_PAIRS: Array<[RegExp, RegExp]> = [
  [/\bmoon\b/i, /\bmars\b/i],
  [/\bmars\b/i, /\bmoon\b/i],
  [/\balive\b/i, /\bdead\b/i],
  [/\bdead\b/i, /\balive\b/i],
  [/\bwon\b/i, /\blost\b/i],
  [/\blost\b/i, /\bwon\b/i],
  [/\bjoined\b/i, /\bleft\b/i],
  [/\bleft\b/i, /\bjoined\b/i],
];

function hasExplicitEntityConflict(query: string, evidenceText: string): boolean {
  return EXCLUSIVE_FACT_PAIRS.some(([claimPattern, evidencePattern]) =>
    claimPattern.test(query) && evidencePattern.test(evidenceText)
  );
}

function normalizeDomain(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function independentSourceCount(sources: Source[]): number {
  const keys = new Set<string>();

  for (const source of sources) {
    const origin = String(source.metadata?.origin || '').trim().toLowerCase();

    if (origin === 'knowledge-base') {
      const documentId = String(source.metadata?.documentId || source.id).trim().toLowerCase();
      keys.add(`kb:${documentId}`);
      continue;
    }

    const domain =
      normalizeDomain(source.url) ||
      String(source.metadata?.source || source.metadata?.publication || '').trim().toLowerCase();

    if (domain) {
      keys.add(domain);
    }
  }

  return keys.size;
}

function countIndependentFactChecks(
  query: string,
  factChecks: ExternalFactCheck[]
): number {
  const matching = factChecks.filter((fc) => {
    const claimText = `${fc.claim || ''} ${fc.title || ''}`.trim();
    return claimText && (
      claimSimilarity(query, claimText) >= 0.7 ||
      hasExplicitEntityConflict(query, claimText)
    );
  });

  return new Set(
    matching.map((fc) => {
      const publisher = String(fc.publisher || '').trim().toLowerCase();
      if (publisher) return publisher;
      return normalizeDomain(fc.url) || String(fc.url || '').trim().toLowerCase();
    })
  ).size;
}

const NEGATION_PATTERNS = [
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

function looksLikeContradiction(source: Source, query: string): boolean {
  const text = `${source.title || ''} ${source.snippet || ''}`;

  if (NEGATION_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  if (hasExplicitEntityConflict(query, text)) {
    return true;
  }

  // Conservative fallback: don't guess polarity for negated user claims.
  if (/\b(not|never|didn't|did not|isn't|is not|wasn't|was not)\b/i.test(query)) {
    return false;
  }

  return false;
}

function deterministicCorroboration(
  query: string,
  sources: Source[],
  factChecks: ExternalFactCheck[]
): {
  verdict: VerificationVerdict;
  supporting: Source[];
  contradicting: Source[];
  confidence: number;
  independentSources: number;
  reason: string;
} {
  const usable = sources.filter((source) => source.relevance !== 'IRRELEVANT');

  const contradictionCandidates = usable.filter((source) =>
    looksLikeContradiction(source, query)
  );

  const supportCandidates = usable.filter(
    (source) =>
      !looksLikeContradiction(source, query) &&
      (source.relevance === 'DIRECT' || source.relevance === undefined)
  );

  const contradictionDomains = independentSourceCount(contradictionCandidates);
  const supportDomains = independentSourceCount(supportCandidates);

  const factPolarity = factCheckPolarityScore(query, factChecks);
  const independentFactChecks = countIndependentFactChecks(query, factChecks);

  // A closely matching external fact check can independently establish the verdict.
  if (factPolarity.contradiction >= 0.9 && factPolarity.support < 0.9) {
    return {
      verdict: 'FALSE',
      supporting: [],
      contradicting: [],
      confidence: calculateFactCheckConfidence(factPolarity, independentFactChecks),
      independentSources: independentFactChecks,
      reason: 'A closely matching external fact check contradicts the claim.',
    };
  }

  if (factPolarity.support >= 0.9 && factPolarity.contradiction < 0.9) {
    return {
      verdict: 'TRUE',
      supporting: [],
      contradicting: [],
      confidence: calculateFactCheckConfidence(factPolarity, independentFactChecks),
      independentSources: independentFactChecks,
      reason: 'A closely matching external fact check supports the claim.',
    };
  }

  // 3+ independent sources agreeing is enough without Pinecone.
  if (contradictionDomains >= 3 && supportDomains === 0) {
    const selected = contradictionCandidates.slice(0, 8).map((s) => ({
      ...s,
      relevance: 'DIRECT' as const,
    }));

    return {
      verdict: 'FALSE',
      supporting: [],
      contradicting: selected,
      confidence: 0.80,
      independentSources: contradictionDomains,
      reason: 'Three or more independent sources corroborate the contradiction.',
    };
  }

  if (supportDomains >= 3 && contradictionDomains === 0) {
    const selected = supportCandidates.slice(0, 8).map((s) => ({
      ...s,
      relevance: 'DIRECT' as const,
    }));

    return {
      verdict: 'TRUE',
      supporting: selected,
      contradicting: [],
      confidence: 0.80,
      independentSources: supportDomains,
      reason: 'Three or more independent sources corroborate the claim.',
    };
  }

  if (supportDomains >= 2 && contradictionDomains >= 2) {
    return {
      verdict: 'MIXED',
      supporting: supportCandidates.slice(0, 8).map((s) => ({ ...s, relevance: 'DIRECT' as const })),
      contradicting: contradictionCandidates.slice(0, 8).map((s) => ({ ...s, relevance: 'DIRECT' as const })),
      confidence: 0.80,
      independentSources: supportDomains + contradictionDomains,
      reason: 'Independent evidence exists on both sides of the claim.',
    };
  }

  return {
    verdict: 'UNVERIFIED',
    supporting: [],
    contradicting: [],
    confidence: 0,
    independentSources: Math.max(supportDomains, contradictionDomains, independentFactChecks),
    reason: 'No reliable factual verdict could be established. This is an UNVERIFIED reminder, not a verdict.',
  };
}

function summarizeEvidence(
  pineconeRes: { status: string; results: Source[] },
  webRes: { status: string; results: Source[] },
  factCheckResults: ExternalFactCheck[]
) {
  const all = [...pineconeRes.results, ...webRes.results];
  const candidateCount = all.filter((r) => r.relevance !== 'IRRELEVANT').length;

  const summary = {
    pinecone: pineconeRes.results.length,
    news: webRes.results.length,
    factCheck: factCheckResults.length,
    candidates: candidateCount,
    direct: all.filter((r) => r.relevance === 'DIRECT').length,
    related: all.filter((r) => r.relevance === 'RELATED').length,
    unclassified: all.filter((r) => !r.relevance).length,
  };

  console.log('[Verification] Evidence summary before final analysis:', summary);
  const candidates = all.filter((r) => r.relevance !== 'IRRELEVANT');
  candidates.slice(0, 10).forEach((item) => {
    console.log(`[Verification] Evidence candidate: id=${item.id} type=${item.metadata?.origin ?? 'unknown'} source=${item.metadata?.source ?? item.title ?? 'unknown'} title=${item.title ?? 'untitled'}`);
  });
}

export async function runProgressiveVerification(
  query: string,
  emit: (event: string, data: unknown) => void
): Promise<void> {
  const startTime = Date.now();
  const timestamp = startTime;
  const verificationId = `vnl-${timestamp}`;

  emit('verification_started', { verificationId, query });

  const intent = checkQueryIntent(query);

  if (!intent.isValidClaim) {
    emit('status', { message: 'Claim is not verifiable.' });
    emit('final_result', {
      id: verificationId,
      claim: query,
      verdict: 'UNVERIFIED',
      confidence: 0,
      analysis: intent.message || 'This is not a verifiable factual claim. No factual verdict was issued.',
      supportingEvidence: [],
      contradictingEvidence: [],
      externalFactChecks: [],
      isProvisional: false,
      timestamp,
      status: 'SUCCESS',
      metadata: {
        sourcesChecked: 0,
        sourcesQualified: 0,
        independentSources: 0,
        durationMs: Date.now() - startTime,
      },
    });
    return;
  }

  emit('status', { message: 'Preparing evidence retrieval...' });

  // Gemini claim analysis is an optimization, NOT a dependency.
  // If Gemini Flash is quota-exhausted, verification continues.
  let claimContext: Awaited<ReturnType<typeof analyzeClaim>>;

  try {
    claimContext = await analyzeClaim(query);
    emit('claim_analysis_completed', claimContext);
  } catch (error) {
    console.warn('[Verification] Claim analysis unavailable; using original claim:', error);

    claimContext = {
      subject: query,
      event: query,
      claimType: 'factual',
    };

    emit('claim_analysis_completed', claimContext);
  }

  emit('status', { message: 'Retrieving evidence sources...' });

  const factCheckPromise = checkGoogleFactCheckAPI(query);
  const pineconePromise = searchPinecone(query, 8);
  const webSearchPromise = searchWeb(claimContext);

  const retrievalStart = Date.now();
  const factCheckResults = await factCheckPromise;

  // No second Gemini call for a provisional fact-check verdict.
  // This saves quota and prevents an early AI result from conflicting with
  // the final evidence result.
  const initialResult = createUnverifiedResult(
    verificationId,
    query,
    factCheckResults,
    timestamp,
    'Evidence retrieval in progress.'
  );

  emit('initial_result', initialResult);
  emit('status', { message: 'Deep evidence retrieval in progress...' });

  const [pineconeRes, webRes] = await Promise.all([
    pineconePromise,
    webSearchPromise,
  ]);

  emit('news_search_completed', {
    count: webRes.results.length,
    status: webRes.status,
    durationMs: Date.now() - retrievalStart,
  });

  emit('knowledge_search_completed', {
    count: pineconeRes.results.length,
    status: pineconeRes.status,
    durationMs: Date.now() - retrievalStart,
  });

  if (pineconeRes.status === 'EMPTY') {
    emit('status', { message: 'Knowledge Base: no usable match. Continuing with external sources.' });
  } else if (pineconeRes.status === 'ERROR') {
    emit('status', { message: 'Knowledge Base unavailable. Continuing with external sources.' });
  }

  if (webRes.status === 'EMPTY') {
    emit('status', { message: 'Live news: no matching articles. Continuing with other evidence.' });
  } else if (webRes.status === 'ERROR') {
    emit('status', { message: 'Live news unavailable. Continuing with other evidence.' });
  }

  // Pinecone is optional. It must never be required for a verdict.
  if (pineconeRes.status === 'ERROR' && webRes.status === 'ERROR') {
    const fallback = deterministicCorroboration(query, [], factCheckResults);

    emit('final_result', {
      ...initialResult,
      verdict: fallback.verdict,
      confidence: fallback.confidence,
      analysis:
        fallback.verdict === 'UNVERIFIED'
          ? 'Retrieval providers were unavailable. No factual verdict was issued.'
          : fallback.reason,
      supportingEvidence: fallback.supporting,
      contradictingEvidence: fallback.contradicting,
      isProvisional: false,
      status: 'SUCCESS',
      metadata: {
        sourcesChecked: 0,
        sourcesQualified: 0,
        independentSources: fallback.independentSources,
        durationMs: Date.now() - startTime,
        fallback: true,
      },
    });
    return;
  }

  const sources: Source[] = pineconeRes.results
    // Very low reranker scores are candidates, not proof. Discard only
    // obviously useless scores while still allowing KB to be optional.
    .filter((result) => {
      const score = typeof result.score === 'number' ? result.score : 0;
      return score > 0.05;
    })
    .map((result) => ({
      id: result.id,
      title: (result.metadata.title as string) || 'Document Extract',
      snippet: result.text,
      url: (result.metadata.url as string) || undefined,
      publicationDate: (result.metadata.date as string) || undefined,
      retrievalScore: result.score,
      relevance: undefined,
      sourceQuality: 'HIGH',
      metadata: {
        origin: 'knowledge-base',
        type: result.metadata.type,
        documentId: result.documentId,
      },
    }));

  const webSources: Source[] = webRes.results.map((result, index) => ({
    id: `web-${index}`,
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

  const retrievedSources: Source[] = [...sources, ...webSources];

  // IMPORTANT:
  // Pinecone candidates remain visible to the final evidence analyzer even
  // when relevance is undefined. Only explicitly IRRELEVANT web results are
  // removed before analysis.
  const candidateEvidence = retrievedSources.filter(
    (source) => source.relevance !== 'IRRELEVANT'
  );

  summarizeEvidence(
    { status: pineconeRes.status, results: sources },
    { status: webRes.status, results: webSources },
    factCheckResults
  );

  emit('evidence_qualified', {
    qualifiedCount: candidateEvidence.length,
    candidateCount: retrievedSources.length,
  });

  if (candidateEvidence.length === 0 && factCheckResults.length === 0) {
    emit('status', { message: 'No evidence found. Showing UNVERIFIED reminder.' });

    emit('final_result', {
      ...initialResult,
      verdict: 'UNVERIFIED',
      confidence: 0,
      analysis: 'No reliable evidence was retrieved. No factual verdict was issued.',
      isProvisional: false,
      status: 'SUCCESS',
      metadata: {
        sourcesChecked: retrievedSources.length,
        sourcesQualified: 0,
        independentSources: 0,
        durationMs: Date.now() - startTime,
      },
    });
    return;
  }

  // Primary final evidence analysis.
  if (ai) {
    emit('status', { message: 'Gemma analyzing evidence...' });

    try {
      const prompt = generatePrompt(
        query,
        candidateEvidence,
        factCheckResults,
        false
      );

      const response = await Promise.race([
        ai.models.generateContent({
          model: 'gemma-4-31b-it',
          contents: prompt,
          config: { responseMimeType: 'application/json' },
        }),
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error('AI_ANALYSIS_TIMEOUT')),
            120000
          );
        }),
      ]);

      const llmResult = JSON.parse(
        (response as { text?: string }).text || '{}'
      );

      const rawVerdict = llmResult.verdict || 'UNVERIFIED';

      const supportingIds = Array.isArray(llmResult.supportingEvidenceIds)
        ? llmResult.supportingEvidenceIds
        : [];

      const contradictingIds = Array.isArray(llmResult.contradictingEvidenceIds)
        ? llmResult.contradictingEvidenceIds
        : [];

      const retrievedSourceIds = new Set(
        retrievedSources.map((source) => source.id)
      );

      const validSupportingIds = supportingIds.filter((id: string) => {
        const exists = retrievedSourceIds.has(id);
        if (!exists) {
          console.warn(
            `[Verification] AI returned invalid supporting evidence ID: ${id}`
          );
        }
        return exists;
      });

      const validContradictingIds = contradictingIds.filter((id: string) => {
        const exists = retrievedSourceIds.has(id);
        if (!exists) {
          console.warn(
            `[Verification] AI returned invalid contradicting evidence ID: ${id}`
          );
        }
        return exists;
      });

      const supportingIdsSet = new Set(validSupportingIds);
      const contradictingIdsSet = new Set(validContradictingIds);

      // The same source cannot be both sides of one verdict.
      const overlapIds = new Set(
        validSupportingIds.filter((id: string) =>
          contradictingIdsSet.has(id)
        )
      );

      let supportingEvidence: Source[] = candidateEvidence
        .filter(
          (source) =>
            supportingIdsSet.has(source.id) &&
            !overlapIds.has(source.id)
        )
        .map((source) => ({
          ...source,
          relevance: 'DIRECT' as const,
        }));

      let contradictingEvidence: Source[] = candidateEvidence
        .filter(
          (source) =>
            contradictingIdsSet.has(source.id) &&
            !overlapIds.has(source.id)
        )
        .map((source) => ({
          ...source,
          relevance: 'DIRECT' as const,
        }));

      let finalSupportScore = supportingEvidence.reduce(
        (sum, source) => sum + buildEvidenceScore(source),
        0
      );

      let finalContradictionScore = contradictingEvidence.reduce(
        (sum, source) => sum + buildEvidenceScore(source),
        0
      );

      const factPolarity = factCheckPolarityScore(
        query,
        factCheckResults
      );

      let normalizedVerdict = validateAiVerdict(
        rawVerdict,
        supportingEvidence,
        contradictingEvidence,
        finalSupportScore,
        finalContradictionScore
      );

      // If Gemma says UNVERIFIED but the evidence pool independently contains
      // 3+ agreeing sources, use deterministic corroboration.
      let deterministicFallback:
        | ReturnType<typeof deterministicCorroboration>
        | null = null;

      if (normalizedVerdict === 'UNVERIFIED') {
        deterministicFallback = deterministicCorroboration(
          query,
          candidateEvidence,
          factCheckResults
        );

        if (deterministicFallback.verdict !== 'UNVERIFIED') {
          normalizedVerdict = deterministicFallback.verdict;

          supportingEvidence = deterministicFallback.supporting;
          contradictingEvidence = deterministicFallback.contradicting;

          finalSupportScore = supportingEvidence.reduce(
            (sum, source) => sum + buildEvidenceScore(source),
            0
          );

          finalContradictionScore = contradictingEvidence.reduce(
            (sum, source) => sum + buildEvidenceScore(source),
            0
          );
        }
      }

      // A closely matching external fact check can establish the verdict even
      // if the LLM did not select a retrieved evidence ID.
      const independentFactChecks = countIndependentFactChecks(
        query,
        factCheckResults
      );

      if (
        supportingEvidence.length === 0 &&
        contradictingEvidence.length === 0 &&
        normalizedVerdict === 'UNVERIFIED'
      ) {
        if (
          factPolarity.contradiction >= 0.9 &&
          factPolarity.support < 0.9
        ) {
          normalizedVerdict = 'FALSE';
        } else if (
          factPolarity.support >= 0.9 &&
          factPolarity.contradiction < 0.9
        ) {
          normalizedVerdict = 'TRUE';
        } else if (
          factPolarity.support >= 0.9 &&
          factPolarity.contradiction >= 0.9
        ) {
          normalizedVerdict = 'MIXED';
        }
      }

      const evidenceConfidence = calculateSystemConfidence(
        supportingEvidence,
        contradictingEvidence,
        factCheckResults,
        Math.max(
          independentSourceCount(supportingEvidence),
          independentSourceCount(contradictingEvidence)
        )
      );

      const factCheckConfidence = calculateFactCheckConfidence(
        factPolarity,
        independentFactChecks
      );

      const directIndependentSources = Math.max(
        independentSourceCount(supportingEvidence),
        independentSourceCount(contradictingEvidence)
      );

      // Hard invariant:
      // UNVERIFIED is a reminder/status only and always has zero confidence.
      const finalConfidence =
        normalizedVerdict === 'UNVERIFIED'
          ? 0
          : Math.max(
              evidenceConfidence,
              factCheckConfidence,
              directIndependentSources >= 3 &&
              (normalizedVerdict === 'TRUE' ||
                normalizedVerdict === 'FALSE')
                ? 0.80
                : 0
            );

      const finalResult: VerificationResult = {
        id: verificationId,
        claim: query,
        verdict: normalizedVerdict,
        confidence: finalConfidence,
        analysis:
          llmResult.analysis ||
          (normalizedVerdict === 'UNVERIFIED'
            ? 'No reliable factual verdict could be established.'
            : 'Evidence analysis complete.'),
        supportingEvidence,
        contradictingEvidence,
        externalFactChecks: factCheckResults,
        isProvisional: false,
        timestamp,
        status: 'SUCCESS',
        metadata: {
          sourcesChecked: retrievedSources.length,
          sourcesQualified: candidateEvidence.length,
          independentSources: Math.max(
            directIndependentSources,
            independentFactChecks
          ),
          durationMs: Date.now() - startTime,
        },
      };

      emit('analysis_completed', {
        verdict: normalizedVerdict,
        confidence: finalConfidence,
      });

      emit('final_result', finalResult);
      return;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      console.warn(
        '[Verification] Final AI analysis unavailable; using deterministic evidence fallback:',
        message
      );

      const fallback = deterministicCorroboration(
        query,
        candidateEvidence,
        factCheckResults
      );

      emit('status', {
        message:
          fallback.verdict === 'UNVERIFIED'
            ? 'No reliable verdict. Showing UNVERIFIED reminder.'
            : `Deterministic fallback verdict: ${fallback.verdict}`,
      });

      emit('final_result', {
        ...initialResult,
        verdict: fallback.verdict,
        confidence: fallback.confidence,
        analysis: fallback.reason,
        supportingEvidence: fallback.supporting,
        contradictingEvidence: fallback.contradicting,
        isProvisional: false,
        status: 'SUCCESS',
        metadata: {
          sourcesChecked: retrievedSources.length,
          sourcesQualified: candidateEvidence.length,
          independentSources: fallback.independentSources,
          durationMs: Date.now() - startTime,
          fallback: true,
        },
      });

      return;
    }
  }

  // No AI configured at all. Deterministic corroboration is the fallback.
  const fallback = deterministicCorroboration(
    query,
    candidateEvidence,
    factCheckResults
  );

  emit('final_result', {
    ...initialResult,
    verdict: fallback.verdict,
    confidence: fallback.confidence,
    analysis: fallback.reason,
    supportingEvidence: fallback.supporting,
    contradictingEvidence: fallback.contradicting,
    isProvisional: false,
    status: 'SUCCESS',
    metadata: {
      sourcesChecked: retrievedSources.length,
      sourcesQualified: candidateEvidence.length,
      independentSources: fallback.independentSources,
      durationMs: Date.now() - startTime,
      fallback: true,
    },
  });
}

export async function runVerification(query: string): Promise<VerificationResult> {
  let result: VerificationResult | null = null;
  await runProgressiveVerification(query, (event, data) => {
    if (event === 'final_result') {
      const maybeResult = data as VerificationResult;
      if (maybeResult && typeof maybeResult === 'object' && 'claim' in maybeResult) {
        result = maybeResult;
      }
    }
  });
  if (!result) {
    throw new Error('Failed to generate verification result');
  }
  return result;
}