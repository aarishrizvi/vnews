import { ExternalFactCheck } from '../types';

const API_KEY = process.env.FACT_CHECK_API_KEY;

export async function checkGoogleFactCheckAPI(query: string): Promise<ExternalFactCheck[]> {
  if (!API_KEY) {
    console.warn("No GOOGLE_API_KEY provided for Fact Check API.");
    return [];
  }

  try {
    const url = `https://factchecktools.googleapis.com/v1alpha1/claims:search?query=${encodeURIComponent(query)}&key=${API_KEY}`;
    
    const response = await fetch(url, {
      next: { revalidate: 3600 } // Cache for an hour
    });

    if (!response.ok) {
      console.error(`Google Fact Check API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    
    if (!data.claims || data.claims.length === 0) {
      return [];
    }

    interface GoogleClaim {
      text: string;
      claimReview?: Array<{
        publisher?: { name: string };
        title?: string;
        textualRating?: string;
        reviewDate?: string;
        url?: string;
      }>;
    }

    return data.claims.slice(0, 3).map((claim: GoogleClaim) => {
      const review = claim.claimReview?.[0];
      return {
        publisher: review?.publisher?.name || 'Unknown Publisher',
        claim: claim.text,
        title: review?.title || 'Fact Check Review',
        rating: review?.textualRating || 'No Rating',
        reviewDate: review?.reviewDate,
        url: review?.url || '#'
      };
    });

  } catch (error) {
    console.error("Failed to query Google Fact Check:", error);
    return [];
  }
}
