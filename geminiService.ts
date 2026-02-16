import { Message, AIResponse, DatasheetReference } from "./types";

// No more direct Gemini SDK - all calls go through secure backend
import { getConfig } from "./lib/config";


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
  // Client-side safety net: abort if total request exceeds 65s
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 65000);

  // Inactivity timer: abort if no data received for 30s
  let inactivityTimer: ReturnType<typeof setTimeout>;
  const resetInactivity = () => {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => controller.abort(), 30000);
  };
  resetInactivity();

  try {
    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: userQuery, history, files }),
      signal: controller.signal
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
    let lineBuffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        resetInactivity(); // Got data, reset inactivity timer

        const chunkText = decoder.decode(value, { stream: true });
        lineBuffer += chunkText;

        const lines = lineBuffer.split('\n');
        // Keep the last partial line in the buffer
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim().startsWith('data: ')) {
            try {
              const data = JSON.parse(line.trim().slice(6));

              if (data.type === 'datasheets') {
                referencedDatasheets = data.datasheets || [];
              } else if (data.type === 'chunk') {
                fullText = data.text || '';
                onChunk(fullText, referencedDatasheets);
              } else if (data.type === 'done') {
                fullText = data.text || fullText;
                referencedDatasheets = data.datasheets || referencedDatasheets;
                onChunk(fullText, referencedDatasheets);
              } else if (data.type === 'error') {
                throw new Error(data.error);
              }
            } catch (parseError) {
              if (parseError instanceof Error && parseError.message && !parseError.message.includes('JSON')) {
                throw parseError; // Re-throw actual errors (not JSON parse errors)
              }
              // Ignore incomplete JSON if split across lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return { text: fullText, referencedDatasheets };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw err;
  } finally {
    clearTimeout(abortTimer);
    clearTimeout(inactivityTimer!);
  }
}

