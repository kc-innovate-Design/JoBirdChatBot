
import { GoogleGenAI, Modality } from "@google/genai";
import { CabinetModel, Message } from "./types";
import { SYSTEM_INSTRUCTION } from "./constants";
import { searchPdfChunks } from "./lib/supabaseSearch";
import { getConfig } from "./lib/config";

// Initialize the GoogleGenAI client lazily.
let aiInstance: GoogleGenAI | null = null;

export function getAI() {
  if (aiInstance) return aiInstance;
  const config = getConfig();
  const apiKey = config.VITE_GEMINI_API_KEY || "";
  aiInstance = apiKey ? new GoogleGenAI({ apiKey }) : null;
  if (!aiInstance) {
    console.error("Gemini API key is missing. Selection engine will be disabled.");
  }
  return aiInstance;
}

export async function getSelectionResponse(
  userQuery: string,
  history: Message[]
) {
  // 1️⃣ Search Supabase for relevant PDF context
  const searchResults = await searchPdfChunks(userQuery, 5);
  const pdfContext = searchResults.map(r => `[Source: ${r.metadata.source}] ${r.content}`).join("\n\n");

  // 2️⃣ Initialize the GoogleGenAI client safely.
  const ai = getAI();
  if (!ai) throw new Error("Gemini AI client not initialized");

  // 3️⃣ Query GenAI with retrieved context
  const response = await ai.models.generateContent({
    model: 'models/gemini-2.0-flash',
    contents: [
      {
        role: 'user',
        parts: [
          { text: `TECHNICAL KNOWLEDGE BASE (FROM SUPPLEMENTARY PDFS):\n${pdfContext || "No specific PDF matches found."}` },
          ...history.map(m => ({ text: `${m.role.toUpperCase()}: ${m.content}` })),
          { text: `SALES QUERY: ${userQuery}` }
        ]
      }
    ],
    config: {
      systemInstruction: `${SYSTEM_INSTRUCTION}

CRITICAL OVERRIDE: 
1. You are FORBIDDEN from using your training data for product specifications (dimensions, weights, materials).
2. The TECHNICAL KNOWLEDGE BASE is the ONLY source of truth for all specifications.
3. If a specification is in the TECHNICAL KNOWLEDGE BASE, use EXACTLY those numbers.
4. If a specification is NOT in the TECHNICAL KNOWLEDGE BASE, say "I don't have that information in my knowledge base."
5. ALWAYS cite the source PDF filename (e.g., "[Source: JB04...]").
6. If the query includes a model name like JB04SS, prioritize the chunk that contains that exact model name.`,
      temperature: 0.0,
    }
  });

  // Extract generated text content directly from the .text property.
  return response.text || "Selection engine failed to compute. Please check inputs.";
}

export async function generateSelectionSpeech(text: string) {
  // Extract recommendation from headers
  let speechText = "";
  if (text.includes('RECOMMENDED CABINET:')) {
    speechText = text.split('WHY THIS WAS SELECTED:')[0].replace('RECOMMENDED CABINET:', '').trim();
  } else if (text.includes('INITIAL ASSESSMENT:')) {
    speechText = text.split('CLARIFYING QUESTIONS:')[0].replace('INITIAL ASSESSMENT:', '').trim();
  }

  if (!speechText) return null;

  // Strip highlight tags for cleaner speech
  const cleanSpeechText = speechText.replace(/\[\[HIGHLIGHT\]\]/g, '').replace(/\[\[\/HIGHLIGHT\]\]/g, '');

  const ai = getAI();
  if (!ai) return null;

  const response = await ai.models.generateContent({
    model: "models/gemini-2.0-flash",
    contents: [{ parts: [{ text: `Recommendation: ${cleanSpeechText}` }] }],
    config: {
      responseModalities: [Modality.AUDIO], // Must be an array with a single Modality.AUDIO element.
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  // Extract the raw PCM data from the response candidates.
  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  return base64Audio;
}
