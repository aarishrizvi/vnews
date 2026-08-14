require('dotenv').config({ path: '.env.local' });
const { GoogleGenAI } = require('@google/genai');

async function test() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const modelsToTest = ['text-embedding-004', 'embedding-001', 'models/text-embedding-004'];
  
  for (const model of modelsToTest) {
    try {
      console.log(`Testing model: ${model}...`);
      const embedRes = await ai.models.embedContent({
        model: model,
        contents: 'test query',
      });
      console.log(`SUCCESS with ${model}!`);
      break;
    } catch (error) {
      console.error(`FAILED with ${model}:`, error.message);
    }
  }
}

test();
