import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/firebase/serverAuth';
import { deleteDocumentVectors } from '@/lib/services/pinecone';

export async function DELETE(req: NextRequest) {
  // 1. Verify admin identity
  try {
    await requireAdmin(req);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }

  // 2. Parse the documentId from the request body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { documentId } = body;
  if (!documentId) {
    return NextResponse.json({ error: 'documentId is required.' }, { status: 400 });
  }

  // 3. Delete all Pinecone vectors associated with this documentId
  try {
    await deleteDocumentVectors(documentId);
  } catch (err: any) {
    return NextResponse.json({ error: `Pinecone deletion failed: ${err.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, documentId });
}
