import { NextResponse } from 'next/server';
import { checkQueryIntent } from '@/lib/services/intent';

export async function POST(request: Request) {
  try {
    const { query } = await request.json();
    
    if (!query) {
      return NextResponse.json({ isValidClaim: false, message: "Empty query" }, { status: 400 });
    }

    const intent = await checkQueryIntent(query);
    
    return NextResponse.json(intent);
  } catch (error) {
    console.error("Intent check failed", error);
    // Fail open
    return NextResponse.json({ isValidClaim: true });
  }
}
