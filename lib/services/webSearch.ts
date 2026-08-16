import { GoogleGenAI } from '@google/genai';

export interface WebSearchResult {
    title: string;
    url: string;
    snippet: string;
    publishedDate?: string;
    source?: string;
}

const NEWS_API_KEY = process.env.NEWS_API_KEY;

const GEMINI_API_KEY =
    process.env.GEMINI_API_KEY;

const ai = GEMINI_API_KEY
    ? new GoogleGenAI({
        apiKey: GEMINI_API_KEY,
    })
    : null;


/**
 * Uses AI to turn a user's claim into
 * a concise news-search query.
 *
 * Example:
 *
 * "Ayatullah Khamenei is Dead"
 *
 * becomes:
 *
 * "Khamenei Iran"
 */
async function generateSearchQuery(
    claim: string
): Promise<string> {

    if (!ai) {
        console.warn(
            'Search query AI unavailable, using original query.'
        );

        return claim;
    }

    try {
        const prompt = `
You are a search-query optimizer for VNews Lab.

Convert the user's claim into ONE concise search query
that will retrieve relevant current news articles.

The search engine should find reporting ABOUT the claim,
not necessarily articles containing the exact wording.

Rules:
- Keep important people, organizations, places and events.
- Remove unnecessary conversational wording.
- Do not answer or fact-check the claim.
- Do not explain anything.
- Do not use quotation marks.
- Keep the query short, normally 2 to 6 words.
- Prefer the entity + topic/location.
- For death, resignation, arrest, attack, election, war,
  disappearance, etc., preserve the important event context.
- Return ONLY the search query.

User claim:
${claim}
`;

        const response =
            await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });

        const generated =
            response.text?.trim();

        if (!generated) {
            return claim;
        }

        // Remove accidental quotes/code formatting.
        const cleaned = generated
            .replace(/^["'`]+|["'`]+$/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        return cleaned || claim;

    } catch (error) {
        console.error(
            'AI search-query generation failed:',
            error
        );

        // Search must continue even if AI query
        // generation fails.
        return claim;
    }
}


/**
 * Search current news using NewsAPI.
 */
export async function searchWeb(
    query: string
): Promise<WebSearchResult[]> {

    const cleanQuery =
        query.trim();

    if (!cleanQuery) {
        console.warn(
            'Web search skipped: empty query'
        );

        return [];
    }

    if (!NEWS_API_KEY) {
        console.error(
            'Web search skipped: NEWS_API_KEY is missing'
        );

        return [];
    }

    try {

        /*
         * First optimize the user's claim.
         */
        const searchQuery =
            await generateSearchQuery(
                cleanQuery
            );

        console.log(
            'Original claim:',
            cleanQuery
        );

        console.log(
            'AI optimized news query:',
            searchQuery
        );


        /*
         * Search NewsAPI using the optimized query.
         */
        const url = new URL(
            'https://newsapi.org/v2/everything'
        );

        url.searchParams.set(
            'q',
            searchQuery
        );

        url.searchParams.set(
            'language',
            'en'
        );

        url.searchParams.set(
            'sortBy',
            'publishedAt'
        );

        url.searchParams.set(
            'pageSize',
            '10'
        );

        url.searchParams.set(
            'apiKey',
            NEWS_API_KEY
        );


        const response =
            await fetch(
                url.toString(),
                {
                    cache: 'no-store',
                }
            );


        if (!response.ok) {

            const errorBody =
                await response.text();

            console.error(
                `NewsAPI error: ${response.status}`,
                errorBody
            );

            return [];
        }


        const data =
            await response.json();


        const results:
            WebSearchResult[] =
            (data.articles ?? [])
                .map(
                    (article: any) => ({
                        title:
                            article.title ||
                            '',

                        url:
                            article.url ||
                            '',

                        snippet:
                            article.description ||
                            article.content ||
                            '',

                        publishedDate:
                            article.publishedAt ||
                            undefined,

                        source:
                            article.source?.name ||
                            undefined,
                    })
                )
                .filter(
                    (
                        result:
                            WebSearchResult
                    ) =>
                        result.title &&
                        result.url
                );


        console.log(
            `NewsAPI returned ${results.length} results`
        );


        console.log(
            'NewsAPI results:',
            results.map(
                (result) => ({
                    title:
                        result.title,

                    source:
                        result.source,

                    publishedDate:
                        result.publishedDate,

                    url:
                        result.url,
                })
            )
        );


        return results;

    } catch (error) {

        console.error(
            'Web search failed:',
            error
        );

        return [];
    }
}