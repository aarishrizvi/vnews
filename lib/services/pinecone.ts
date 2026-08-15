import { Pinecone } from '@pinecone-database/pinecone';
import { DocumentChunk } from '../types';

const pineconeApiKey = process.env.PINECONE_API_KEY;

export const pinecone = pineconeApiKey
  ? new Pinecone({ apiKey: pineconeApiKey })
  : null;

export const INDEX_NAME = 'truthlens-index';
export const NAMESPACE = '__default__';

/*
 * Pinecone Integrated Embedding
 *
 * Model:
 * llama-text-embed-v2
 *
 * Field:
 * text
 *
 * We do NOT generate embeddings ourselves.
 * Pinecone embeds both documents and queries.
 */


/**
 * Search the VNews knowledge base.
 *
 * User claim
 *    ↓
 * Pinecone integrated embedding
 *    ↓
 * Semantic candidates
 *    ↓
 * BGE reranker
 *    ↓
 * Relevant evidence
 */
export async function searchPinecone(
  queryText: string,
  topK: number = 5
): Promise<DocumentChunk[]> {
  if (!pinecone) {
    console.warn(
      'No Pinecone API key, returning empty results'
    );

    return [];
  }

  const cleanQuery = queryText.trim();

  if (!cleanQuery) {
    return [];
  }

  try {
    const index = pinecone.index(INDEX_NAME);
    const namespace = index.namespace(NAMESPACE);

    /*
     * Retrieve more candidates than we finally need.
     */
    const candidateCount = Math.max(
      topK * 2,
      10
    );

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

    console.log(
      'Pinecone candidates:',
      hits.map((hit) => {
        const fields =
          (hit.fields ?? {}) as Record<
            string,
            unknown
          >;

        return {
          id: hit._id,
          score: hit._score,
          title: fields.title,
        };
      })
    );

    /*
     * Build results without returning null from map().
     *
     * This avoids the TypeScript issue caused by:
     *
     * map(...) -> DocumentChunk | null
     */
    const results: DocumentChunk[] = [];

    for (const hit of hits) {
      const fields =
        (hit.fields ?? {}) as Record<
          string,
          unknown
        >;

      const text = String(
        fields.text ?? ''
      ).trim();

      /*
       * A record without text cannot be useful
       * to VNews, so skip it.
       */
      if (!text) {
        continue;
      }

      const result: DocumentChunk = {
        id: hit._id,

        documentId: String(
          fields.documentId ?? 'unknown'
        ),

        text,

        metadata: {
          title: String(
            fields.title ?? ''
          ),

          source: String(
            fields.source ?? ''
          ),

          url: String(
            fields.url ?? ''
          ),

          date: String(
            fields.date ?? ''
          ),

          type: String(
            fields.type ?? 'article'
          ),

          /*
           * This is the reranker relevance score.
           *
           * It is NOT a truth score.
           */
          pineconeScore: hit._score ?? 0,
        },

        score: hit._score ?? 0,
      };

      results.push(result);
    }

    console.log(
      'Pinecone accepted:',
      results.map((result) => ({
        id: result.id,
        score: result.score,
        title: result.metadata?.title,
      }))
    );

    return results;

  } catch (error) {
    console.error(
      'Pinecone search failed:',
      error
    );

    return [];
  }
}


/**
 * Insert article chunks into Pinecone.
 *
 * Pinecone handles embedding automatically.
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
    console.warn(
      'No Pinecone API key, cannot insert chunks.'
    );

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
     *
     * The "text" field is embedded by Pinecone.
     */
    const records = chunks.map((chunk) => ({
      id: chunk.id,

      text: chunk.text,

      documentId:
        chunk.metadata.documentId,

      chunkId:
        chunk.metadata.chunkId,

      title:
        chunk.metadata.title,

      source:
        chunk.metadata.source,

      url:
        chunk.metadata.url,

      date:
        chunk.metadata.date,

      type:
        chunk.metadata.type,
    }));

    /*
     * Keep batches comfortably sized.
     */
    const BATCH_SIZE = 96;

    for (
      let i = 0;
      i < records.length;
      i += BATCH_SIZE
    ) {
      const batch = records.slice(
        i,
        i + BATCH_SIZE
      );

      await namespace.upsertRecords({
        records: batch,
      });
    }

    console.log(
      `Pinecone: indexed ${records.length} text records.`
    );

    return true;

  } catch (error) {
    console.error(
      'Pinecone insert failed:',
      error
    );

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
    console.warn(
      'No Pinecone API key, cannot delete document.'
    );

    return false;
  }

  const cleanDocumentId =
    documentId.trim();

  if (!cleanDocumentId) {
    return false;
  }

  try {
    const index = pinecone.index(INDEX_NAME);
    const namespace = index.namespace(NAMESPACE);

    /*
     * Pinecone deleteMany expects the metadata
     * condition inside a filter object.
     */
    await namespace.deleteMany({
      filter: {
        documentId: {
          $eq: cleanDocumentId,
        },
      },
    });

    console.log(
      `Pinecone: deleted document ${cleanDocumentId}`
    );

    return true;

  } catch (error) {
    console.error(
      'Pinecone delete failed:',
      error
    );

    throw error;
  }
}