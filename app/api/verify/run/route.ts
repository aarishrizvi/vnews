import { runProgressiveVerification } from '@/lib/services/verification';

// Node.js runtime is often required for streaming indefinitely without buffering issues, 
// though Edge is also an option. We'll stick to default or specify node.
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { query } = await request.json();
    
    if (!query) {
      return new Response(JSON.stringify({ error: "Empty query" }), { status: 400 });
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const emit = (event: string, data: any) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        
        try {
          // Run the progressive verification orchestrator
          await runProgressiveVerification(query, emit);
        } catch (error: any) {
          console.error("Verification execution failed", error);
          
          if (error?.status === 429 || 
              error?.message?.toLowerCase().includes('quota') || 
              error?.message?.toLowerCase().includes('limit')) {
            emit('error', { message: "RATE_LIMIT" });
          } else {
            emit('error', { message: error?.message || "Internal server error" });
          }
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      }
    });
  } catch (error: any) {
    console.error("API route error", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
  }
}
