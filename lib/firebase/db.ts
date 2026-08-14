import { db } from './config';
import { collection, addDoc, getDocs, query, orderBy, limit, where } from 'firebase/firestore';
import { VerificationResult, SearchRecord } from '../types';

export async function saveVerificationResult(result: VerificationResult, userId?: string) {
  if (!db) return null;
  
  try {
    const docRef = await addDoc(collection(db, 'verifications'), {
      ...result,
      userId: userId || 'anonymous',
      savedAt: Date.now()
    });
    return docRef.id;
  } catch (error) {
    console.error("Error saving result to Firebase:", error);
    return null;
  }
}

export async function getRecentSearches(userId: string, count: number = 5): Promise<SearchRecord[]> {
  if (!db) return [];
  
  try {
    const q = query(
      collection(db, 'searches'),
      where('userId', '==', userId),
      orderBy('timestamp', 'desc'),
      limit(count)
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SearchRecord));
  } catch (error) {
    console.error("Error fetching recent searches:", error);
    return [];
  }
}

// --- Admin Knowledge Helpers ---

export interface KnowledgeEntry {
  id?: string;
  documentId: string;
  title: string;
  source: string;
  url: string;
  date: string;
  type: string;
  chunkCount: number;
  addedAt: number;
}

export async function saveKnowledgeEntry(entry: Omit<KnowledgeEntry, 'id'>): Promise<string | null> {
  if (!db) return null;
  try {
    const docRef = await addDoc(collection(db, 'knowledge'), {
      ...entry,
      addedAt: Date.now()
    });
    return docRef.id;
  } catch (error) {
    console.error("Error saving knowledge entry:", error);
    return null;
  }
}

export async function getKnowledgeEntries(count: number = 10): Promise<KnowledgeEntry[]> {
  if (!db) return [];
  try {
    const q = query(
      collection(db, 'knowledge'),
      orderBy('addedAt', 'desc'),
      limit(count)
    );
    const snap = await getDocs(q);
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as KnowledgeEntry));
  } catch (error) {
    console.error("Error fetching knowledge entries:", error);
    return [];
  }
}

export async function deleteKnowledgeEntry(id: string): Promise<boolean> {
  if (!db) return false;
  try {
    const { doc, deleteDoc } = await import('firebase/firestore');
    await deleteDoc(doc(db, 'knowledge', id));
    return true;
  } catch (error) {
    console.error("Error deleting knowledge entry:", error);
    return false;
  }
}
