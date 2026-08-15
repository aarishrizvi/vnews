'use client';
import { InvestigationField } from '@/components/InvestigationField';
import { useEffect, useState, useCallback } from 'react';
import { db } from '@/lib/firebase/config';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen,
  Zap,
  FileText,
  Globe,
  CheckCircle2,
  Search,
  Eye,
  Database,
  Layers,
  HelpCircle,
  X,
  ExternalLink,
  Brain,
  ShieldCheck,
  Network,
  ChevronRight,
  Cpu,
  Sliders,
} from 'lucide-react';
import { i } from 'framer-motion/client';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────
interface KnowledgeEntry {
  id: string;
  documentId: string;
  title: string;
  source: string;
  url: string;
  date: string;
  type: string;
  chunkCount: number;
  createdAt: number;
  preview?: string;
}

type Tab = 'overview' | 'pipeline' | 'rag' | 'kb' | 'sources';

const TYPE_COLORS: Record<string, string> = {
  article: 'text-blue-400/80',
  'fact-check': 'text-emerald-400/80',
  report: 'text-purple-400/80',
  statement: 'text-amber-400/80',
  knowledge: 'text-foreground/50',
};

// ──────────────────────────────────────────────
// Pipeline stages data
// ──────────────────────────────────────────────
const PIPELINE_STAGES = [
  {
    step: '01',
    icon: FileText,
    title: 'User Claim',
    color: 'text-foreground/70',
    accent: 'border-foreground/20',
    description:
      'A user submits a natural-language claim, headline, or statement through the search bar.',
    detail: 'Claims can range from specific quotes to general news assertions. VNews Lab accepts claims in plain English — no special formatting required.',
  },
  {
    step: '02',
    icon: Brain,
    title: 'Intent Detection',
    color: 'text-amber-400',
    accent: 'border-amber-500/30',
    description:
      'A lightweight gate model checks whether the input is a verifiable claim or an irrelevant query.',
    detail: 'Uses Gemini Flash to classify intent. If the input is not a fact claim (e.g. "hello" or a recipe question), the system rejects it before running the full pipeline — preventing unnecessary compute.',
  },
  {
    step: '03',
    icon: Zap,
    title: 'Embedding Generation',
    color: 'text-indigo-400',
    accent: 'border-indigo-500/30',
    description:
      'The claim is converted into a high-dimensional semantic vector using the Gemini Embedding model.',
    detail: 'Output: a 768-dimensional float vector. This vector encodes the meaning of the claim in a mathematical space — claims about the same topic will land close to each other in this space, even if they use different words.',
  },
  {
    step: '04',
    icon: Database,
    title: 'Pinecone Vector Retrieval',
    color: 'text-violet-400',
    accent: 'border-violet-500/30',
    description:
      'Pinecone performs approximate nearest-neighbour search to retrieve the most semantically relevant evidence chunks.',
    detail: 'We query our knowledge index for the top-k results with the highest cosine similarity to the claim vector. Retrieved chunks include the actual text and source metadata — the full content lives in Pinecone.',
  },
  {
    step: '05',
    icon: Globe,
    title: 'External Fact Check',
    color: 'text-blue-400',
    accent: 'border-blue-500/30',
    description:
      'In parallel, the Google Fact Check API is queried for existing investigative coverage.',
    detail: 'Covers PolitiFact, FactCheck.org, Boom, AFP, Snopes, and hundreds of other international verification bodies. If they have already investigated a related claim, their rating and summary are pulled into the result.',
  },
  {
    step: '06',
    icon: Cpu,
    title: 'Evidence Analysis',
    color: 'text-emerald-400',
    accent: 'border-emerald-500/30',
    description:
      'Gemini 2.5 Flash receives the claim, evidence chunks, and external fact checks and performs structured reasoning.',
    detail: 'The model identifies which evidence supports and which contradicts the claim, resolves conflicts between sources, and articulates its reasoning in a human-readable analysis paragraph.',
  },
  {
    step: '07',
    icon: ShieldCheck,
    title: 'Verdict Generation',
    color: 'text-emerald-300',
    accent: 'border-emerald-400/40',
    description:
      'A structured JSON verdict is generated — TRUE, FALSE, MIXED, or INSUFFICIENT EVIDENCE — with a confidence score.',
    detail: 'The model outputs a schema-validated JSON object containing the verdict, a 0–1 confidence float, the analysis text, and categorised evidence references.',
  },
  {
    step: '08',
    icon: Sliders,
    title: 'Confidence Assessment',
    color: 'text-foreground/60',
    accent: 'border-foreground/15',
    description:
      'The confidence score reflects how strongly the evidence supports the verdict, not how certain the model is about itself.',
    detail: 'Factors: strength of evidence match, agreement between sources, number of independent confirmations, and absence of contradictory evidence.',
  },
];

