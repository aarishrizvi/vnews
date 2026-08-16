import { RetrievalStatus, ClaimContext } from '../types';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
  source?: string;
  relevance?: 'DIRECT' | 'RELATED' | 'TOPICAL' | 'IRRELEVANT';
}

export interface WebSearchResponse {
  status: RetrievalStatus;
  results: WebSearchResult[];
}

const NEWS_API_KEY = process.env.NEWS_API_KEY;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'of', 'for', 'to', 'in', 'on', 'at', 'by', 'and', 'or', 'with',
  'from', 'that', 'this', 'these', 'those', 'has', 'have', 'had',
  'does', 'did', 'do', 'will', 'would', 'could', 'should', 'can',
  'may', 'might', 'claim', 'claims', 'according', 'said', 'says',
]);

const ALIASES: Record<string, string[]> = {
  chandrayaan3: ['chandrayaan3', 'chandrayaan', 'vikram', 'isro'],
  'chandrayaan-3': ['chandrayaan3', 'chandrayaan', 'vikram', 'isro'],
  moon: ['moon', 'lunar', 'lunar surface', 'south pole'],
  landed: ['landed', 'landing', 'soft landing', 'touchdown'],
  land: ['landed', 'landing', 'soft landing', 'touchdown'],
  august: ['august', '2023'],
  2023: ['2023'],
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text: string): string[] {
  return [...new Set(
    normalize(text)
      .split(/\s+/)
      .map((token) => token.replace(/^-+|-+$/g, ''))
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
  )];
}

function expandTokens(input: string[]): Set<string> {
  const expanded = new Set<string>();

  for (const token of input) {
    expanded.add(token);

    for (const alias of ALIASES[token] || []) {
      expanded.add(alias);
    }

    // Normalize hyphenated model names such as Chandrayaan-3.
    if (token.includes('-')) {
      expanded.add(token.replace(/-/g, ''));
    }
  }

  return expanded;
}

function buildClaimText(context: ClaimContext): string {
  return [
    context.subject,
    context.event,
    context.location,
    context.temporalContext,
    context.claimType,
  ]
    .filter(Boolean)
    .join(' ');
}

function classifyDeterministically(
  claimContext: ClaimContext,
  result: WebSearchResult
): 'DIRECT' | 'RELATED' | 'TOPICAL' | 'IRRELEVANT' {
  const claim = buildClaimText(claimContext);
  const claimTokens = expandTokens(tokens(claim));

  const articleText = `${result.title} ${result.snippet} ${result.source || ''}`;
  const articleTokens = new Set(tokens(articleText));

  if (claimTokens.size === 0 || articleTokens.size === 0) {
    return 'TOPICAL';
  }

  let matched = 0;
  for (const token of claimTokens) {
    if (articleTokens.has(token)) matched++;
  }

  const overlap = matched / claimTokens.size;

  const subjectTokens = expandTokens(tokens(claimContext.subject || ''));
  const eventTokens = expandTokens(tokens(claimContext.event || ''));
  const locationTokens = expandTokens(tokens(claimContext.location || ''));

  const subjectMatch = [...subjectTokens].some((t) => articleTokens.has(t));
  const eventMatch = eventTokens.size === 0
    ? false
    : [...eventTokens].some((t) => articleTokens.has(t));
  const locationMatch = locationTokens.size === 0
    ? false
    : [...locationTokens].some((t) => articleTokens.has(t));

  /*
   * IMPORTANT:
   * This is intentionally permissive.
   *
   * NewsAPI retrieval is evidence collection, not the final verdict.
   * We must NOT delete an article merely because an AI classifier
   * thinks it is only "related". The final verification engine will
   * determine whether the article actually supports or contradicts
   * the claim.
   */
  if (subjectMatch && (eventMatch || overlap >= 0.25)) {
    return 'DIRECT';
  }

  if (subjectMatch || locationMatch || overlap >= 0.12) {
    return 'RELATED';
  }

  return 'TOPICAL';
}

