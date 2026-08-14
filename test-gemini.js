require('dotenv').config({ path: '.env.local' });
const { GoogleGenAI } = require('@google/genai');

async function test() {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    console.log("Testing Embedding...");
    const embedRes = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: 'test query',
    });
    console.log("Embedding success, length:", embedRes.embeddings?.[0]?.values?.length);
    
    console.log("Testing Generation...");
    const genRes = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'return {"status": "ok"}',
      config: {
        responseMimeType: "application/json",
      }
    });
    console.log("Generation success, text:", genRes.text);
    console.log("Parsed:", JSON.parse(genRes.text || '{}'));
    
  } catch (error) {
    console.error("ERROR CAUGHT:", error);
  }
}

test();
