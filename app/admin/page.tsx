'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase/config';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import {
  ShieldCheck,
  Loader2,
  CheckCircle2,
  XCircle,
  Trash2,
  BookText,
  AlertTriangle,
  LogOut,
  Plus,
  Database,
  Search,
  Eye,
  RefreshCw,
  X,
  ChevronRight,
} from 'lucide-react';
import {
  collection, query, orderBy, getDocs, doc,
  deleteDoc, addDoc, Timestamp
} from 'firebase/firestore';

// ---- Types ----
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
  text?: string;
  status?: 'indexed' | 'error';
}

type View = 'kb' | 'add';
type ProcessingStage = 'idle' | 'preparing' | 'chunking' | 'embedding' | 'indexing' | 'complete' | 'error';

const STAGES: ProcessingStage[] = ['preparing', 'chunking', 'embedding', 'indexing'];
const STAGE_LABELS: Record<string, string> = {
  preparing: 'Preparing', chunking: 'Chunking',
  embedding: 'Embedding', indexing: 'Indexing',
};

const TYPE_COLORS: Record<string, string> = {
  article: 'text-blue-400/80',
  'fact-check': 'text-emerald-400/80',
  report: 'text-purple-400/80',
  statement: 'text-amber-400/80',
  knowledge: 'text-foreground/50',
};

// ─────────────────────────────────────────────────────────────────
// Root gate
// ─────────────────────────────────────────────────────────────────
export default function AdminPage() {
  const { user, loading, signInWithGoogle, signOut } = useAuth();
  const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL;

  if (loading) return <Spinner />;

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-panel p-10 rounded-2xl flex flex-col items-center gap-6 max-w-xs text-center"
        >
          <ShieldCheck size={32} className="text-foreground/30" />
          <div>
            <h1 className="text-base font-semibold">VNews Lab Admin</h1>
            <p className="text-xs text-foreground/40 mt-1">Knowledge base management</p>
          </div>
          <button onClick={signInWithGoogle} className="admin-btn flex items-center gap-2.5 px-5 py-2.5">
            <GoogleIcon />
            Continue with Google
          </button>
        </motion.div>
      </div>
    );
  }

  if (adminEmail && user.email !== adminEmail) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-panel p-10 rounded-2xl flex flex-col items-center gap-4 max-w-xs text-center"
        >
          <AlertTriangle size={32} className="text-amber-400" />
          <h2 className="text-sm font-semibold">Unauthorized</h2>
          <p className="text-xs text-foreground/50">{user.email} does not have admin access.</p>
          <button onClick={signOut} className="text-xs text-foreground/40 hover:text-foreground/60 underline">Sign out</button>
        </motion.div>
      </div>
    );
  }

  return <AdminShell />;
}