function canonicalQueryTerms(context: ClaimContext): string[] {
  const subject = normalize(context.subject || '');
  const event = normalize(context.event || '');
  const location = normalize(context.location || '');

  const queries: string[] = [];

  if (subject && event) {
    queries.push(`${subject} ${event}`);
  }

  if (subject && location) {
    queries.push(`${subject} ${location}`);
  }

  if (subject) {
    queries.push(subject);
  }

  return [...new Set(
    queries
      .map((q) => q.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  )].slice(0, 3);
}

function fallbackQueriesFromContext(context: ClaimContext): string[] {
  const subject = normalize(context.subject || '');
  const event = normalize(context.event || '');
  const location = normalize(context.location || '');

  const queries = [
    subject && event ? `${subject} ${event}` : '',
    subject && location ? `${subject} ${location}` : '',
    subject,
  ];

  return [...new Set(queries.filter(Boolean))].slice(0, 3);
}

/**
 * Search current news using NewsAPI.
 *
 * Design rule:
 * NewsAPI results are candidates. They are NEVER discarded because
 * Gemini is unavailable or because a second AI classifier dislikes
 * their wording. Relevance is assigned deterministically and the
 * final verification engine decides whether the source is proof.
 */
export async function searchWeb(
  claimContext: ClaimContext
): Promise<WebSearchResponse> {
  if (!NEWS_API_KEY) {
    console.error('[WebSearch] NEWS_API_KEY is missing');
    return { status: 'ERROR', results: [] };
  }

  const queries = canonicalQueryTerms(claimContext);

  if (queries.length === 0) {
    console.warn('[WebSearch] No usable query terms');
    return { status: 'EMPTY', results: [] };
  }

  console.log('[WebSearch] Deterministic queries:', JSON.stringify(queries));

  const allArticles: any[] = [];
  let hasError = false;

  await Promise.all(
    queries.map(async (query) => {
      const url = new URL('https://newsapi.org/v2/everything');

      url.searchParams.set('q', query);
      url.searchParams.set('language', 'en');
      url.searchParams.set('sortBy', 'publishedAt');
      url.searchParams.set('pageSize', '10');
      url.searchParams.set('apiKey', NEWS_API_KEY);

      try {
        const response = await fetch(url.toString(), {
          cache: 'no-store',
        });

        if (!response.ok) {
          hasError = true;
          console.error(
            `[WebSearch] NewsAPI error query="${query}" status=${response.status}`
          );
          return;
        }

        const data = await response.json();

        console.log(
          '[WebSearch] NewsAPI raw response meta:',
          JSON.stringify({
            query,
            status: data.status,
            totalResults: data.totalResults,
            articleCount: Array.isArray(data.articles)
              ? data.articles.length
              : 0,
            httpStatus: response.status,
          })
        );

        if (Array.isArray(data.articles)) {
          allArticles.push(...data.articles);
        }
      } catch (error) {
        hasError = true;
        console.error(
          `[WebSearch] NewsAPI request failed query="${query}"`,
          error
        );
      }
    })
  );

  if (hasError && allArticles.length === 0) {
    return { status: 'ERROR', results: [] };
  }

  const seenUrls = new Set<string>();

  const deduplicated = allArticles.filter((article) => {
    const url = typeof article?.url === 'string' ? article.url.trim() : '';
    const title =
      typeof article?.title === 'string' ? article.title.trim() : '';

    if (!url || !title) return false;
    if (seenUrls.has(url)) return false;

    seenUrls.add(url);
    return true;
  });

  const rawResults: WebSearchResult[] = deduplicated.map((article) => ({
    title: article.title || '',
    url: article.url || '',
    snippet: article.description || article.content || '',
    publishedDate: article.publishedAt || undefined,
    source: article.source?.name || undefined,
  }));

  console.log(
    '[WebSearch] Aggregate diagnostics:',
    JSON.stringify({
      rawCount: allArticles.length,
      deduplicatedCount: rawResults.length,
    })
  );

  if (rawResults.length === 0) {
    return { status: 'EMPTY', results: [] };
  }

  /*
   * Do NOT filter out RELATED/TOPICAL results here.
   *
   * Previously the pipeline did:
   *
   *   Gemini classification
   *      ↓
   *   DIRECT / RELATED
   *      ↓
   *   everything else deleted
   *
   * That caused:
   *
   *   NewsAPI: 3 articles
   *   filteredArticleCount: 0
   *
   * and made external verification look like it had no evidence.
   *
   * Now every retrieved article survives into verification.
   */
  const classifiedResults = rawResults.map((result) => ({
    ...result,
    relevance: classifyDeterministically(claimContext, result),
  }));

  const directCount = classifiedResults.filter(
    (result) => result.relevance === 'DIRECT'
  ).length;

  const relatedCount = classifiedResults.filter(
    (result) => result.relevance === 'RELATED'
  ).length;

  console.log(
    '[WebSearch] Classification diagnostics:',
    JSON.stringify({
      retrieved: classifiedResults.length,
      direct: directCount,
      related: relatedCount,
      topical: classifiedResults.length - directCount - relatedCount,
      filteredArticleCount: 0,
      finalArticleCount: classifiedResults.length,
    })
  );

  classifiedResults.slice(0, 10).forEach((result, index) => {
    console.log(
      `[WebSearch] Candidate [${index}] relevance=${result.relevance} source=${result.source || 'unknown'} title="${result.title}"`
    );
  });

  return {
    status: 'SUCCESS',
    results: classifiedResults,
  };
}