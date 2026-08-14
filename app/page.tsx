'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { VerifyBar, VerifyState } from '@/components/VerifyBar';
import { motion } from 'framer-motion';

export default function Home() {
  const [verifyState, setVerifyState] = useState<VerifyState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const router = useRouter();

  const handleVerify = async (query: string) => {
    setVerifyState('submitted');
    setErrorMessage(undefined);

    setTimeout(async () => {
      setVerifyState('processing');

      try {
        const response = await fetch('/api/verify/intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
        });

        const data = await response.json();

        if (!data.isValidClaim) {
          setVerifyState('error');
          setErrorMessage(data.message);
          setTimeout(() => {
            setVerifyState('idle');
            setErrorMessage(undefined);
          }, 4000);
          return;
        }

        setVerifyState('complete');
        setTimeout(() => {
          router.push(`/results/search?q=${encodeURIComponent(query)}`);
        }, 800);
      } catch {
        setVerifyState('error');
        setErrorMessage('Connection error. Please try again.');
      }
    }, 400);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] px-5">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-3xl flex flex-col items-center text-center gap-10"
      >
        {/* Headline */}
        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.6 }}
            className="text-label"
          >
            AI News Verification
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.7 }}
            className="text-hero text-transparent bg-clip-text bg-gradient-to-br from-white via-white/90 to-white/40"
          >
            Verify what you read.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.6 }}
            className="text-body max-w-lg mx-auto text-foreground/55"
          >
            VNews Lab investigates claims using live retrieval, semantic analysis, and external evidence sources.
          </motion.p>
        </div>

        {/* Search Bar */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.6 }}
          className="w-full"
        >
          <VerifyBar
            onVerify={handleVerify}
            currentState={verifyState}
            errorMessage={errorMessage}
          />
        </motion.div>

        {/* Footer hint */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.6 }}
          className="text-label text-foreground/25"
        >
          Powered by Gemini · Pinecone · Google Fact Check
        </motion.p>
      </motion.div>
    </div>
  );
}
