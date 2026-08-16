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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "INVALID_JSON" }), { status: 400 });
    }

    const { query } = (body && typeof body === 'object' ? body as { query?: unknown } : {});

    // Request Validation
    if (typeof query !== 'string' || !query.trim()) {
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

        const emit = (event: string, data: unknown) => {
          if (isAborted) return;
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        try {
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error("TIMEOUT")), 120000);
          });

          await Promise.race([
            runProgressiveVerification(query, emit),
            timeoutPromise
          ]);
        } catch (error: unknown) {
          console.error("Verification execution failed", error);
          if (isAborted) return;

          const message = error instanceof Error ? error.message : String(error);
          if (message === 'TIMEOUT') {
            emit('error', { message: "TIMEOUT" });
          } else if (
              (error as { status?: number })?.status === 429 ||
              message.toLowerCase().includes('quota') ||
              message.toLowerCase().includes('limit')) {
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
  } catch (error: unknown) {
    console.error("API route error", error);
    return new Response(JSON.stringify({ error: "INTERNAL_ERROR" }), { status: 500 });
  }
}
