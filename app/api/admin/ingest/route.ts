import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/firebase/serverAuth';
import { insertDocumentChunks } from '@/lib/services/pinecone';

// --- Text Chunking ---
function chunkText(
  text: string,
  chunkSize = 600,
  overlap = 100
): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];

  let i = 0;

  while (i < words.length) {
    const chunk = words
      .slice(i, i + chunkSize)
      .join(' ')
      .trim();

    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    i += chunkSize - overlap;
  }

  return chunks;
}

// --- Deterministic Document ID ---
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 64);
}

export async function POST(req: NextRequest) {
  // 1. Verify admin identity
  try {
    await requireAdmin(req);
  } catch (err: any) {
    return NextResponse.json(
      {
        error: err.message,
      },
      {
        status: 401,
      }
    );
  }

  // 2. Parse request body
  let body: any;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        error: 'Invalid JSON body',
      },
      {
        status: 400,
      }
    );
  }

  const {
    title,
    source,
    url,
    date,
    type,
    text,
  } = body;

  // 3. Validate input
  if (!title || !text) {
    return NextResponse.json(
      {
        error: 'Title and text are required.',
      },
      {
        status: 400,
      }
    );
  }

  // 4. Generate deterministic document ID
  const documentId =
    `doc-${slugify(title)}-${slugify(date || 'undated')}`;

  // 5. Chunk article
  const chunks = chunkText(text);

  if (chunks.length === 0) {
    return NextResponse.json(
      {
        error: 'Text produced no valid chunks.',
      },
      {
        status: 400,
      }
    );
  }

  /*
   * ---------------------------------------------------------
   * BUILD PINECONE TEXT RECORDS
   * ---------------------------------------------------------
   *
   * IMPORTANT:
   *
   * This Pinecone index uses integrated embedding.
   *
   * We DO NOT:
   *
   * - generate Gemini embeddings
   * - generate vectors
   * - send "values"
   *
   * Pinecone receives the raw article text and handles
   * embedding using llama-text-embed-v2.
   */

  const records = chunks.map((chunk, i) => ({
    id: `${documentId}::chunk-${i}`,

    text: chunk,

    metadata: {
      documentId,
      chunkId: `chunk-${i}`,
      title,
      source: source || '',
      url: url || '',
      date: date || '',
      type: type || 'article',
    },
  }));

  /*
   * ---------------------------------------------------------
   * PINECONE
   * ---------------------------------------------------------
   */

  try {
    const indexed = await insertDocumentChunks(records);

    if (!indexed) {
      return NextResponse.json(
        {
          error:
            'Pinecone is not configured or indexing failed.',
        },
        {
          status: 500,
        }
      );
    }
  } catch (error: any) {
    console.error(
      'Pinecone indexing failed:',
      error
    );

    return NextResponse.json(
      {
        error:
          error?.message ||
          'Failed to index document in Pinecone.',
      },
      {
        status: 500,
      }
    );
  }

  /*
   * ---------------------------------------------------------
   * FIRESTORE METADATA
   * ---------------------------------------------------------
   */

  const { db } =
    await import('@/lib/firebase/config');

  const {
    collection,
    addDoc,
  } = await import('firebase/firestore');

  if (db) {
    try {
      await addDoc(
        collection(db, 'knowledge'),
        {
          documentId,
          title,
          source: source || '',
          url: url || '',
          date: date || '',
          type: type || 'article',

          chunkCount: records.length,

          createdAt: Date.now(),

          preview:
            text.slice(0, 200) +
            (text.length > 200
              ? '...'
              : ''),

          status: 'indexed',
        }
      );
    } catch (fsError: any) {
      console.error(
        'Firestore write failed:',
        fsError
      );

      return NextResponse.json(
        {
          error:
            `Pinecone indexed but Firestore write failed: ${fsError.message}`,
        },
        {
          status: 500,
        }
      );
    }
  } else {
    console.warn(
      'Firestore db client not initialized.'
    );
  }

  /*
   * ---------------------------------------------------------
   * SUCCESS
   * ---------------------------------------------------------
   */

  return NextResponse.json({
    success: true,
    documentId,
    chunkCount: records.length,
  });
}