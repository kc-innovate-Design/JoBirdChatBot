
import { GoogleGenAI, Modality } from "@google/genai";
import { CabinetModel, Message } from "./types";
import { SYSTEM_INSTRUCTION } from "./constants";

// Initialize the GoogleGenAI client safely.
const apiKey = import.meta.env.VITE_GEMINI_API_KEY || "";
export const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

if (!ai) {
  console.error("Gemini API key is missing. Selection engine will be disabled.");
}

export async function getSelectionResponse(
  userQuery: string,
  history: Message[],
  catalog: CabinetModel[]
) {
  // Use ai.models.generateContent to query GenAI with both the model name and prompt.
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [
      {
        role: 'user',
        parts: [
          { text: `PRODUCT CATALOG (DETERMINISTIC DATA):\n${JSON.stringify(catalog, null, 2)}` },
          ...history.map(m => ({ text: `${m.role.toUpperCase()}: ${m.content}` })),
          { text: `SALES QUERY: ${userQuery}` }
        ]
      }
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.1, // Near zero for deterministic logic
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

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
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
