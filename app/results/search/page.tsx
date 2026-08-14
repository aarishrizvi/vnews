'use client';

import { useEffect, useState, Suspense } from 'react';
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

  useEffect(() => {
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
        
        if (!res.ok) throw new Error("Failed to verify");
        
        const data = await res.json();
        setResult(data);
        setStage(prev => prev === 'fetching' ? 'complete' : prev);
      } catch {
        setStage('error');
        setErrorMsg("Failed to connect to the verification engine.");
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
    <div className="container mx-auto px-4 py-12 min-h-[80vh] flex flex-col items-center justify-center">
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
                Awaiting final LLM response...
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
            className="w-full"
          >
            <ResultsDisplay result={result} />
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
