
import { Message, AIResponse, DatasheetReference } from "./types";

// No more direct Gemini SDK - all calls go through secure backend

// Kept for compatibility with Live Mode (voice) which still runs client-side
import { GoogleGenAI, Modality } from "@google/genai";
import { getConfig } from "./lib/config";

let aiInstance: GoogleGenAI | null = null;

// For Live Mode (voice) - uses a separate, restricted API key
export function getAI() {
  if (aiInstance) return aiInstance;
  const config = getConfig();
  // Use the Live Mode key (restricted, safe for client-side), fall back to main key for local dev
  const apiKey = config.VITE_GEMINI_LIVE_API_KEY || config.VITE_GEMINI_API_KEY || "";
  aiInstance = apiKey ? new GoogleGenAI({ apiKey }) : null;
  // Don't log error - we may not have a client-side key in production (which is correct for main chat)
  return aiInstance;
}

export async function getSelectionResponse(
  userQuery: string,
  history: Message[]
): Promise<AIResponse> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: userQuery, history })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Server error: ${response.status}`);
  }

  return await response.json();
}

// Streaming version using Server-Sent Events
export async function getSelectionResponseStream(
  userQuery: string,
  history: Message[],
  onChunk: (text: string, referencedDatasheets: DatasheetReference[]) => void,
  files?: { name: string, content: string }[]
): Promise<AIResponse> {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: userQuery, history, files })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Server error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Streaming not supported');
  }

  const decoder = new TextDecoder();
  let referencedDatasheets: DatasheetReference[] = [];
  let fullText = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const lines = text.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'datasheets') {
              referencedDatasheets = data.datasheets || [];
            } else if (data.type === 'chunk') {
              fullText = data.text || '';
              onChunk(fullText, referencedDatasheets);
            } else if (data.type === 'done') {
              fullText = data.text || fullText;
              referencedDatasheets = data.datasheets || referencedDatasheets;
            } else if (data.type === 'error') {
              throw new Error(data.error);
            }
          } catch (parseError) {
            // Skip invalid JSON lines
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { text: fullText, referencedDatasheets };
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

  const response = await fetch('/api/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: cleanSpeechText })
  });

  if (!response.ok) {
    console.error('Speech generation failed');
    return null;
  }

  const data = await response.json();
  return data.audio;
}