const CONFIDENCE_FACTORS = [
  { label: 'Evidence Relevance', weight: 30, desc: 'How closely retrieved chunks match the claim topic' },
  { label: 'Source Quality', weight: 25, desc: 'Authority and reliability of the evidence sources' },
  { label: 'Evidence Agreement', weight: 20, desc: 'Degree of consensus between independent sources' },
  { label: 'Support vs. Contradiction', weight: 15, desc: 'Ratio of supporting to contradicting evidence' },
  { label: 'Independent Confirmation', weight: 10, desc: 'Presence of external fact-check corroboration' },
];

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────

function PipelineView() {
  const [activeStage, setActiveStage] = useState<number | null>(null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-label text-indigo-400 mb-1">End-to-End Flow</p>
        <h1 className="text-display">Verification Pipeline</h1>
        <p className="text-body mt-2 max-w-xl">
          Every claim passes through eight sequential stages. Click a stage to expand its technical detail.
        </p>
      </div>

      {/* Stage list */}
      <div className="space-y-0">
        {PIPELINE_STAGES.map((stage, i) => {
          const Icon = stage.icon;
          const isActive = activeStage === i;
          const isLast = i === PIPELINE_STAGES.length - 1;

          return (
            <div key={stage.step} className="relative">
              {/* Connector line */}
              {!isLast && (
                <div className="absolute left-[27px] top-[56px] bottom-0 w-px bg-glass-border z-0" />
              )}

              <motion.div
                layout
                className="relative z-10"
              >
                <button
                  onClick={() => setActiveStage(isActive ? null : i)}
                  className="w-full text-left py-3 flex items-start gap-4 group"
                >
                  {/* Node */}
                  <div className={`w-14 h-14 rounded-2xl flex flex-col items-center justify-center flex-shrink-0 border transition-all duration-200 bg-white/[0.03] ${isActive ? stage.accent + ' bg-white/[0.06]' : 'border-glass-border'}`}>
                    <Icon size={18} className={`${isActive ? stage.color : 'text-foreground/30'} transition-colors duration-200`} />
                    <span className={`text-[9px] font-mono mt-1 ${isActive ? 'text-foreground/60' : 'text-foreground/20'}`}>
                      {stage.step}
                    </span>
                  </div>

                  {/* Text */}
                  <div className="flex-1 min-w-0 pt-1">
                    <div className="flex items-center gap-2">
                      <h3 className={`text-subheading transition-colors duration-200 ${isActive ? 'text-foreground' : 'text-foreground/65 group-hover:text-foreground/85'}`}>
                        {stage.title}
                      </h3>
                      <motion.div
                        animate={{ rotate: isActive ? 90 : 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <ChevronRight size={13} className="text-foreground/25" />
                      </motion.div>
                    </div>
                    <p className="text-body-sm mt-0.5 line-clamp-2 pr-4">{stage.description}</p>
                  </div>
                </button>

                {/* Expanded detail */}
                <AnimatePresence>
                  {isActive && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden pl-[72px] pb-2"
                    >
                      <div className={`border-l-2 ${stage.accent} pl-4 py-2`}>
                        <p className="text-body-sm leading-relaxed">{stage.detail}</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RagView() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <p className="text-label text-indigo-400 mb-1">How Retrieval Works</p>
        <h1 className="text-display">RAG Pipeline</h1>
        <p className="text-body mt-2 max-w-xl">
          Retrieval-Augmented Generation grounds every LLM output in real evidence — preventing hallucination.
        </p>
      </div>

      {/* Visual claim → vector → chunks flow */}
      <div className="rounded-2xl border border-glass-border bg-white/[0.02] p-6">
        <p className="text-label mb-5">How a Claim Becomes Evidence</p>
        <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-2">

          {/* Claim */}
          <div className="flex-1 min-w-0 p-4 rounded-xl bg-white/[0.04] border border-glass-border text-center">
            <p className="text-label mb-2 text-indigo-400">Claim</p>
            <p className="text-body-sm italic">&ldquo;The economy shrank last quarter&rdquo;</p>
          </div>

          {/* Arrow + embed label */}
          <div className="flex flex-col items-center gap-1 flex-shrink-0 px-2">
            <p className="text-[9px] font-mono text-indigo-400 whitespace-nowrap">embed</p>
            <div className="flex items-center gap-0.5">
              {Array.from({ length: 7 }).map((_, i) => (
                <motion.div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-indigo-500"
                  animate={{ opacity: [0.2, 1, 0.2] }}
                  transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.12 }}
                />
              ))}
            </div>
            <ChevronRight size={14} className="text-indigo-400/50 rotate-0 hidden sm:block" />
          </div>

          {/* Vector */}
          <div className="flex-1 min-w-0 p-4 rounded-xl bg-white/[0.04] border border-glass-border text-center">
            <p className="text-label mb-2 text-violet-400">Vector (768-dim)</p>
            <p className="text-code text-violet-400/70 break-all leading-loose">
              [0.42, −0.11, 0.88, 0.03, −0.72 …]
            </p>
          </div>

          {/* Arrow + search label */}
          <div className="flex flex-col items-center gap-1 flex-shrink-0 px-2">
            <p className="text-[9px] font-mono text-violet-400 whitespace-nowrap">search</p>
            <div className="flex items-center gap-0.5">
              {Array.from({ length: 7 }).map((_, i) => (
                <motion.div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-violet-500"
                  animate={{ opacity: [0.2, 1, 0.2] }}
                  transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.12 + 0.7 }}
                />
              ))}
            </div>
            <ChevronRight size={14} className="text-violet-400/50 rotate-0 hidden sm:block" />
          </div>

          {/* Retrieved chunks */}
          <div className="flex-1 min-w-0 p-4 rounded-xl bg-white/[0.04] border border-glass-border">
            <p className="text-label mb-2 text-emerald-400">Retrieved Chunks</p>
            <div className="space-y-1.5">
              {['GDP fell 1.2% in Q3…', 'IMF warned of contraction…', 'Trade deficit widened…'].map((chunk, i) => (
                <motion.div
                  key={i}
                  className="text-body-sm px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-200/70"
                  animate={{ opacity: [0.6, 1, 0.6] }}
                  transition={{ duration: 2, repeat: Infinity, delay: i * 0.4 }}
                >
                  {chunk}
                </motion.div>
              ))}
            </div>
          </div>
        </div>
        <p className="text-label mt-4 text-foreground/20 text-center">
          Illustrative example — not real-time data
        </p>
      </div>

      {/* Two explainer cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded-2xl bg-white/[0.02] border border-glass-border space-y-2">
          <div className="flex items-center gap-2">
            <Search size={14} className="text-indigo-400" />
            <h3 className="text-subheading">Semantic vs. Keyword Search</h3>
          </div>
          <p className="text-body-sm">
            Keyword search matches exact words. Semantic search matches <em>meaning</em>. A query about
            &ldquo;the economy shrank&rdquo; retrieves articles about &ldquo;recession&rdquo; and &ldquo;negative GDP growth&rdquo;
            — even if neither phrase appears in the claim.
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-white/[0.02] border border-glass-border space-y-2">
          <div className="flex items-center gap-2">
            <Network size={14} className="text-blue-400" />
            <h3 className="text-subheading">Similarity ≠ Verdict</h3>
          </div>
          <p className="text-body-sm">
            Pinecone returns chunks based solely on relevance — it cannot tell you if they support or
            contradict the claim. That is Gemini&rsquo;s role: reading the retrieved text and acting as
            the analytical jury.
          </p>
        </div>
      </div>

      {/* Confidence factors */}
      <div className="rounded-2xl border border-glass-border bg-white/[0.02] p-5 space-y-4">
        <h3 className="text-subheading">How Confidence Is Calculated</h3>
        <p className="text-body-sm">
          The confidence score is a weighted composite of five factors, not a raw LLM probability.
        </p>
        <div className="space-y-3">
          {CONFIDENCE_FACTORS.map((f, i) => (
            <div key={i}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-body-sm text-foreground/70">{f.label}</span>
                <span className="text-code">{f.weight}%</span>
              </div>
              <div className="h-1 rounded-full bg-white/[0.06]">
                <motion.div
                  className="h-full rounded-full bg-indigo-500/50"
                  initial={{ width: 0 }}
                  whileInView={{ width: `${f.weight * 2.5}%` }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, delay: i * 0.1 }}
                />
              </div>
              <p className="text-[10px] text-foreground/30 mt-0.5">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function OverviewView() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <p className="text-label text-indigo-400 mb-1">Welcome to the Lab</p>
        <h1 className="text-display">How VNews Lab Works</h1>
        <p className="text-body mt-2 max-w-xl">
          VNews Lab is not a standard generative chatbot. Behind the interface lies a
          multi-stage Retrieval-Augmented Generation pipeline designed specifically for
          fact-checking, claims investigation, and verdict verification.
        </p>
      </div>

      {/* Core distinction */}
      <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/[0.04] p-5">
        <p className="text-subheading text-indigo-300 mb-2">Why RAG instead of a plain LLM?</p>
        <p className="text-body-sm">
          Traditional language models hallucinate because they rely solely on pre-trained weights.
          VNews Lab overcomes this by grounding every output in verified evidence chunks retrieved
          from our knowledge index and live external fact-check networks — making every verdict
          traceable.
        </p>
      </div>

      {/* Feature grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          {
            icon: Database,
            color: 'text-indigo-400',
            title: 'Grounded Reasoning',
            body: 'Every verdict is backed by semantically retrieved evidence chunks. No fabrication — if evidence is absent, the system says so.',
          },
          {
            icon: Globe,
            color: 'text-blue-400',
            title: 'Dual Verification',
            body: "Parallel checks across our Pinecone knowledge index and Google's international Fact Check API — hundreds of verification bodies worldwide.",
          },
          {
            icon: ShieldCheck,
            color: 'text-emerald-400',
            title: 'Structured Verdicts',
            body: 'Outputs are schema-validated JSON: TRUE / FALSE / MIXED / INSUFFICIENT EVIDENCE, with a calibrated confidence score.',
          },
          {
            icon: BookOpen,
            color: 'text-purple-400',
            title: 'Transparent Sources',
            body: 'Supporting and contradicting evidence are surfaced separately, letting you judge the quality of the evidence yourself.',
          },
        ].map((card, i) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.07, duration: 0.4 }}
              className="p-5 rounded-2xl bg-white/[0.02] border border-glass-border space-y-2"
            >
              <div className="flex items-center gap-2.5">
                <Icon size={16} className={card.color} />
                <h3 className="text-subheading">{card.title}</h3>
              </div>
              <p className="text-body-sm">{card.body}</p>
            </motion.div>
          );
        })}
      </div>

      {/* Quick nav hint */}
      <div className="flex items-center gap-2 text-label text-foreground/25">
        <ChevronRight size={12} />
        Use the sidebar to explore the full pipeline, RAG mechanics, and knowledge base.
      </div>
    </div>
  );
}

function SourcesView() {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-label text-indigo-400 mb-1">Verification Strategy</p>
        <h1 className="text-display">Sources &amp; Fact Checking</h1>
        <p className="text-body mt-2 max-w-xl">
          VNews Lab draws on two orthogonal evidence streams — a curated local knowledge index
          and a live global fact-check network.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded-2xl bg-white/[0.02] border border-glass-border space-y-3">
          <div>
            <span className="text-label text-indigo-400">01 / Local Archives</span>
            <h4 className="text-subheading mt-1">Grounding Database (Pinecone)</h4>
          </div>
          <p className="text-body-sm">
            Structured knowledge entries curated and indexed by administrators. Documents are
            chunked, embedded, and stored in our vector index. When a claim is verified, the
            most semantically relevant chunks are retrieved — the full text lives in Pinecone,
            not duplicated in Firebase.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {['Articles', 'Reports', 'Statements', 'Fact Checks', 'Research'].map(tag => (
              <span key={tag} className="text-label border border-glass-border rounded-full px-2.5 py-1">
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white/[0.02] border border-glass-border space-y-3">
          <div>
            <span className="text-label text-emerald-400">02 / Global Fact Check</span>
            <h4 className="text-subheading mt-1">Google Fact Check API</h4>
          </div>
          <p className="text-body-sm">
            Integrates Google's ClaimReview markup standard — a global registry of
            fact-checks from hundreds of international verification bodies. If an agency
            has investigated a related claim, their rating, summary, and link are
            included in the result.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {['PolitiFact', 'FactCheck.org', 'Snopes', 'AFP', 'Boom', '+ hundreds more'].map(tag => (
              <span key={tag} className="text-label border border-glass-border rounded-full px-2.5 py-1">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Limitation note */}
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.03] p-5">
        <p className="text-subheading text-amber-400/80 mb-2">Important Limitations</p>
        <p className="text-body-sm">
          The knowledge base is not the entire internet. It reflects only what has been
          manually indexed. For topics not yet in the knowledge base, VNews Lab relies
          entirely on the Google Fact Check API and the model's reasoning about the
          retrieved evidence. A verdict of INSUFFICIENT EVIDENCE is a valid, honest output.
        </p>
      </div>
    </div>
  );
}

function KnowledgeBaseView() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<KnowledgeEntry | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  const fetchEntries = useCallback(async () => {
    if (!db) { setLoadingEntries(false); return; }
    setLoadingEntries(true);
    try {
      const q = query(collection(db, 'knowledge'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() } as KnowledgeEntry)));
    } catch {
      console.error('Failed to fetch public knowledge catalogue');
    } finally {
      setLoadingEntries(false);
    }
  }, []);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const uniqueTypes = ['all', ...Array.from(new Set(entries.map(e => e.type)))];

  const filteredEntries = entries.filter(e => {
    const matchesType = typeFilter === 'all' || e.type === typeFilter;
    const q = searchQuery.toLowerCase().trim();
    if (!q) return matchesType;
    return matchesType && (
      e.title?.toLowerCase().includes(q) ||
      e.source?.toLowerCase().includes(q) ||
      e.type?.toLowerCase().includes(q) ||
      e.preview?.toLowerCase().includes(q)
    );
  });

  return (
    <>
      <div className="space-y-5">
        <div>
          <p className="text-label text-indigo-400 mb-1">Public Catalogue</p>
          <h1 className="text-display">Knowledge Base</h1>
          <p className="text-body-sm mt-1.5 max-w-xl">
            Sources currently available to VNews Lab's retrieval system. This is not exhaustive — new sources are indexed regularly through the admin panel.
          </p>
        </div>

        {/* Search + Filter */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground/30" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search the knowledge base…"
              className="input-base pl-9"
            />
          </div>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="input-base sm:w-36 capitalize"
          >
            {uniqueTypes.map(t => (
              <option key={t} value={t}>{t === 'all' ? 'All types' : t}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        {loadingEntries ? (
          <div className="py-16 flex flex-col items-center gap-3 text-foreground/25">
            <div className="w-5 h-5 border-2 border-foreground/20 border-t-indigo-500 rounded-full animate-spin" />
            <p className="text-body-sm">Loading catalogue…</p>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <Database size={28} className="mx-auto text-foreground/15" />
            <p className="text-body-sm text-foreground/30">
              {entries.length === 0 ? 'No sources have been indexed yet.' : 'No matching sources found.'}
            </p>
          </div>
        ) : (
          <div className="border border-glass-border rounded-xl overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-glass-border bg-white/[0.015]">
                  <th className="px-4 py-3 text-label">Title</th>
                  <th className="px-4 py-3 text-label hidden sm:table-cell">Source</th>
                  <th className="px-4 py-3 text-label">Type</th>
                  <th className="px-4 py-3 text-label hidden md:table-cell">Date</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map(entry => (
                  <tr
                    key={entry.id}
                    onClick={() => setSelectedEntry(entry)}
                    className="border-b border-glass-border last:border-0 hover:bg-white/[0.02] cursor-pointer transition-colors group"
                  >
                    <td className="px-4 py-3 max-w-[200px] truncate text-body-sm text-foreground/80 font-medium">
                      {entry.title}
                    </td>
                    <td className="px-4 py-3 text-body-sm text-foreground/45 whitespace-nowrap hidden sm:table-cell">
                      {entry.source || '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`text-label capitalize ${TYPE_COLORS[entry.type] || 'text-foreground/35'}`}>
                        {entry.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-body-sm text-foreground/35 whitespace-nowrap hidden md:table-cell">
                      {entry.date || '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-foreground/35 hover:text-foreground">
                        <Eye size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Drawer */}
      <AnimatePresence>
        {selectedEntry && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedEntry(null)}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md z-50 glass-panel border-l border-glass-border flex flex-col overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-glass-border flex-shrink-0">
                <span className="text-subheading text-foreground/80 truncate pr-4">{selectedEntry.title}</span>
                <button
                  onClick={() => setSelectedEntry(null)}
                  className="p-1.5 rounded-lg hover:bg-white/[0.06] text-foreground/40 hover:text-foreground transition-colors flex-shrink-0"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Metadata grid */}
              <div className="px-5 py-4 border-b border-glass-border flex-shrink-0">
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  {[
                    { label: 'Type', value: selectedEntry.type, mono: false },
                    { label: 'Source', value: selectedEntry.source || '—', mono: false },
                    { label: 'Date', value: selectedEntry.date || '—', mono: false },
                    { label: 'Indexed', value: new Date(selectedEntry.createdAt).toLocaleDateString(), mono: false },
                  ].map(row => (
                    <div key={row.label}>
                      <p className="text-label mb-0.5">{row.label}</p>
                      <p className="text-body-sm capitalize">{row.value}</p>
                    </div>
                  ))}
                  {selectedEntry.url && (
                    <div className="col-span-2">
                      <p className="text-label mb-0.5">Original URL</p>
                      <a
                        href={selectedEntry.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-body-sm text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1 break-all"
                      >
                        {selectedEntry.url}
                        <ExternalLink size={10} className="flex-shrink-0" />
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Preview */}
              <div className="flex-1 overflow-y-auto px-5 py-4">
                <p className="text-label mb-3">Preview</p>
                {selectedEntry.preview ? (
                  <p className="text-body-sm font-mono leading-relaxed whitespace-pre-wrap text-foreground/55">
                    {selectedEntry.preview}
                  </p>
                ) : (
                  <p className="text-body-sm text-foreground/25 italic">No preview available.</p>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

// ──────────────────────────────────────────────
// Main Page
// ──────────────────────────────────────────────
const MENU_ITEMS = [
  { id: 'overview', name: 'Overview', icon: BookOpen },
  { id: 'pipeline', name: 'Pipeline', icon: Layers },
  { id: 'rag', name: 'RAG Explained', icon: Network },
  { id: 'kb', name: 'Knowledge Base', icon: Database },
  { id: 'sources', name: 'Sources', icon: Globe },
] as const;

export default function TheLab() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  return (
    <div className="relative min-h-screen">

      {/* Investigation network background */}
      <InvestigationField />

      {/* Lab content */}
      <div className="relative z-10 site-container py-10">
        <div className="flex flex-col md:flex-row gap-6">

          {/* ── Sidebar ────────────────────────── */}
          <aside className="w-full md:w-64 xl:w-72 flex-shrink-0">
            <div className="glass-panel p-3 rounded-2xl sticky top-28">
              {/* Wordmark */}
              <div className="px-3 py-2.5 mb-1">
                <p className="text-label text-indigo-400">The Lab</p>
                <p className="text-[10px] text-foreground/20 font-mono mt-0.5">VNews Lab · RAG Engine</p>
              </div>

              <nav className="flex flex-col gap-0.5">
                {MENU_ITEMS.map(item => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id as Tab)}
                      className={`flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm transition-all duration-150 text-left ${isActive
                        ? 'bg-white/[0.07] text-foreground border border-glass-border'
                        : 'text-foreground/45 hover:text-foreground/75 hover:bg-white/[0.03]'
                        }`}
                    >
                      <Icon
                        size={14}
                        className={isActive ? 'text-indigo-400' : 'text-foreground/30'}
                      />
                      <span className="font-medium">{item.name}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
          </aside>

          {/* ── Main Content ────────────────────── */}
          <div className="flex-1 min-w-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="glass-panel rounded-2xl p-6 md:p-8 min-h-[500px]"
              >
                {activeTab === 'overview' && <OverviewView />}
                {activeTab === 'pipeline' && <PipelineView />}
                {activeTab === 'rag' && <RagView />}
                {activeTab === 'kb' && <KnowledgeBaseView />}
                {activeTab === 'sources' && <SourcesView />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
