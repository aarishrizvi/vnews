'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { VerifyBar, VerifyState } from '@/components/VerifyBar';
import { InvestigationField } from '@/components/InvestigationField';
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
    <div className="relative flex flex-col items-center justify-center min-h-[88vh] px-5 overflow-hidden">
      <div className="absolute inset-0 overflow-hidden">
        <InvestigationField />
      </div>

      {/* Soft radial center mask — keeps center clean */}
      <div
        className="absolute inset-0 pointer-events-none z-[1]"
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at 50% 50%, transparent 0%, rgba(5,5,8,0.65) 75%)',
        }}
        aria-hidden="true"
      />

      <motion.div
        initial={{ opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-3xl flex flex-col items-center text-center gap-10"
      >
        {/* Identity tag */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5 }}
          className="flex items-center gap-2.5"
        >
        </motion.div>

        {/* Hero headline — two-line display */}
        <div className="space-y-0">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <span
              className="block text-display-xl text-transparent bg-clip-text"
              style={{
                backgroundImage:
                  'linear-gradient(165deg, #ffffff 0%, rgba(255,255,255,0.85) 45%, rgba(255,255,255,0.35) 100%)',
              }}
            >
              VERIFY
            </span>
            <span
              className="block text-display-xl text-transparent bg-clip-text mt-1"
              style={{
                backgroundImage:
                  'linear-gradient(165deg, rgba(255,255,255,0.65) 0%, rgba(255,255,255,0.3) 100%)',
              }}
            >
              WHAT YOU READ.
            </span>
          </motion.h1>
        </div>

        {/* Sub-copy */}
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          className="text-body max-w-md mx-auto text-foreground/45"
        >
          Drop a claim. VNews Lab investigates with live retrieval,
          semantic analysis, and cross-referenced fact checks.
        </motion.p>

        {/* Search bar */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className="w-full"
        >
          <VerifyBar
            onVerify={handleVerify}
            currentState={verifyState}
            errorMessage={errorMessage}
          />
        </motion.div>
      </motion.div>
    </div>
  );
}