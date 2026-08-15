'use client';

import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Loader2, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';
import SpecularButton from '@/components/ui/SpecularButton';

export type VerifyState = 'idle' | 'input' | 'submitted' | 'processing' | 'complete' | 'error' | 'cancelled';

interface VerifyBarProps {
  onVerify: (query: string) => void;
  currentState: VerifyState;
  errorMessage?: string;
  className?: string;
}

export function VerifyBar({ onVerify, currentState, errorMessage, className }: VerifyBarProps) {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim() && (currentState === 'idle' || currentState === 'input' || currentState === 'error')) {
      onVerify(query);
    }
  };

  // Determine actual display state to handle input vs idle properly based on focus/content 
  const displayState = currentState === 'idle' && (isFocused || query.length > 0) ? 'input' : currentState;

  // Animation variants 
  const barVariants = {
    idle: { width: '100%', maxWidth: '40rem', height: '4rem', borderRadius: '2rem' },
    input: { width: '100%', maxWidth: '48rem', height: '4.5rem', borderRadius: '1.5rem', scale: 1.02 },
    submitted: { width: '100%', maxWidth: '48rem', height: '4.5rem', borderRadius: '1.5rem', scale: 0.98, opacity: 0.8 },
    processing: { width: '100%', maxWidth: '36rem', height: '4rem', borderRadius: '2rem', y: -20 },
    complete: { width: '100%', maxWidth: '48rem', height: '4.5rem', borderRadius: '1.5rem', borderColor: 'rgba(255, 255, 255, 0.1)' },
    error: { width: '100%', maxWidth: '48rem', height: '4.5rem', borderRadius: '1.5rem', borderColor: 'rgba(248, 113, 113, 0.4)', x: [0, -10, 10, -10, 10, 0] },
    cancelled: { width: '100%', maxWidth: '40rem', height: '4rem', borderRadius: '2rem', opacity: 0.8 }
  };

  const glowVariants = {
    idle: { opacity: 0, scale: 0.8 },
    input: { opacity: 0.5, scale: 1, filter: 'blur(20px)' },
    submitted: { opacity: 0.8, scale: 1.1, filter: 'blur(25px)' },
    processing: { opacity: 1, scale: [1, 1.2, 1], filter: 'blur(30px)', transition: { repeat: Infinity, duration: 2 } },
    complete: { opacity: 0.3, scale: 1, filter: 'blur(20px)', backgroundColor: 'rgba(255, 255, 255, 0.1)' },
    error: { opacity: 0.6, scale: 1, filter: 'blur(20px)', backgroundColor: 'rgba(248, 113, 113, 0.2)' },
    cancelled: { opacity: 0, scale: 0.8 }
  };

  return (
    <div className={twMerge("relative flex flex-col items-center justify-center w-full", className)}>
      {/* Background ambient glow matching the bar state */}
      <motion.div
        className="absolute w-full h-full max-w-2xl bg-indigo-500/20 rounded-full z-0 pointer-events-none"
        variants={glowVariants}
        initial="idle"
        animate={displayState}
        transition={{ duration: 0.5, ease: "easeOut" }}
      />

      <motion.form
        onSubmit={handleSubmit}
        className={clsx(
          "relative z-10 flex items-center min-w-0 w-full overflow-hidden glass-panel backdrop-blur-2xl border transition-colors duration-300",
          {
            'border-glass-border bg-glass-base': displayState === 'idle' || displayState === 'cancelled',
            'border-glass-border-strong bg-glass-strong shadow-[0_0_40px_rgba(99,102,241,0.1)]': displayState === 'input',
            'border-indigo-500/50 bg-indigo-950/40': displayState === 'processing',
            'border-red-500/50 bg-red-950/20': displayState === 'error',
            'border-glass-border-strong bg-glass-strong': displayState === 'complete',
          }
        )}
        variants={barVariants}
        initial="idle"
        animate={displayState}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
      >
        <div className="flex shrink-0 items-center justify-center w-12 sm:w-16 h-full text-foreground/50">
          <AnimatePresence mode="wait">
            {displayState === 'processing' ? (
              <motion.div
                key="processing"
                initial={{ opacity: 0, scale: 0.5, rotate: -90 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={{ opacity: 0, scale: 0.5 }}
                className="animate-spin text-indigo-400"
              >
                <Loader2 size={20} />
              </motion.div>
            ) : displayState === 'complete' ? (
              <motion.div
                key="complete"
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.5 }}
                className="text-foreground/70"
              >
                <CheckCircle size={20} />
              </motion.div>
            ) : displayState === 'error' ? (
              <motion.div
                key="error"
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.5 }}
                className="text-red-400"
              >
                <XCircle size={20} />
              </motion.div>
            ) : (
              <motion.div
                key="search"
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.5 }}
              >
                <Search size={20} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="Drop a claim, headline, or URL to verify..."
          disabled={displayState === 'processing' || displayState === 'submitted'}
          className="min-w-0 flex-1 h-full bg-transparent border-none outline-none text-foreground placeholder:text-foreground/30 text-base sm:text-xl font-medium disabled:opacity-50"
        />

        <AnimatePresence>
          {(displayState === 'input' || displayState === 'error') && query.length > 0 && (
            <motion.div
              initial={{ opacity: 0, x: 20, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20, scale: 0.9 }}
              className="shrink-0 pr-2 flex items-center"
            >
              <SpecularButton
                type="submit"
                size="sm"
                className="font-bold tracking-wider"
              >
                VERIFY
              </SpecularButton>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.form>

      {/* Error Message Display */}
      <AnimatePresence>
        {displayState === 'error' && errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 16 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-full left-0 right-0 flex flex-wrap items-center justify-center gap-2 px-4 text-red-400 text-sm font-medium text-center"
          >
            <AlertCircle size={16} />
            {errorMessage}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}