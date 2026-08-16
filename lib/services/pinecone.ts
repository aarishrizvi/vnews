import { Pinecone } from '@pinecone-database/pinecone';
import { DocumentChunk, RetrievalStatus } from '../types';

export interface PineconeSearchResponse {
  status: RetrievalStatus;
  results: DocumentChunk[];
  diagnostic?: {
    rawCandidateCount: number;
    acceptedCount: number;
    namespace: string;
    scoreThreshold: number;
  };
}

const pineconeApiKey = process.env.PINECONE_API_KEY;

export const pinecone = pineconeApiKey
  ? new Pinecone({ apiKey: pineconeApiKey })
  : null;

export const INDEX_NAME = 'truthlens-index';
export const NAMESPACE = '__default__';

/*
 * BGE Reranker score note:
 *
 * The BGE reranker (bge-reranker-v2-m3) returns raw log-likelihood
 * scores that are NOT bounded to [0, 1].
 * Typical range: -10 to +5 (can be outside this too).
 * A score of 0.35 is extremely HIGH for BGE and will filter
 * almost every candidate — this was the root cause of
 * Pinecone returning empty results.
 *
 * A conservative safe threshold is -3.0 or simply no threshold
 * at all when the reranker itself already limits topN results.
 *
 * We set SCORE_THRESHOLD = -Infinity to disable score filtering
 * and trust the reranker's topN selection instead.
 *
 * Adjust upward (e.g. -2.0) only if you observe consistently
 * irrelevant results passing through.
 */
const SCORE_THRESHOLD = -Infinity;


/**
 * Search the VNews knowledge base.
 *
 * User claim
 *    ↓
 * Pinecone integrated embedding
 *    ↓
 * Semantic candidates  (topK * 2 retrieved)
 *    ↓
 * BGE reranker         (topN = topK kept)
 *    ↓
 * Relevant evidence
 *
 * IMPORTANT: Pinecone is an OPTIONAL RAG source.
 * EMPTY is valid. ERROR means infra failure.
 * Neither situation should collapse into INSUFFICIENT EVIDENCE.
 */
export async function searchPinecone(
  queryText: string,
  topK: number = 5
): Promise<PineconeSearchResponse> {
  if (!pinecone) {
    console.warn('[Pinecone] No API key configured — skipping KB search.');
    return { status: 'EMPTY', results: [] };
  }

  const cleanQuery = queryText.trim();

  if (!cleanQuery) {
    return { status: 'EMPTY', results: [] };
  }

  try {
    const index = pinecone.index(INDEX_NAME);
    const namespace = index.namespace(NAMESPACE);

    /*
     * Retrieve more candidates than we finally need so the
     * reranker has a meaningful pool to re-sort.
     */
    const candidateCount = Math.max(topK * 3, 20);

    console.log(`[Pinecone] Querying index="${INDEX_NAME}" namespace="${NAMESPACE}" topK=${topK} candidatePool=${candidateCount}`);

    const response = await namespace.searchRecords({
      query: {
        topK: candidateCount,
        inputs: {
          text: cleanQuery,
        },
      },

      rerank: {
        model: 'bge-reranker-v2-m3',
        topN: topK,
        rankFields: ['text'],
      },

      fields: [
        'text',
        'documentId',
        'chunkId',
        'title',
        'source',
        'url',
        'date',
        'type',
      ],
    });

    const hits = response.result?.hits ?? [];

    // ── Diagnostic log: candidates BEFORE score filtering ──────────────────
    console.log(`[Pinecone] Raw hits from reranker: ${hits.length}`);
    if (hits.length > 0) {
      console.log('[Pinecone] Candidate details (pre-threshold):');
      hits.forEach((hit, i) => {
        const fields = (hit.fields ?? {}) as Record<string, unknown>;
        console.log(`  [${i}] id=${hit._id} score=${hit._score} title="${fields.title ?? '(no title)'}"`);
      });
    } else {
      console.warn(
        '[Pinecone] Zero candidates returned. Possible causes:\n' +
        '  A. Index is empty — no documents have been ingested yet.\n' +
        `  B. Namespace mismatch — confirm records are in namespace "${NAMESPACE}".\n` +
        '  C. Integrated embedding is not enabled on this index in the Pinecone console.\n' +
        '  D. The rerank model is filtering everything (check if "bge-reranker-v2-m3" is available on your plan).\n' +
        '  → Try ingesting a test document via the admin panel and re-querying.'
      );
    }
    // ───────────────────────────────────────────────────────────────────────

    const results: DocumentChunk[] = [];

    for (const hit of hits) {
      const fields = (hit.fields ?? {}) as Record<string, unknown>;

      const text = String(fields.text ?? '').trim();

      /*
       * A record without text cannot be used for evidence reasoning.
       */
      if (!text) {
        console.warn(`[Pinecone] Skipping hit ${hit._id}: empty text field.`);
        continue;
      }

      const score = hit._score ?? 0;

      /*
       * SCORE_THRESHOLD is set to -Infinity by default.
       * BGE reranker scores are NOT bounded to [0,1].
       * The previous threshold of 0.35 was incorrectly high
       * and was the direct cause of all candidates being filtered out.
       */
      if (score < SCORE_THRESHOLD) {
        console.log(`[Pinecone] Filtered hit ${hit._id} (score=${score} < threshold=${SCORE_THRESHOLD})`);
        continue;
      }

      const result: DocumentChunk = {
        id: hit._id,

        documentId: String(fields.documentId ?? 'unknown'),

        text,

        metadata: {
          title: String(fields.title ?? ''),
          source: String(fields.source ?? ''),
          url: String(fields.url ?? ''),
          date: String(fields.date ?? ''),
          type: String(fields.type ?? 'article'),

          /*
           * BGE reranker relevance score.
           * This is relevance, NOT truth.
           */
          pineconeScore: score,
        },

        score,
      };

      results.push(result);
    }

    // ── Diagnostic log: accepted AFTER score filtering ──────────────────────
    console.log(`[Pinecone] Accepted after threshold: ${results.length} / ${hits.length}`);
    // ────────────────────────────────────────────────────────────────────────

    if (results.length === 0) {
      return {
        status: hits.length === 0 ? 'EMPTY' : 'EMPTY',
        results: [],
        diagnostic: {
          rawCandidateCount: hits.length,
          acceptedCount: 0,
          namespace: NAMESPACE,
          scoreThreshold: SCORE_THRESHOLD,
        },
      };
    }

    return {
      status: 'SUCCESS',
      results,
      diagnostic: {
        rawCandidateCount: hits.length,
        acceptedCount: results.length,
        namespace: NAMESPACE,
        scoreThreshold: SCORE_THRESHOLD,
      },
    };

  } catch (error) {
    console.error('[Pinecone] Search failed:', error);
    return { status: 'ERROR', results: [] };
  }
}


