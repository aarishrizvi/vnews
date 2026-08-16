'use client';

import { VerificationResult, Source } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  ShieldCheck, ShieldAlert, ShieldQuestion, HelpCircle,
  ExternalLink, Database, Globe, MapPin, ArrowLeft, RotateCcw,
} from 'lucide-react';
import { AnimatedList } from '@/components/ui/AnimatedList';
import SpecularButton from '@/components/ui/SpecularButton';
import { useEffect, useState } from 'react';

function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const start = display;
    const end = value;
    if (start === end) return;

    const duration = 800;
    const startTime = performance.now();

    let rafId: number;
    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + (end - start) * eased));
      if (progress < 1) {
        rafId = requestAnimationFrame(step);
      }
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <span>{display}</span>;
}

// ── Verdict configuration ────────────────────────────────────────────────────

function getVerdictConfig(verdict: string) {
  switch (verdict) {
    case 'TRUE':
      return {
        color: 'text-emerald-400',
        colorHex: '#34d399',
        border: 'border-emerald-500/20',
        bg: 'bg-emerald-500/[0.08]',
        glow: '0 0 60px rgba(52,211,153,0.12)',
        bar: 'bg-emerald-500',
        icon: ShieldCheck,
        label: 'TRUE',
      };
    case 'FALSE':
      return {
        color: 'text-red-400',
        colorHex: '#f87171',
        border: 'border-red-500/20',
        bg: 'bg-red-500/[0.08]',
        glow: '0 0 60px rgba(248,113,113,0.12)',
        bar: 'bg-red-500',
        icon: ShieldAlert,
        label: 'FALSE',
      };
    case 'MIXED':
      return {
        color: 'text-amber-400',
        colorHex: '#fbbf24',
        border: 'border-amber-500/20',
        bg: 'bg-amber-500/[0.08]',
        glow: '0 0 60px rgba(251,191,36,0.10)',
        bar: 'bg-amber-500',
        icon: ShieldQuestion,
        label: 'MIXED',
      };
    default:
      return {
        color: 'text-slate-400',
        colorHex: '#94a3b8',
        border: 'border-slate-500/20',
        bg: 'bg-slate-500/[0.08]',
        glow: '0 0 40px rgba(148,163,184,0.08)',
        bar: 'bg-slate-500',
        icon: HelpCircle,
        label: 'INSUFFICIENT EVIDENCE',
      };
  }
}

// ── Evidence card ────────────────────────────────────────────────────────────

