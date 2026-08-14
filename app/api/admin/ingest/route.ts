import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/firebase/serverAuth';
import { generateEmbedding, insertDocumentChunks } from '@/lib/services/pinecone';

// --- Text Chunking ---
function chunkText(text: string, chunkSize = 600, overlap = 100): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim().length > 0) {
      chunks.push(chunk.trim());
    }
    i += chunkSize - overlap;
  }
  return chunks;
}

// --- Deterministic Document ID ---
function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 64);
}

export async function POST(req: NextRequest) {
  // 1. Verify admin identity
  try {
    await requireAdmin(req);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }

  // 2. Parse request body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { title, source, url, date, type, text } = body;
  if (!title || !text) {
    return NextResponse.json({ error: 'Title and text are required.' }, { status: 400 });
  }

  // 3. Generate deterministic document ID from title+date
  const documentId = `doc-${slugify(title)}-${slugify(date || 'undated')}`;

  // 4. Chunk the article text
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    return NextResponse.json({ error: 'Text produced no valid chunks.' }, { status: 400 });
  }

  // 5. Embed each chunk and build Pinecone vectors
  const vectors = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i];
    const embedding = await generateEmbedding(chunkText);

    vectors.push({
      id: `${documentId}::chunk-${i}`,
      values: embedding,
      metadata: {
        documentId,
        chunkId: `chunk-${i}`,
        title,
        source: source || '',
        url: url || '',
        date: date || '',
        type: type || 'article',
        text: chunkText,
      }
    });
  }

  // 6. Upsert into Pinecone
  await insertDocumentChunks(vectors);

  // 7. Save metadata to Firestore
  const { db } = await import('@/lib/firebase/config');
  const { collection, addDoc } = await import('firebase/firestore');
  if (db) {
    try {
      await addDoc(collection(db, 'knowledge'), {
        documentId,
        title,
        source: source || '',
        url: url || '',
        date: date || '',
        type: type || 'article',
        chunkCount: vectors.length,
        createdAt: Date.now(),
        preview: text.slice(0, 200) + (text.length > 200 ? '...' : ''),
        status: 'indexed',
      });
    } catch (fsError: any) {
      console.error("Firestore write failed inside ingest route:", fsError);
      return NextResponse.json({ error: `Pinecone indexed but Firestore write failed: ${fsError.message}` }, { status: 500 });
    }
  } else {
    console.warn("Firestore db client not initialized on server.");
  }

  return NextResponse.json({
    success: true,
    documentId,
    chunkCount: vectors.length
  });
}
