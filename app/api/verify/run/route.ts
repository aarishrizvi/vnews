import { NextResponse } from 'next/server';
import { runVerification } from '@/lib/services/verification';

export async function POST(request: Request) {
  try {
    const { query } = await request.json();
    
    if (!query) {
      return NextResponse.json({ error: "Empty query" }, { status: 400 });
    }

    // Run the verification orchestrator
    const result = await runVerification(query);
    
    return NextResponse.json(result);
  } catch (error) {
    console.error("Verification execution failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
