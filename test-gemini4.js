require('dotenv').config({ path: '.env.local' });
const { GoogleGenAI } = require('@google/genai');

async function test() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const modelsToTest = ['text-embedding-004', 'gemini-embedding-2', 'models/text-embedding-004', 'models/gemini-embedding-001'];
  
  for (const model of modelsToTest) {
    try {
      console.log(`Testing model: ${model}...`);
      const embedRes = await ai.models.embedContent({
        model: model,
        contents: 'test query',
        config: {
          outputDimensionality: 768,
        }
      });
      console.log(`SUCCESS with ${model}! Dimensions:`, embedRes.embeddings?.[0]?.values?.length);
    } catch (error) {
      console.error(`FAILED with ${model}:`, error.message);
    }
  }
}

test();
