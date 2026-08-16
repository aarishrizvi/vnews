'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { VerificationStages } from '@/components/VerificationStages';
import { ResultsDisplay } from '@/components/ResultsDisplay';
import { VerificationResult } from '@/lib/types';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, Loader2 } from 'lucide-react';

function SearchResultsContent() {
  const searchParams = useSearchParams();
  const query = searchParams.get('q');

  const [stage, setStage] = useState<'loading_stages' | 'fetching' | 'complete' | 'error'>('loading_stages');
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const requestStartedRef = useRef(false);

  useEffect(() => {
    if (requestStartedRef.current) return;
    requestStartedRef.current = true;

    if (!query) {
      setStage('error');
      setErrorMsg("No query provided.");
      return;
    }

    // Start fetching data in the background while stages animate
    const fetchVerification = async () => {
      try {
        const res = await fetch('/api/verify/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: decodeURIComponent(query) })
        });

        if (!res.ok) {
          if (res.status === 429) throw new Error("RATE_LIMIT");
          throw new Error("Failed to verify");
        }

        if (!res.body) throw new Error("No response body");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || ''; // Keep the last incomplete chunk in the buffer

          for (const chunk of lines) {
            const eventMatch = chunk.match(/event: (.*)\n/);
            const dataMatch = chunk.match(/data: (.*)/);

            if (eventMatch && dataMatch) {
              const event = eventMatch[1];
              const data = JSON.parse(dataMatch[1]);

              if (event === 'initial_result') {
                setResult(data);
                setStage(prev => prev === 'fetching' ? 'complete' : prev);
              } else if (event === 'final_result') {
                setResult(data);
              } else if (event === 'error') {
                if (data.message === 'RATE_LIMIT') throw new Error("RATE_LIMIT");
                throw new Error(data.message);
              }
            }
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        setStage('error');
        if (err.message === "RATE_LIMIT") {
          setErrorMsg("We are currently busy or that's too much research for the day. Please try again later.");
        } else {
          setErrorMsg("Failed to connect to the verification engine.");
        }
      }
    };

    fetchVerification();
  }, [query]);

  const handleStagesComplete = () => {
    if (stage === 'error') return;

    // Once visual stages complete, we check if the actual data is ready.
    if (result) {
      setStage('complete');
    } else {
      setStage('fetching');
    }
  };

  if (!query) return null;

  return (
    <>


      <div className="relative z-10 site-container py-10">
        <AnimatePresence mode="wait">
          {(stage === 'loading_stages' || stage === 'fetching') && (
            <motion.div
              key="stages"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
              transition={{ duration: 0.5 }}
              className="w-full"
            >
              <VerificationStages onComplete={handleStagesComplete} />
              {stage === 'fetching' && (
                <p className="text-center mt-8 text-foreground/40 font-mono text-sm animate-pulse">
                  Awaiting initial response...
                </p>
              )}
            </motion.div>
          )}

          {stage === 'complete' && result && (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="w-full flex flex-col items-center"
            >
              <ResultsDisplay result={result} />

              {/* Background Status Indicator */}
              <AnimatePresence>
                {result.isProvisional && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 glass-panel border-glass-border shadow-2xl px-5 py-3 rounded-full flex items-center gap-4 max-w-sm w-full"
                  >
                    <Loader2 size={16} className="text-foreground/40 animate-spin flex-shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-foreground/80">Checking additional evidence...</p>
                      <p className="text-[10px] text-foreground/40 font-mono mt-0.5">Knowledge Base &middot; Pinecone</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {stage === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="glass-panel p-8 rounded-2xl flex flex-col items-center text-red-400 gap-4 text-center max-w-md mx-auto"
            >
              <AlertCircle size={48} />
              <h3 className="text-xl font-bold">Verification Failed</h3>
              <p className="text-foreground/60">{errorMsg}</p>
              <Link
                href="/"
                className="mt-4 px-6 py-2 glass-card hover:bg-glass-strong rounded-full text-foreground transition-colors inline-block"
              >
                Try Again
              </Link>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

export default function SearchResultsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-[80vh] flex items-center justify-center">
        <Loader2 className="animate-spin text-foreground/30" size={28} />
      </div>
    }>
      <SearchResultsContent />
    </Suspense>
  );
}
