require('dotenv').config({ path: '.env.local' });
const { GoogleGenAI } = require('@google/genai');

async function test() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    console.log("Listing models...");
    const response = await ai.models.list();
    const models = [];
    for await (const model of response) {
      models.push(model.name);
    }
    console.log("Available models:", models.filter(m => m.includes('embed')));
  } catch (error) {
    console.error("FAILED to list models:", error.message);
  }
}

test();
