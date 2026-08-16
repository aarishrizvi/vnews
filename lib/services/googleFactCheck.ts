import { ExternalFactCheck } from '../types';

const API_KEY = process.env.FACT_CHECK_API_KEY;

interface GoogleClaimReview {
  publisher?: { name?: string };
  title?: string;
  textualRating?: string;
  reviewDate?: string;
  url?: string;
}

interface GoogleClaim {
  text?: string;
  claimReview?: GoogleClaimReview[];
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeKey(item: ExternalFactCheck): string {
  return [
    normalize(item.publisher),
    normalize(item.claim),
    normalize(item.rating),
    item.url || '',
  ].join('|');
}

/**
 * Fetch external fact checks and flatten every useful review.
 *
 * Important:
 * Google Fact Check results are evidence, not merely UI metadata.
 * We keep the reviewed claim, publisher, rating, date and URL so the
 * verification engine can evaluate the review itself.
 */
export async function checkGoogleFactCheckAPI(
  query: string
): Promise<ExternalFactCheck[]> {
  if (!API_KEY) {
    console.warn('[FactCheck] FACT_CHECK_API_KEY is missing');
    return [];
  }

  try {
    const url =
      `https://factchecktools.googleapis.com/v1alpha1/claims:search` +
      `?query=${encodeURIComponent(query)}` +
      `&pageSize=10` +
      `&key=${API_KEY}`;

    const response = await fetch(url, {
      cache: 'no-store',
    });

    if (!response.ok) {
      console.error(`[FactCheck] Google API error: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as {
      claims?: GoogleClaim[];
    };

    if (!Array.isArray(data.claims) || data.claims.length === 0) {
      console.log('[FactCheck] No results for:', query);
      return [];
    }

    const flattened: ExternalFactCheck[] = [];

    for (const claim of data.claims) {
      const reviewedClaim = String(claim.text || '').trim();
      if (!reviewedClaim) continue;

      for (const review of claim.claimReview || []) {
        const publisher = String(
          review.publisher?.name || 'Unknown Publisher'
        ).trim();

        flattened.push({
          publisher,
          claim: reviewedClaim,
          title: String(review.title || 'Fact Check Review').trim(),
          rating: String(review.textualRating || 'No Rating').trim(),
          reviewDate: review.reviewDate,
          url: String(review.url || '').trim() || '#',
        });
      }
    }

    const unique = new Map<string, ExternalFactCheck>();

    for (const item of flattened) {
      const key = dedupeKey(item);
      if (!unique.has(key)) unique.set(key, item);
    }

    const results = [...unique.values()].slice(0, 20);

    console.log(
      '[FactCheck] Retrieved external evidence:',
      JSON.stringify(
        results.map((item) => ({
          publisher: item.publisher,
          claim: item.claim,
          rating: item.rating,
          title: item.title,
        }))
      )
    );

    return results;
  } catch (error) {
    console.error('[FactCheck] Failed to query Google Fact Check:', error);
    return [];
  }
}