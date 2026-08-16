import { GoogleGenAI } from '@google/genai';
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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const ai = GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: GEMINI_API_KEY,
    })
  : null;

/**
 * Uses AI to generate 1-3 specific search queries based on the ClaimContext.
 */
async function generateSearchQueries(claimContext: ClaimContext): Promise<string[]> {
  if (!ai || !claimContext.subject) {
    return [claimContext.subject];
  }

  try {
    const prompt = `You are a search-query generator for a news verification platform.
Given the following claim context, generate 1 to 3 highly specific search queries that will retrieve current news articles to verify this claim.

Subject: ${claimContext.subject}
Event: ${claimContext.event}
Location: ${claimContext.location || 'None'}
Claim Type: ${claimContext.claimType || 'None'}

Rules:
- Generate 1 to 3 queries.
- Keep them short (2 to 5 words).
- Focus on the core entity and the specific event.
- For claims like "Person X is dead", generate e.g., ["Person X death", "Person X alive"].
- For "Person Y arrested", generate e.g., ["Person Y arrested", "Person Y released"].
- Do NOT use quotation marks.
- Return ONLY a JSON array of strings.

Example:
["Ali Khamenei death", "Ali Khamenei alive"]
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const generated = JSON.parse(response.text || '[]') as string[];
    return generated.length > 0 ? generated.slice(0, 3) : [claimContext.subject];
  } catch (error) {
    console.error('AI search-query generation failed:', error);
    return [claimContext.subject];
  }
}

/**
 * AI Relevance Filter: Classify if a retrieved article is relevant to the claim.
 */
async function filterAndClassifyResults(
  claimContext: ClaimContext,
  results: WebSearchResult[]
): Promise<WebSearchResult[]> {
  if (!ai || results.length === 0) return results;

  try {
    const prompt = `You are a strict relevance classifier for a news verification platform.
Analyze the following news articles against the user's claim context and classify each one's relevance.

Claim Subject: ${claimContext.subject}
Claim Event: ${claimContext.event}

Classify each article into ONE of these categories:
- DIRECT: The article directly addresses the specific event/claim (either supporting or contradicting it).
- RELATED: The article provides useful context about the subject and event, but doesn't directly address the exact claim.
- TOPICAL: The article is merely about the same person or location, but a completely different event/topic.
- IRRELEVANT: Completely unrelated.

Articles:
${JSON.stringify(results.map((r, i) => ({ id: i, title: r.title, snippet: r.snippet })), null, 2)}

Return ONLY a strict JSON array of objects with 'id' and 'relevance' keys.
Example:
[
  { "id": 0, "relevance": "DIRECT" },
  { "id": 1, "relevance": "TOPICAL" }
]
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const classifications = JSON.parse(response.text || '[]') as { id: number; relevance: string }[];
    
    return results.map((result, idx) => {
      const classification = classifications.find((c) => c.id === idx);
      return {
        ...result,
        relevance: (classification?.relevance as any) || 'TOPICAL',
      };
    }).filter(r => r.relevance === 'DIRECT' || r.relevance === 'RELATED');

  } catch (error) {
    console.error('AI relevance classification failed:', error);
    return results.map(r => ({ ...r, relevance: 'RELATED' })); // Fallback
  }
}


/**
 * Search current news using NewsAPI.
 */
export async function searchWeb(
  claimContext: ClaimContext
): Promise<WebSearchResponse> {
  if (!claimContext.subject) {
    console.warn('Web search skipped: empty subject');
    return { status: 'EMPTY', results: [] };
  }

  if (!NEWS_API_KEY) {
    console.error('Web search skipped: NEWS_API_KEY is missing');
    return { status: 'ERROR', results: [] };
  }

  try {
    const queries = await generateSearchQueries(claimContext);
    console.log('AI optimized news queries:', queries);

    let allArticles: any[] = [];
    let hasError = false;

    // Run queries in parallel
    const searchPromises = queries.map(async (query) => {
      const url = new URL('https://newsapi.org/v2/everything');
      url.searchParams.set('q', query);
      url.searchParams.set('language', 'en');
      url.searchParams.set('sortBy', 'publishedAt');
      url.searchParams.set('pageSize', '5'); // Less per query to stay within limits
      url.searchParams.set('apiKey', NEWS_API_KEY);

      try {
        const response = await fetch(url.toString(), { cache: 'no-store' });
        if (!response.ok) {
          console.error(`NewsAPI error for query "${query}": ${response.status}`);
          hasError = true;
          return [];
        }
        const data = await response.json();
        return data.articles || [];
      } catch (err) {
        console.error(`NewsAPI fetch failed for query "${query}":`, err);
        hasError = true;
        return [];
      }
    });

    const articlesArrays = await Promise.all(searchPromises);
    articlesArrays.forEach((articles) => {
      allArticles.push(...articles);
    });

    if (hasError && allArticles.length === 0) {
      return { status: 'ERROR', results: [] };
    }

    // Deduplicate by URL
    const seenUrls = new Set<string>();
    const deduplicated = allArticles.filter((article) => {
      if (!article.url || !article.title) return false;
      if (seenUrls.has(article.url)) return false;
      seenUrls.add(article.url);
      return true;
    });

    const rawResults: WebSearchResult[] = deduplicated.map((article) => ({
      title: article.title || '',
      url: article.url || '',
      snippet: article.description || article.content || '',
      publishedDate: article.publishedAt || undefined,
      source: article.source?.name || undefined,
    }));

    if (rawResults.length === 0) {
      return { status: 'EMPTY', results: [] };
    }

    // Filter and classify relevance
    const classifiedResults = await filterAndClassifyResults(claimContext, rawResults);
    
    return {
      status: 'SUCCESS',
      results: classifiedResults,
    };
  } catch (error) {
    console.error('Web search failed:', error);
    return { status: 'ERROR', results: [] };
  }
}