function EvidenceCard({ source, type }: { source: Source; type: 'support' | 'contradict' }) {
  const isDirect = source.relevance === 'DIRECT';
  
  const accent = type === 'support' 
    ? (isDirect ? 'border-l-emerald-500/50 bg-emerald-500/[0.03]' : 'border-l-emerald-500/30 bg-white/[0.02]')
    : (isDirect ? 'border-l-red-500/50 bg-red-500/[0.03]' : 'border-l-red-500/30 bg-white/[0.02]');
    
  const badge = type === 'support'
    ? (isDirect ? 'text-emerald-400 border-emerald-500/20' : 'text-emerald-400/70 border-emerald-500/10')
    : (isDirect ? 'text-red-400 border-red-500/20' : 'text-red-400/70 border-red-500/10');
    
  const badgeLabel = source.relevance === 'RELATED' || source.relevance === 'TOPICAL'
    ? 'CONTEXT ONLY'
    : (type === 'support' ? 'SUPPORTS CLAIM' : 'CONTRADICTS CLAIM');

  const inner = (
    <div className={`bento-card border-l-4 ${accent} p-5 group`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-foreground/90 leading-snug line-clamp-2">
            {source.title || 'Document Extract'}
          </h4>
          {source.publicationDate && (
            <p className="text-[10px] font-mono text-foreground/30 mt-1">{source.publicationDate}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[9px] font-bold tracking-widest border rounded px-1.5 py-0.5 ${badge}`}>
            {badgeLabel}
          </span>
          {source.url && (
            <ExternalLink size={11} className="text-foreground/30 group-hover:text-foreground/60 transition-colors" />
          )}
        </div>
      </div>
      {source.snippet && (
        <p className="text-xs text-foreground/55 leading-relaxed line-clamp-3">{source.snippet}</p>
      )}
      {typeof source.retrievalScore === 'number' && (
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 h-0.5 bg-white/[0.05] rounded-full">
            <div
              className="h-full bg-indigo-400/40 rounded-full"
              style={{ width: `${Math.round(source.retrievalScore * 100)}%` }}
            />
          </div>
          <span className="text-[9px] font-mono text-foreground/25">
            {Math.round(source.retrievalScore * 100)}% match
          </span>
        </div>
      )}
    </div>
  );

  return source.url ? (
    <a href={source.url} target="_blank" rel="noopener noreferrer" className="block">
      {inner}
    </a>
  ) : inner;
}

// ── Main component ───────────────────────────────────────────────────────────

export function ResultsDisplay({ result }: { result: VerificationResult }) {
  const router = useRouter();
  const config = getVerdictConfig(result.verdict);
  const VerdictIcon = config.icon;
  const confidence = Math.round(result.confidence * 100);
  const hasKB = result.supportingEvidence.length > 0 || result.contradictingEvidence.length > 0;
  const hasFC = result.externalFactChecks.length > 0;
  const hasOrigin = !!result.sourceOrigin;

  return (
    <div className="w-full pb-20">
      {/* Header bar */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-center justify-between mb-8"
      >
        <div className="flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span className="text-label text-foreground/30 tracking-[0.2em]">INVESTIGATION COMPLETE</span>
        </div>
        <button
          onClick={() => router.push('/')}
          className="flex items-center gap-1.5 text-xs text-foreground/35 hover:text-foreground/70 transition-colors"
        >
          <ArrowLeft size={12} />
          New Claim
        </button>
      </motion.div>

      {/* ── Desktop two-column / Mobile single-column ─────────────────────── */}
      <div className="flex flex-col xl:flex-row xl:items-start gap-5 xl:gap-8">

        {/* ── LEFT: Primary Report ─────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          <AnimatedList delay={420} className="gap-5">

            {/* 1. Claim */}
            <div key="claim" className="bento-card p-7 md:p-9">
              <p className="text-label mb-5 text-foreground/30">CLAIM INVESTIGATED</p>
              <blockquote className="text-xl md:text-2xl font-semibold text-foreground/90 leading-snug tracking-tight">
                &ldquo;{result.claim}&rdquo;
              </blockquote>
            </div>

            {/* 2. Verdict */}
            <div
              key="verdict"
              className={`bento-card ${config.border} ${config.bg} p-7 md:p-9 overflow-hidden relative`}
              style={{ boxShadow: config.glow }}
            >
              <div className={`absolute top-0 left-0 right-0 h-px ${config.bar} opacity-30`} />
              <div className="flex flex-col md:flex-row md:items-center gap-6 md:gap-10 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <VerdictIcon size={18} className={config.color} />
                    <p className="text-label text-foreground/30">VERDICT</p>
                  </div>
                  <motion.div
                    className={`text-verdict-xl ${config.color} mt-2 flex flex-col items-start gap-2 md:flex-row md:items-center md:gap-4 min-w-0`}
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <span className="min-w-0">{config.label}</span>
                    {result.isProvisional && (
                      <span className="text-[10px] font-bold tracking-[0.15em] border border-current px-2 py-0.5 rounded-full opacity-60 whitespace-nowrap shrink-0">
                        PROVISIONAL
                      </span>
                    )}
                  </motion.div>
                </div>
                <div className="w-full min-w-0 md:w-52">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-label text-foreground/30">CONFIDENCE</p>
                    <motion.span
                      className={`text-3xl font-extrabold tracking-tight ${config.color}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.2, duration: 0.4 }}
                    >
                      <AnimatedNumber value={confidence} />%
                    </motion.span>
                  </div>
                  <div className="h-1 w-full rounded-full bg-white/[0.06]">
                    <motion.div
                      className={`h-full rounded-full ${config.bar} opacity-60`}
                      initial={{ width: 0 }}
                      animate={{ width: `${confidence}%` }}
                      transition={{ duration: 0.9, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </div>
                </div>
                {result.isProvisional && (
                  <div className="w-full text-xs text-foreground/40 font-mono">
                    Additional evidence is being checked. Assessment may update.
                  </div>
                )}
              </div>
            </div>

            {/* 3. AI Analysis */}
            <div key="analysis" className="bento-card p-7 md:p-9">
              <div className="flex items-center gap-2 mb-5">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400/70" />
                <p className="text-label text-foreground/30">AI ANALYSIS</p>
              </div>
              <p className="text-[15px] text-foreground/80 leading-[1.75]">{result.analysis}</p>
            </div>

            {/* Mobile-only secondary cards */}
            <div className="xl:hidden flex flex-col gap-5">
              {hasKB && (
                <div className="bento-card p-7">
                  <div className="flex items-center gap-2 mb-5">
                    <Database size={13} className="text-indigo-400" />
                    <p className="text-label text-foreground/30">KNOWLEDGE BASE</p>
                  </div>
                  <div className="space-y-3">
                    {result.supportingEvidence.map((src) => <EvidenceCard key={src.id} source={src} type="support" />)}
                    {result.contradictingEvidence.map((src) => <EvidenceCard key={src.id} source={src} type="contradict" />)}
                  </div>
                </div>
              )}
              {hasFC && (
                <div className="bento-card p-7">
                  <div className="flex items-center gap-2 mb-5">
                    <Globe size={13} className="text-blue-400" />
                    <p className="text-label text-foreground/30">EXTERNAL FACT CHECKS</p>
                  </div>
                  <div className="space-y-3">
                    {result.externalFactChecks.map((fc, i) => (
                      <a key={i} href={fc.url} target="_blank" rel="noopener noreferrer"
                        className="flex items-start justify-between gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04] hover:border-white/[0.09] transition-all group">
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-bold tracking-widest text-blue-400/80 mb-1">{fc.publisher}</p>
                          <p className="text-sm text-foreground/80 font-medium leading-snug line-clamp-2">{fc.title}</p>
                          <span className="inline-block mt-2 text-[9px] font-bold tracking-wider border border-white/[0.07] rounded px-2 py-0.5 text-foreground/45">{fc.rating}</span>
                        </div>
                        <ExternalLink size={12} className="text-foreground/20 group-hover:text-foreground/50 transition-colors flex-shrink-0 mt-1" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {hasOrigin && result.sourceOrigin && (
                <div className="bento-card p-7">
                  <div className="flex items-center gap-2 mb-5">
                    <MapPin size={13} className="text-violet-400" />
                    <p className="text-label text-foreground/30">SOURCE ORIGIN</p>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                    {result.sourceOrigin.publication && <div><dt className="text-[9px] font-bold tracking-widest text-foreground/25 mb-0.5">PUBLICATION</dt><dd className="text-sm text-foreground/75">{result.sourceOrigin.publication}</dd></div>}
                    {result.sourceOrigin.author && <div><dt className="text-[9px] font-bold tracking-widest text-foreground/25 mb-0.5">AUTHOR</dt><dd className="text-sm text-foreground/75">{result.sourceOrigin.author}</dd></div>}
                    {result.sourceOrigin.publicationDate && <div><dt className="text-[9px] font-bold tracking-widest text-foreground/25 mb-0.5">DATE</dt><dd className="text-sm font-mono text-foreground/75">{result.sourceOrigin.publicationDate}</dd></div>}
                    {result.sourceOrigin.domain && <div><dt className="text-[9px] font-bold tracking-widest text-foreground/25 mb-0.5">DOMAIN</dt><dd className="text-sm font-mono text-foreground/75">{result.sourceOrigin.domain}</dd></div>}
                  </dl>
                </div>
              )}
            </div>

            {/* CTA */}
            <div key="cta" className="flex justify-start pt-8 pb-4">
              <SpecularButton onClick={() => router.push('/')} size="md">
                <span className="flex items-center gap-2 tracking-wide font-semibold text-[0.9rem]">
                  <RotateCcw size={14} />
                  Verify Another Claim
                </span>
              </SpecularButton>
            </div>

          </AnimatedList>
        </div>

        {/* ── RIGHT: Secondary Sidebar (xl+ desktop only) ──────────────────── */}
        <aside className="hidden xl:flex xl:flex-col gap-5 flex-1 min-w-[340px] max-w-[520px] flex-shrink-0">
          <div className="sticky top-28 flex flex-col gap-5">

            {hasKB && (
              <motion.div
                className="bento-card p-6"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="flex items-center gap-2 mb-5">
                  <Database size={13} className="text-indigo-400" />
                  <p className="text-label text-foreground/30">KNOWLEDGE BASE</p>
                </div>
                <div className="space-y-3">
                  {result.supportingEvidence.map((src) => <EvidenceCard key={src.id} source={src} type="support" />)}
                  {result.contradictingEvidence.map((src) => <EvidenceCard key={src.id} source={src} type="contradict" />)}
                </div>
              </motion.div>
            )}

            {hasFC && (
              <motion.div
                className="bento-card p-6"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 0.75, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="flex items-center gap-2 mb-5">
                  <Globe size={13} className="text-blue-400" />
                  <p className="text-label text-foreground/30">EXTERNAL FACT CHECKS</p>
                </div>
                <div className="space-y-3">
                  {result.externalFactChecks.map((fc, i) => (
                    <a key={i} href={fc.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-start justify-between gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04] hover:border-white/[0.09] transition-all group">
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-bold tracking-widest text-blue-400/80 mb-1">{fc.publisher}</p>
                        <p className="text-sm text-foreground/80 font-medium leading-snug line-clamp-2">{fc.title}</p>
                        <span className="inline-block mt-2 text-[9px] font-bold tracking-wider border border-white/[0.07] rounded px-2 py-0.5 text-foreground/45">{fc.rating}</span>
                      </div>
                      <ExternalLink size={12} className="text-foreground/20 group-hover:text-foreground/50 transition-colors flex-shrink-0 mt-1" />
                    </a>
                  ))}
                </div>
              </motion.div>
            )}

            {hasOrigin && result.sourceOrigin && (
              <motion.div
                className="bento-card p-6"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 0.9, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="flex items-center gap-2 mb-5">
                  <MapPin size={13} className="text-violet-400" />
                  <p className="text-label text-foreground/30">SOURCE ORIGIN</p>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
                  {result.sourceOrigin.publication && <div><dt className="text-[9px] font-bold tracking-widest text-foreground/25 mb-0.5">PUBLICATION</dt><dd className="text-sm text-foreground/75">{result.sourceOrigin.publication}</dd></div>}
                  {result.sourceOrigin.author && <div><dt className="text-[9px] font-bold tracking-widest text-foreground/25 mb-0.5">AUTHOR</dt><dd className="text-sm text-foreground/75">{result.sourceOrigin.author}</dd></div>}
                  {result.sourceOrigin.publicationDate && <div><dt className="text-[9px] font-bold tracking-widest text-foreground/25 mb-0.5">DATE</dt><dd className="text-sm font-mono text-foreground/75">{result.sourceOrigin.publicationDate}</dd></div>}
                  {result.sourceOrigin.domain && <div><dt className="text-[9px] font-bold tracking-widest text-foreground/25 mb-0.5">DOMAIN</dt><dd className="text-sm font-mono text-foreground/75">{result.sourceOrigin.domain}</dd></div>}
                  {result.sourceOrigin.sourceUrl && (
                    <div className="col-span-2">
                      <dt className="text-[9px] font-bold tracking-widest text-foreground/25 mb-0.5">SOURCE URL</dt>
                      <dd>
                        <a href={result.sourceOrigin.sourceUrl} target="_blank" rel="noopener noreferrer"
                          className="text-sm font-mono text-indigo-400/70 hover:text-indigo-400 transition-colors truncate block">
                          {result.sourceOrigin.sourceUrl}
                        </a>
                      </dd>
                    </div>
                  )}
                </dl>
              </motion.div>
            )}

          </div>
        </aside>

      </div>
    </div>
  );
}