// ─────────────────────────────────────────────────────────────────
// Shell — handles views and shared data
// ─────────────────────────────────────────────────────────────────
function AdminShell() {
  const { user, signOut } = useAuth();
  const [view, setView] = useState<View>('kb');
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<KnowledgeEntry | null>(null);

  const fetchEntries = useCallback(async () => {
    if (!db) return;
    setLoadingEntries(true);
    try {
      const q = query(collection(db, 'knowledge'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      setEntries(snap.docs.map(d => ({ id: d.id, ...d.data(), status: 'indexed' } as KnowledgeEntry)));
    } catch { /* empty */ }
    finally { setLoadingEntries(false); }
  }, []);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const handleDelete = async (entry: KnowledgeEntry) => {
    if (!confirm(`Delete "${entry.title}"? This will remove all ${entry.chunkCount} chunk(s) from Pinecone.`)) return;
    try {
      const token = await user!.getIdToken();
      await fetch('/api/admin/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ documentId: entry.documentId }),
      });
      if (db) await deleteDoc(doc(db, 'knowledge', entry.id));
      setSelectedEntry(null);
      await fetchEntries();
    } catch (err: any) { alert(`Delete failed: ${err.message}`); }
  };

  const handleReindex = async (entry: KnowledgeEntry) => {
    if (!entry.text) { alert('No stored text available for re-indexing.'); return; }
    if (!confirm(`Re-index "${entry.title}"? This will replace the existing vectors.`)) return;
    try {
      const token = await user!.getIdToken();
      const res = await fetch('/api/admin/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          title: entry.title, source: entry.source, url: entry.url,
          date: entry.date, type: entry.type, text: entry.text,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      alert('Re-indexed successfully.');
      await fetchEntries();
    } catch (err: any) { alert(`Re-index failed: ${err.message}`); }
  };

  return (
    <div className="min-h-screen py-10 px-4">
      <div className="max-w-5xl mx-auto">

        {/* Top bar */}
        <div className="flex items-center justify-between mb-7">
          <div className="flex items-center gap-2.5">
            <ShieldCheck size={16} className="text-foreground/30" />
            <span className="text-sm font-semibold tracking-tight">VNews Lab Admin</span>
          </div>
          <div className="flex items-center gap-3">
            {user?.photoURL && (
              <Image src={user.photoURL} alt="" width={26} height={26}
                className="rounded-full ring-1 ring-white/20" referrerPolicy="no-referrer" />
            )}
            <span className="text-xs text-foreground/40 hidden sm:block">{user?.email}</span>
            <button onClick={signOut} className="flex items-center gap-1 text-xs text-foreground/30 hover:text-foreground/60 transition-colors">
              <LogOut size={12} />
            </button>
          </div>
        </div>

        {/* Tab nav */}
        <div className="flex items-center gap-1 mb-5">
          <TabButton active={view === 'kb'} onClick={() => setView('kb')} icon={<Database size={13} />}>
            Knowledge Base
          </TabButton>
          <TabButton active={view === 'add'} onClick={() => setView('add')} icon={<Plus size={13} />}>
            Add Knowledge
          </TabButton>
          <div className="ml-auto text-xs text-foreground/30 tabular-nums">
            {!loadingEntries && `${entries.length} entries`}
          </div>
        </div>

        {/* Main glass container */}
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="glass-panel rounded-2xl overflow-hidden"
        >
          {view === 'kb' ? (
            <KnowledgeBaseView
              entries={entries}
              loading={loadingEntries}
              onView={setSelectedEntry}
              onReindex={handleReindex}
              onDelete={handleDelete}
            />
          ) : (
            <AddKnowledgeView
              user={user!}
              onSuccess={async () => { await fetchEntries(); setView('kb'); }}
            />
          )}
        </motion.div>
      </div>

      {/* Detail panel overlay */}
      <AnimatePresence>
        {selectedEntry && (
          <DetailPanel
            entry={selectedEntry}
            onClose={() => setSelectedEntry(null)}
            onReindex={handleReindex}
            onDelete={handleDelete}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Knowledge Base View — table
// ─────────────────────────────────────────────────────────────────
function KnowledgeBaseView({
  entries, loading, onView, onReindex, onDelete
}: {
  entries: KnowledgeEntry[];
  loading: boolean;
  onView: (e: KnowledgeEntry) => void;
  onReindex: (e: KnowledgeEntry) => void;
  onDelete: (e: KnowledgeEntry) => void;
}) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  const types = ['all', ...Array.from(new Set(entries.map(e => e.type)))];

  const filtered = entries.filter(e => {
    const matchType = typeFilter === 'all' || e.type === typeFilter;
    const q = search.toLowerCase();
    const matchSearch = !q || e.title.toLowerCase().includes(q) || e.source?.toLowerCase().includes(q);
    return matchType && matchSearch;
  });

  return (
    <div>
      {/* Filters */}
      <div className="flex items-center gap-3 p-4 border-b border-white/[0.06]">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/30" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search entries..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white/[0.03] border border-white/[0.07] rounded-lg text-foreground placeholder:text-foreground/25 outline-none focus:border-white/15 transition-colors"
          />
        </div>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="text-xs bg-white/[0.03] border border-white/[0.07] rounded-lg px-3 py-1.5 text-foreground/70 outline-none focus:border-white/15 transition-colors capitalize"
        >
          {types.map(t => <option key={t} value={t}>{t === 'all' ? 'All types' : t}</option>)}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-16 flex justify-center">
          <Loader2 size={20} className="animate-spin text-foreground/20" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-foreground/30 text-sm">
          {entries.length === 0 ? 'No knowledge entries yet. Add some.' : 'No entries match your search.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {['Title', 'Source', 'Type', 'Date', 'Chunks', 'Status', ''].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-foreground/30 px-4 py-2.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, i) => (
                <tr
                  key={entry.id}
                  onClick={() => onView(entry)}
                  className="border-b border-white/[0.04] hover:bg-white/[0.025] cursor-pointer transition-colors group"
                >
                  <td className="px-4 py-3 max-w-[240px]">
                    <span className="truncate block text-foreground/85 font-medium text-xs">{entry.title}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-foreground/45 whitespace-nowrap">{entry.source || '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`text-xs capitalize ${TYPE_COLORS[entry.type] || 'text-foreground/40'}`}>{entry.type}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-foreground/45 whitespace-nowrap">{entry.date || '—'}</td>
                  <td className="px-4 py-3 text-xs text-foreground/45 tabular-nums">{entry.chunkCount}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-400/70">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60 inline-block" />
                      Indexed
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                      <ActionBtn title="View" onClick={() => onView(entry)}><Eye size={12} /></ActionBtn>
                      <ActionBtn title="Re-index" onClick={() => onReindex(entry)}><RefreshCw size={12} /></ActionBtn>
                      <ActionBtn title="Delete" onClick={() => onDelete(entry)} danger><Trash2 size={12} /></ActionBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Detail panel (slide-over)
// ─────────────────────────────────────────────────────────────────
function DetailPanel({
  entry, onClose, onReindex, onDelete
}: {
  entry: KnowledgeEntry;
  onClose: () => void;
  onReindex: (e: KnowledgeEntry) => void;
  onDelete: (e: KnowledgeEntry) => void;
}) {
  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      {/* Panel */}
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="fixed right-0 top-0 bottom-0 w-full max-w-lg z-50 glass-panel border-l border-white/[0.08] rounded-l-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] flex-shrink-0">
          <span className="text-sm font-medium text-foreground/80 truncate pr-4">{entry.title}</span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/[0.06] text-foreground/40 hover:text-foreground transition-colors flex-shrink-0">
            <X size={15} />
          </button>
        </div>

        {/* Metadata */}
        <div className="px-5 py-4 border-b border-white/[0.06] flex-shrink-0">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
            <MetaRow label="Document ID" value={entry.documentId} mono />
            <MetaRow label="Type" value={entry.type} />
            <MetaRow label="Source" value={entry.source || '—'} />
            <MetaRow label="Date" value={entry.date || '—'} />
            <MetaRow label="Chunks" value={String(entry.chunkCount)} />
            <MetaRow label="Added" value={new Date(entry.createdAt).toLocaleString()} />
            {entry.url && (
              <div className="col-span-2">
                <p className="text-xs text-foreground/30 mb-0.5">URL</p>
                <a href={entry.url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-indigo-400/70 hover:text-indigo-400 underline break-all">{entry.url}</a>
              </div>
            )}
          </div>
        </div>

        {/* Text */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {entry.preview ? (
            <>
              <p className="text-xs text-foreground/30 mb-2 font-medium uppercase tracking-wider">Preview Text</p>
              <p className="text-xs text-foreground/60 leading-relaxed whitespace-pre-wrap font-mono">{entry.preview}</p>
            </>
          ) : (
            <p className="text-xs text-foreground/30 italic">No preview available.</p>
          )}
        </div>

        {/* Actions */}
        <div className="px-5 py-4 border-t border-white/[0.06] flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => onReindex(entry)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-white/[0.05] border border-white/[0.08] hover:bg-white/[0.09] text-foreground/70 transition-colors"
          >
            <RefreshCw size={12} /> Re-index
          </button>
          <button
            onClick={() => { onDelete(entry); onClose(); }}
            className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-400 transition-colors"
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      </motion.div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
// Add Knowledge View — form
// ─────────────────────────────────────────────────────────────────
function AddKnowledgeView({ user, onSuccess }: { user: any; onSuccess: () => void }) {
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [url, setUrl] = useState('');
  const [date, setDate] = useState('');
  const [type, setType] = useState('article');
  const [text, setText] = useState('');
  const [stage, setStage] = useState<ProcessingStage>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [resultChunks, setResultChunks] = useState(0);

  const isProcessing = !['idle', 'complete', 'error'].includes(stage);
  const currentStageIndex = STAGES.indexOf(stage as any);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setResultChunks(0);

    try {
      setStage('preparing');
      const token = await user.getIdToken();
      await delay(300);
      setStage('chunking');
      await delay(200);
      setStage('embedding');

      const res = await fetch('/api/admin/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ title, source, url, date, type, text }),
      });

      setStage('indexing');
      await delay(200);

      if (!res.ok) throw new Error((await res.json()).error || 'Ingestion failed');
      const data = await res.json();
      setResultChunks(data.chunkCount);

      setStage('complete');
      setTimeout(() => {
        setTitle(''); setSource(''); setUrl(''); setDate('');
        setType('article'); setText(''); setStage('idle');
        onSuccess();
      }, 2500);

    } catch (err: any) {
      setErrorMsg(err.message || 'Something went wrong.');
      setStage('error');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="admin-label">Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} className="admin-input" placeholder="Article headline or document title" required />
        </div>
        <div>
          <label className="admin-label">Source</label>
          <input value={source} onChange={e => setSource(e.target.value)} className="admin-input" placeholder="e.g. Reuters, BBC" />
        </div>
        <div>
          <label className="admin-label">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="admin-input" />
        </div>
        <div>
          <label className="admin-label">URL</label>
          <input value={url} onChange={e => setUrl(e.target.value)} className="admin-input" placeholder="https://..." />
        </div>
        <div>
          <label className="admin-label">Type</label>
          <select value={type} onChange={e => setType(e.target.value)} className="admin-input">
            <option value="article">Article</option>
            <option value="fact-check">Fact Check</option>
            <option value="report">Report</option>
            <option value="statement">Statement</option>
            <option value="knowledge">General Knowledge</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="admin-label">Article / Knowledge Text</label>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            className="admin-input min-h-[260px] resize-y font-mono text-xs leading-relaxed"
            placeholder="Paste the full article, fact-check, statement, or knowledge text here..."
            required
          />
        </div>
      </div>

      {/* Stage indicator */}
      <AnimatePresence mode="wait">
        {stage !== 'idle' && (
          <motion.div
            key="stages"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            {stage === 'error' ? (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-xs">
                <XCircle size={14} className="mt-0.5 flex-shrink-0" />
                {errorMsg}
              </div>
            ) : stage === 'complete' ? (
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-emerald-400 text-xs">
                <CheckCircle2 size={14} />
                Indexed successfully — <strong>{resultChunks}</strong> chunk{resultChunks !== 1 ? 's' : ''} added.
              </div>
            ) : (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]">
                {STAGES.map((s, i) => {
                  const isDone = i < currentStageIndex;
                  const isCurrent = s === stage;
                  return (
                    <div key={s} className="flex items-center gap-1.5 text-xs">
                      {i > 0 && <ChevronRight size={10} className="text-foreground/20" />}
                      <span className={isCurrent ? 'text-foreground font-medium' : isDone ? 'text-foreground/30 line-through' : 'text-foreground/20'}>
                        {STAGE_LABELS[s]}
                      </span>
                      {isCurrent && <Loader2 size={11} className="animate-spin text-foreground/50" />}
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="submit"
        disabled={isProcessing}
        className="admin-btn flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <BookText size={14} />}
        Add to Knowledge Base
      </button>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────
// Small shared components
// ─────────────────────────────────────────────────────────────────
function TabButton({ active, onClick, icon, children }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 ${
        active
          ? 'bg-white/[0.08] border border-white/[0.12] text-foreground'
          : 'text-foreground/40 hover:text-foreground/70'
      }`}
    >
      {icon}{children}
    </button>
  );
}

function ActionBtn({ title, onClick, danger, children }: any) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`p-1.5 rounded-md transition-colors ${
        danger
          ? 'text-foreground/30 hover:text-red-400 hover:bg-red-400/10'
          : 'text-foreground/30 hover:text-foreground hover:bg-white/[0.06]'
      }`}
    >
      {children}
    </button>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-foreground/30 mb-0.5">{label}</p>
      <p className={`text-xs text-foreground/70 truncate ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="animate-spin text-foreground/30" size={28} />
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908C18.622 14.367 17.64 12.06 17.64 9.2Z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
    </svg>
  );
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }
