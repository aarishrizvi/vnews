import { Pinecone } from '@pinecone-database/pinecone';
import { GoogleGenAI } from '@google/genai';
import { DocumentChunk } from '../types';

const pineconeApiKey = process.env.PINECONE_API_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;

// Initialize clients safely (handling cases where keys might be missing in dev)
export const pinecone = pineconeApiKey ? new Pinecone({ apiKey: pineconeApiKey }) : null;
export const ai = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;

// Replace with your actual index name
export const INDEX_NAME = 'truthlens-index';

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!ai) {
    console.warn("No Gemini API key, returning mock embedding");
    return new Array(768).fill(0.1); // Mock 768-dim embedding
  }
  
  try {
    const response = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: text,
      config: {
        outputDimensionality: 768,
      }
    });
    return response.embeddings?.[0]?.values || [];
  } catch (error) {
    console.error("Embedding generation failed:", error);
    throw error;
  }
}

export async function searchPinecone(queryEmbedding: number[], topK: number = 5): Promise<DocumentChunk[]> {
  if (!pinecone) {
    console.warn("No Pinecone API key, returning empty results");
    return [];
  }
  
  try {
    const index = pinecone.index(INDEX_NAME);
    const queryResponse = await index.query({
      vector: queryEmbedding,
      topK,
      includeMetadata: true,
    });
    
    return queryResponse.matches.map(match => ({
      id: match.id,
      documentId: match.metadata?.documentId as string || 'unknown',
      text: match.metadata?.text as string || '',
      metadata: match.metadata || {},
      score: match.score || 0
    }));
  } catch (error) {
    console.error("Pinecone search failed:", error);
    return [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function insertDocumentChunks(chunks: { id: string; values: number[]; metadata: any }[]): Promise<boolean> {
  if (!pinecone) {
    console.warn("No Pinecone API key, cannot insert chunks.");
    return false;
  }
  
  try {
    const index = pinecone.index(INDEX_NAME);
    // Pinecone upsert accepts an object with records
    await index.upsert({ records: chunks });
    return true;
  } catch (error) {
    console.error("Pinecone insert failed:", error);
    throw error;
  }
}

export async function deleteDocumentVectors(documentId: string): Promise<boolean> {
  if (!pinecone) {
    console.warn("No Pinecone API key, cannot delete document.");
    return false;
  }
  
  try {
    const index = pinecone.index(INDEX_NAME);
    // Delete all vectors matching the documentId using metadata filter
    await index.deleteMany({ filter: { documentId: { $eq: documentId } } });
    return true;
  } catch (error) {
    console.error("Pinecone delete failed:", error);
    throw error;
  }
}