/**
 * Insert article chunks into Pinecone.
 *
 * Pinecone handles embedding automatically via the text field.
 */
export async function insertDocumentChunks(
  chunks: {
    id: string;
    text: string;
    metadata: {
      documentId: string;
      chunkId: string;
      title: string;
      source: string;
      url: string;
      date: string;
      type: string;
    };
  }[]
): Promise<boolean> {
  if (!pinecone) {
    console.warn('[Pinecone] No API key configured — cannot insert chunks.');
    return false;
  }

  if (chunks.length === 0) {
    return true;
  }

  try {
    const index = pinecone.index(INDEX_NAME);
    const namespace = index.namespace(NAMESPACE);

    /*
     * Integrated embedding records.
     * The "text" field is automatically embedded by Pinecone.
     * Do NOT send pre-computed vectors.
     */
    const records = chunks.map((chunk) => ({
      id: chunk.id,
      text: chunk.text,
      documentId: chunk.metadata.documentId,
      chunkId: chunk.metadata.chunkId,
      title: chunk.metadata.title,
      source: chunk.metadata.source,
      url: chunk.metadata.url,
      date: chunk.metadata.date,
      type: chunk.metadata.type,
    }));

    const BATCH_SIZE = 96;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      await namespace.upsertRecords({ records: batch });
      console.log(`[Pinecone] Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} records to namespace="${NAMESPACE}"`);
    }

    console.log(`[Pinecone] Indexed ${records.length} text records into "${INDEX_NAME}" / "${NAMESPACE}".`);

    return true;

  } catch (error) {
    console.error('[Pinecone] Insert failed:', error);
    throw error;
  }
}


/**
 * Delete every chunk belonging to a document.
 */
export async function deleteDocumentVectors(
  documentId: string
): Promise<boolean> {
  if (!pinecone) {
    console.warn('[Pinecone] No API key configured — cannot delete document.');
    return false;
  }

  const cleanDocumentId = documentId.trim();

  if (!cleanDocumentId) {
    return false;
  }

  try {
    const index = pinecone.index(INDEX_NAME);
    const namespace = index.namespace(NAMESPACE);

    await namespace.deleteMany({
      filter: {
        documentId: {
          $eq: cleanDocumentId,
        },
      },
    });

    console.log(`[Pinecone] Deleted document "${cleanDocumentId}" from namespace="${NAMESPACE}".`);

    return true;

  } catch (error) {
    console.error('[Pinecone] Delete failed:', error);
    throw error;
  }
}