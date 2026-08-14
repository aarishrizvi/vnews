'use client';

import { VerificationResult } from '@/lib/types';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ShieldCheck, ShieldAlert, ShieldQuestion, HelpCircle,
  ExternalLink, Database, Globe,
} from 'lucide-react';

export function ResultsDisplay({ result }: { result: VerificationResult }) {

  const getVerdictConfig = (verdict: string) => {
    switch (verdict) {
      case 'TRUE':
        return {
          color: 'text-emerald-400',
          border: 'border-emerald-500/25',
          bg: 'bg-emerald-500/10',
          bar: 'bg-emerald-500',
          icon: ShieldCheck,
          label: 'True',
        };
      case 'FALSE':
        return {
          color: 'text-red-400',
          border: 'border-red-500/25',
          bg: 'bg-red-500/10',
          bar: 'bg-red-500',
          icon: ShieldAlert,
          label: 'False',
        };
      case 'MIXED':
        return {
          color: 'text-amber-400',
          border: 'border-amber-500/25',
          bg: 'bg-amber-500/10',
          bar: 'bg-amber-500',
          icon: ShieldQuestion,
          label: 'Mixed',
        };
      default:
        return {
          color: 'text-slate-400',
          border: 'border-slate-500/25',
          bg: 'bg-slate-500/10',
          bar: 'bg-slate-500',
          icon: HelpCircle,
          label: 'Insufficient Evidence',
        };
    }
  };

  const config = getVerdictConfig(result.verdict);
  const Icon = config.icon;
  const confidence = Math.round(result.confidence * 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-4xl mx-auto space-y-6 pb-20"
    >
      {/* ── Verdict Card ───────────────────────── */}
      <div className={`glass-panel rounded-2xl border ${config.border} overflow-hidden`}>
        {/* Accent bar */}
        <div className={`h-0.5 w-full ${config.bg} opacity-60`} />

        <div className="p-6 md:p-8">
          {/* Claim */}
          <div className="mb-6">
            <p className="text-label mb-2">Claim Investigated</p>
            <p className="text-heading leading-snug text-foreground/90">
              &ldquo;{result.claim}&rdquo;
            </p>
          </div>

          {/* Verdict + Confidence */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 mb-6">
            <div className={`flex items-center gap-3 px-5 py-3 rounded-xl border ${config.border} ${config.bg}`}>
              <Icon size={22} className={config.color} />
              <span className={`text-subheading tracking-widest uppercase ${config.color}`}>
                {config.label}
              </span>
            </div>

            {/* Confidence bar */}
            <div className="flex-1 min-w-[180px]">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-label">Confidence</span>
                <span className={`text-label ${config.color}`}>{confidence}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/[0.06]">
                <motion.div
                  className={`h-full rounded-full ${config.bar} opacity-70`}
                  initial={{ width: 0 }}
                  animate={{ width: `${confidence}%` }}
                  transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
            </div>
          </div>

          {/* Analysis */}
          <div className="pt-5 border-t border-glass-border">
            <p className="text-label mb-3">AI Analysis</p>
            <p className="text-body leading-relaxed">{result.analysis}</p>
          </div>
        </div>
      </div>

      {/* ── Evidence Grid ─────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

        {/* Local Evidence */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <Database size={14} className="text-indigo-400" />
            <h3 className="text-subheading">Knowledge Base Evidence</h3>
          </div>

          <div className="space-y-3">
            {result.supportingEvidence.map(source => (
              <div key={source.id} className="glass-card p-4 border-l-2 border-l-emerald-500/50">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h4 className="text-subheading text-emerald-100 leading-snug">{source.title}</h4>
                  <span className="text-label text-emerald-400 border border-emerald-500/20 rounded px-1.5 py-0.5 flex-shrink-0">
                    Support
                  </span>
                </div>
                <p className="text-body-sm line-clamp-3">{source.snippet}</p>
              </div>
            ))}

            {result.contradictingEvidence.map(source => (
              <div key={source.id} className="glass-card p-4 border-l-2 border-l-red-500/50">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h4 className="text-subheading text-red-100 leading-snug">{source.title}</h4>
                  <span className="text-label text-red-400 border border-red-500/20 rounded px-1.5 py-0.5 flex-shrink-0">
                    Contradicts
                  </span>
                </div>
                <p className="text-body-sm line-clamp-3">{source.snippet}</p>
              </div>
            ))}

            {result.supportingEvidence.length === 0 && result.contradictingEvidence.length === 0 && (
              <div className="glass-card p-5 text-center text-foreground/35 text-body-sm">
                No matching documents found in the local knowledge base.
              </div>
            )}
          </div>
        </div>

        {/* External Fact Checks */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <Globe size={14} className="text-blue-400" />
            <h3 className="text-subheading">External Fact Checks</h3>
          </div>

          <div className="space-y-3">
            {result.externalFactChecks.map((fc, i) => (
              <a
                key={i}
                href={fc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block glass-card p-4 hover:bg-glass-strong transition-colors group"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-label text-blue-400">{fc.publisher}</span>
                  <ExternalLink size={12} className="opacity-0 group-hover:opacity-60 transition-opacity text-foreground/50 mt-0.5" />
                </div>
                <h4 className="text-subheading text-foreground/85 mb-2 leading-snug">{fc.title}</h4>
                <span className="inline-block text-label border border-glass-border rounded px-2 py-0.5 text-foreground/60">
                  {fc.rating}
                </span>
              </a>
            ))}

            {result.externalFactChecks.length === 0 && (
              <div className="glass-card p-5 text-center text-foreground/35 text-body-sm">
                No matching external fact checks found.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Footer Actions ─────────────────────── */}
      <div className="flex justify-center gap-3 pt-4">
        <Link
          href="/"
          className="btn-primary inline-block text-center"
        >
          New Verification
        </Link>
      </div>
    </motion.div>
  );
}
