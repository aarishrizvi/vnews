import { runProgressiveVerification } from '@/lib/services/verification';

export const runtime = 'nodejs';

// In-memory rate limiting map for basic protection
// In production, use Redis or similar
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

export async function POST(request: Request) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown';
    const now = Date.now();
    const rateData = rateLimitMap.get(ip);

    if (rateData) {
      if (now > rateData.resetTime) {
        rateLimitMap.set(ip, { count: 1, resetTime: now + 60000 }); // 1 minute window
      } else {
        if (rateData.count >= 10) { // 10 requests per minute
          return new Response(JSON.stringify({ error: "RATE_LIMIT" }), { status: 429 });
        }
        rateData.count++;
      }
    } else {
      rateLimitMap.set(ip, { count: 1, resetTime: now + 60000 });
    }

    const { query } = await request.json();
    
    // Request Validation
    if (!query || typeof query !== 'string') {
      return new Response(JSON.stringify({ error: "INVALID_CLAIM" }), { status: 400 });
    }
    
    // Maximum query length
    if (query.trim().length > 300) {
      return new Response(JSON.stringify({ error: "INVALID_CLAIM", message: "Claim is too long. Please provide a concise claim." }), { status: 400 });
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let isAborted = false;
        
        // Handle client disconnect
        request.signal.addEventListener('abort', () => {
          isAborted = true;
          controller.close();
        });

        const emit = (event: string, data: any) => {
          if (isAborted) return;
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        
        try {
          // Timeout promise for the whole verification process (e.g. 45 seconds)
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error("TIMEOUT")), 45000);
          });
          
          await Promise.race([
            runProgressiveVerification(query, emit),
            timeoutPromise
          ]);
        } catch (error: any) {
          console.error("Verification execution failed", error);
          if (isAborted) return;
          
          if (error?.message === 'TIMEOUT') {
            emit('error', { message: "TIMEOUT" });
          } else if (error?.status === 429 || 
              error?.message?.toLowerCase().includes('quota') || 
              error?.message?.toLowerCase().includes('limit')) {
            emit('error', { message: "RATE_LIMIT" });
          } else {
            emit('error', { message: "INTERNAL_ERROR" });
          }
        } finally {
          if (!isAborted) {
            controller.close();
          }
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
    return new Response(JSON.stringify({ error: "INTERNAL_ERROR" }), { status: 500 });
  }
}
