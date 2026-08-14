export type VerificationVerdict = 'TRUE' | 'FALSE' | 'MIXED' | 'INSUFFICIENT EVIDENCE';

export interface Source {
  id: string;
  title?: string;
  snippet?: string;
  url?: string;
  publicationDate?: string;
  author?: string;
  retrievalScore?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
}

export interface ExternalFactCheck {
  publisher: string;
  claim: string;
  title: string;
  rating: string;
  reviewDate?: string;
  url: string;
}

export interface SourceOrigin {
  publication?: string;
  domain?: string;
  article?: string;
  author?: string;
  publicationDate?: string;
  originalSource?: string;
  sourceUrl?: string;
  sourceLocation?: string;
  eventLocation?: string;
}

export interface VerificationResult {
  id: string;
  claim: string;
  verdict: VerificationVerdict;
  confidence: number;
  analysis: string;
  supportingEvidence: Source[];
  contradictingEvidence: Source[];
  externalFactChecks: ExternalFactCheck[];
  sourceOrigin?: SourceOrigin;
  timestamp: number;
}

export interface SearchRecord {
  id: string;
  userId?: string;
  claim: string;
  timestamp: number;
  resultId?: string; // Links to VerificationResult if saved
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  text: string;
  embedding?: number[];
  score?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any>;
}
