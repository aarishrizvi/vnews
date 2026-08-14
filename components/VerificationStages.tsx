'use client';

import { motion } from 'framer-motion';
import { CheckCircle2, Loader2, Circle } from 'lucide-react';
import { useEffect, useState } from 'react';

const STAGES = [
  'Understanding Claim',
  'Generating Embedding',
  'Searching Knowledge Base',
  'Checking External Fact Checks',
  'Analysing Evidence',
  'Generating Verdict',
];

export function VerificationStages({ onComplete }: { onComplete: () => void }) {
  const [currentStage, setCurrentStage] = useState(0);

  useEffect(() => {
    if (currentStage >= STAGES.length) {
      setTimeout(onComplete, 500);
      return;
    }

    const timer = setTimeout(() => {
      setCurrentStage(prev => prev + 1);
    }, Math.random() * 800 + 600);

    return () => clearTimeout(timer);
  }, [currentStage, onComplete]);

  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="glass-panel rounded-2xl p-6 md:p-8">
        <p className="text-label mb-5">Processing</p>
        <div className="space-y-3">
          {STAGES.map((stage, index) => {
            const isCompleted = index < currentStage;
            const isActive = index === currentStage;

            return (
              <motion.div
                key={stage}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.08, duration: 0.4 }}
                className="flex items-center gap-3"
              >
                <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                  {isCompleted ? (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                      className="text-emerald-400"
                    >
                      <CheckCircle2 size={18} />
                    </motion.div>
                  ) : isActive ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-indigo-400"
                    >
                      <Loader2 size={18} className="animate-spin" />
                    </motion.div>
                  ) : (
                    <Circle size={18} className="text-foreground/20" />
                  )}
                </div>

                <span
                  className={`text-sm transition-colors duration-300 ${
                    isCompleted
                      ? 'text-foreground/40'
                      : isActive
                      ? 'text-foreground font-medium'
                      : 'text-foreground/25'
                  }`}
                >
                  {stage}
                </span>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
