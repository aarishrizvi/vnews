import { NextResponse } from 'next/server';
import { checkQueryIntent } from '@/lib/services/intent';

export async function POST(request: Request) {
  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ isValidClaim: false, message: 'Malformed JSON body.' }, { status: 400 });
    }

    const { query } = (body && typeof body === 'object' ? body as { query?: unknown } : {});

    if (typeof query !== 'string' || !query.trim()) {
      return NextResponse.json({ isValidClaim: false, message: 'Empty query' }, { status: 400 });
    }

    const intent = await checkQueryIntent(query);

    return NextResponse.json(intent);
  } catch (error) {
    console.error('Intent check failed', error);
    return NextResponse.json({ isValidClaim: false, message: 'Unable to evaluate this claim.' }, { status: 500 });
  }
}
