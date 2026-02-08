
import { GoogleGenAI, Modality } from "@google/genai";
import { Message, AIResponse, DatasheetReference } from "./types";
import { SYSTEM_INSTRUCTION } from "./constants";
import { searchPdfChunks, getKnowledgeBaseStats, PdfChunkMatch } from "./lib/supabaseSearch";
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

// Detect if the query is a meta-query about the knowledge base
function isMetaQuery(query: string): { isMeta: boolean; categoryKeyword?: string } {
  const lowerQuery = query.toLowerCase();

  // Check for count/how many questions
  const countPatterns = [
    /how many (data\s?sheets?|pdfs?|documents?|files?)/i,
    /count (data\s?sheets?|pdfs?|documents?)/i,
    /total (data\s?sheets?|pdfs?|documents?)/i,
    /number of (data\s?sheets?|pdfs?|documents?)/i,
  ];

  for (const pattern of countPatterns) {
    if (pattern.test(query)) {
      return { isMeta: true };
    }
  }

  // Check for category count questions (e.g., "how many cabinets for life jackets")
  const categoryPatterns = [
    /how many.*(for|about|related to|regarding)\s+(.+)/i,
    /which.*(cabinets?|products?).*(for|store|hold)\s+(.+)/i,
  ];

  for (const pattern of categoryPatterns) {
    const match = query.match(pattern);
    if (match) {
      // Extract the category keyword
      const keyword = match[match.length - 1]?.trim().replace(/[?.,!]/g, '');
      if (keyword && keyword.length > 2) {
        return { isMeta: true, categoryKeyword: keyword };
      }
    }
  }

  return { isMeta: false };
}

// Extract datasheet references from search results
function extractDatasheetReferences(searchResults: PdfChunkMatch[]): DatasheetReference[] {
  const uniqueSources = new Map<string, DatasheetReference>();

  for (const result of searchResults) {
    const filename = result.metadata?.source;
    if (filename && !uniqueSources.has(filename)) {
      // Create a display name from the filename - keep full name
      const displayName = filename
        .replace(/\.pdf$/i, '')
        .replace(/_/g, ' ')
        .replace(/-/g, ' ')
        .replace(/\s*\(\d+\)$/, ''); // Only remove duplicate markers like (1)

      // Try to extract product name from content
      // Format 1: "JB10.600LJS Life jacket Cabinet Typical use:..."
      // Format 2: "2 x 30M Fire Hose cabinet (JB02HR)"
      // Format 3: "Typical use: For storage of X" - extract what's being stored
      let productName: string | undefined;
      const content = result.content || '';

      // Pattern 1: "MODEL ProductName Typical use:" - extract the middle part
      const pattern1 = content.match(/^[A-Z]{2}[\d.]+[A-Z]*\s+(.+?)\s+Typical use/i);
      if (pattern1) {
        productName = pattern1[1].trim();
      } else {
        // Pattern 2: "ProductName (MODEL)" format
        const pattern2 = content.match(/^(.+?)\s*\([A-Z]{2}\d+[A-Z]*\)/);
        if (pattern2) {
          const extracted = pattern2[1].trim();
          if (extracted.length > 8 && extracted.length < 60) {
            productName = extracted;
          }
        } else {
          // Pattern 3: "Typical use: For storage of X life jackets" -> "Life Jacket Cabinet"
          const pattern3 = content.match(/Typical use:?\s*For\s+(?:the\s+)?storage\s+of\s+(?:approximately\s+)?(?:\d+\s+)?(.+?)(?:\s+in|\s+\.|\s+This|$)/i);
          if (pattern3) {
            const stored = pattern3[1].trim();
            // Capitalize and add "Cabinet"
            if (stored.length > 3 && stored.length < 40) {
              productName = stored.charAt(0).toUpperCase() + stored.slice(1) + ' Cabinet';
            }
          }
        }
      }

      // Clean up productName
      if (productName) {
        productName = productName.replace(/[:\-–]$/, '').trim();
        if (productName.length < 5) {
          productName = undefined;
        }
      }

      uniqueSources.set(filename, {
        filename,
        displayName,
        productName
      });
    }
  }

  return Array.from(uniqueSources.values());
}

// Build conversation context from history
function buildConversationContext(history: Message[]): string {
  if (history.length <= 1) return "";

  // Get the last 5 exchanges for context
  const recentHistory = history.slice(-10);

  let context = "CONVERSATION CONTEXT (for follow-up questions):\n";
  for (const msg of recentHistory) {
    const role = msg.role === 'user' ? 'Customer' : 'Assistant';
    // Truncate long messages
    const content = msg.content.length > 500
      ? msg.content.substring(0, 500) + '...'
      : msg.content;
    context += `${role}: ${content}\n`;
  }
  context += "\n---\n";

  return context;
}

export async function getSelectionResponse(
  userQuery: string,
  history: Message[]
): Promise<AIResponse> {
  // 1️⃣ Check if this is a meta-query
  const metaCheck = isMetaQuery(userQuery);

  if (metaCheck.isMeta) {
    const stats = await getKnowledgeBaseStats(metaCheck.categoryKeyword);

    let metaResponse: string;
    let referencedDatasheets: DatasheetReference[] = [];

    if (metaCheck.categoryKeyword) {
      const match = stats.categoryMatches?.[0];
      const count = match?.count || 0;
      const datasheets = match?.datasheets || [];

      // Format the datasheet list
      let datasheetListStr = '';
      if (datasheets.length > 0) {
        datasheetListStr = '\n\nRelevant datasheets:\n';
        datasheets.forEach((ds, i) => {
          const displayName = ds.replace(/\.pdf$/i, '').replace(/_/g, ' ').replace(/-/g, ' ');
          datasheetListStr += `${i + 1}. ${displayName}\n`;
        });

        // Also populate the sidebar
        referencedDatasheets = datasheets.map(ds => ({
          filename: ds,
          displayName: ds.replace(/\.pdf$/i, '').replace(/_/g, ' ').replace(/-/g, ' ')
        }));
      }

      metaResponse = `KNOWLEDGE BASE INFORMATION:\n\nI have ${stats.totalDatasheets} product datasheets in my knowledge base.\n\nFor "${metaCheck.categoryKeyword}", I found ${count} relevant datasheet${count !== 1 ? 's' : ''}.${datasheetListStr}\nClick on any datasheet in the sidebar for more details.`;
    } else {
      metaResponse = `KNOWLEDGE BASE INFORMATION:\n\nI have ${stats.totalDatasheets} product datasheets in my knowledge base covering JoBird's full range of GRP cabinets, chests, and storage solutions.\n\nYou can ask me about specific products, categories (like life jackets, fire extinguishers, breathing apparatus), or describe your storage requirements and I'll recommend the best cabinet.`;
    }

    return {
      text: metaResponse,
      referencedDatasheets
    };
  }

  // 2️⃣ Search Supabase for relevant PDF context
  console.log('[geminiService] Searching for:', userQuery);
  const searchResults = await searchPdfChunks(userQuery, 5);
  console.log('[geminiService] Found', searchResults.length, 'chunks');
  const pdfContext = searchResults.map(r => `[Source: ${r.metadata.source}] ${r.content}`).join("\n\n");

  // 3️⃣ Extract datasheet references
  const referencedDatasheets = extractDatasheetReferences(searchResults);

  // 4️⃣ Build conversation context for follow-ups
  const conversationContext = buildConversationContext(history);

  // 5️⃣ Initialize the GoogleGenAI client safely.
  const ai = getAI();
  if (!ai) throw new Error("Gemini AI client not initialized");

  // 6️⃣ Query GenAI with retrieved context and conversation history
  console.log('[geminiService] Calling Gemini API...');
  try {
    const response = await ai.models.generateContent({
      model: 'models/gemini-3-flash-preview',
      contents: [
        {
          role: 'user',
          parts: [
            { text: `${conversationContext}TECHNICAL KNOWLEDGE BASE (FROM SUPPLEMENTARY PDFS):\n${pdfContext || "No specific PDF matches found."}` },
            ...history.map(m => ({ text: `${m.role.toUpperCase()}: ${m.content}` })),
            { text: `CURRENT QUERY: ${userQuery}` }
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
6. If the query includes a model name like JB04SS, prioritize the chunk that contains that exact model name.
7. For FOLLOW-UP questions, ALWAYS refer back to the CONVERSATION CONTEXT to understand what cabinet/product was being discussed.
8. If the user says "that one", "the first one", "this cabinet", etc., identify the cabinet from the previous messages.`,
        temperature: 0.0,
      }
    });

    console.log('[geminiService] Gemini API response received');
    // Extract generated text content
    const text = response.text || "Selection engine failed to compute. Please check inputs.";

    return {
      text,
      referencedDatasheets
    };
  } catch (apiError: any) {
    console.error('[geminiService] Gemini API Error:', apiError);
    throw new Error(`Gemini API Error: ${apiError.message || 'Unknown error'}`);
  }
}

// Streaming version of getSelectionResponse
export async function getSelectionResponseStream(
  userQuery: string,
  history: Message[],
  onChunk: (text: string, referencedDatasheets: DatasheetReference[]) => void
): Promise<AIResponse> {
  // 1️⃣ Check if this is a meta-query (no streaming for meta-queries)
  const metaCheck = isMetaQuery(userQuery);

  if (metaCheck.isMeta) {
    const stats = await getKnowledgeBaseStats(metaCheck.categoryKeyword);

    let metaResponse: string;
    let referencedDatasheets: DatasheetReference[] = [];

    if (metaCheck.categoryKeyword) {
      const match = stats.categoryMatches?.[0];
      const count = match?.count || 0;
      const datasheets = match?.datasheets || [];

      let datasheetListStr = '';
      if (datasheets.length > 0) {
        datasheetListStr = '\n\nRelevant datasheets:\n';
        datasheets.forEach((ds, i) => {
          const displayName = ds.replace(/\.pdf$/i, '').replace(/_/g, ' ').replace(/-/g, ' ');
          datasheetListStr += `${i + 1}. ${displayName}\n`;
        });

        referencedDatasheets = datasheets.map(ds => ({
          filename: ds,
          displayName: ds.replace(/\.pdf$/i, '').replace(/_/g, ' ').replace(/-/g, ' ')
        }));
      }

      metaResponse = `KNOWLEDGE BASE INFORMATION:\n\nI have ${stats.totalDatasheets} product datasheets in my knowledge base.\n\nFor "${metaCheck.categoryKeyword}", I found ${count} relevant datasheet${count !== 1 ? 's' : ''}.${datasheetListStr}\nClick on any datasheet in the sidebar for more details.`;
    } else {
      metaResponse = `KNOWLEDGE BASE INFORMATION:\n\nI have ${stats.totalDatasheets} product datasheets in my knowledge base covering JoBird's full range of GRP cabinets, chests, and storage solutions.\n\nYou can ask me about specific products, categories (like life jackets, fire extinguishers, breathing apparatus), or describe your storage requirements and I'll recommend the best cabinet.`;
    }

    // For meta-queries, just call onChunk once with full response
    onChunk(metaResponse, referencedDatasheets);
    return { text: metaResponse, referencedDatasheets };
  }

  // 2️⃣ Search Supabase for relevant PDF context
  console.log('[geminiService] Streaming search for:', userQuery);
  const searchResults = await searchPdfChunks(userQuery, 5);
  console.log('[geminiService] Found', searchResults.length, 'chunks');
  const pdfContext = searchResults.map(r => `[Source: ${r.metadata.source}] ${r.content}`).join("\n\n");

  // 3️⃣ Extract datasheet references
  const referencedDatasheets = extractDatasheetReferences(searchResults);

  // Call onChunk immediately with empty text but with datasheets to populate sidebar
  onChunk('', referencedDatasheets);

  // 4️⃣ Build conversation context for follow-ups
  const conversationContext = buildConversationContext(history);

  // 5️⃣ Initialize the GoogleGenAI client safely.
  const ai = getAI();
  if (!ai) throw new Error("Gemini AI client not initialized");

  // 6️⃣ Query GenAI with streaming
  console.log('[geminiService] Calling Gemini API with streaming...');
  try {
    const response = await ai.models.generateContentStream({
      model: 'models/gemini-3-flash-preview',
      contents: [
        {
          role: 'user',
          parts: [
            { text: `${conversationContext}TECHNICAL KNOWLEDGE BASE (FROM SUPPLEMENTARY PDFS):\n${pdfContext || "No specific PDF matches found."}` },
            ...history.map(m => ({ text: `${m.role.toUpperCase()}: ${m.content}` })),
            { text: `CURRENT QUERY: ${userQuery}` }
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
6. If the query includes a model name like JB04SS, prioritize the chunk that contains that exact model name.
7. For FOLLOW-UP questions, ALWAYS refer back to the CONVERSATION CONTEXT to understand what cabinet/product was being discussed.
8. If the user says "that one", "the first one", "this cabinet", etc., identify the cabinet from the previous messages.`,
        temperature: 0.0,
      }
    });

    let fullText = '';

    // Process the stream
    for await (const chunk of response) {
      const chunkText = chunk.text || '';
      if (chunkText) {
        fullText += chunkText;
        onChunk(fullText, referencedDatasheets);
      }
    }

    console.log('[geminiService] Streaming complete');

    return {
      text: fullText || "Selection engine failed to compute. Please check inputs.",
      referencedDatasheets
    };
  } catch (apiError: any) {
    console.error('[geminiService] Gemini Streaming API Error:', apiError);
    throw new Error(`Gemini API Error: ${apiError.message || 'Unknown error'}`);
  }
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
    model: "models/gemini-3-flash-preview",
    contents: [{ parts: [{ text: `Recommendation: ${cleanSpeechText}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
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
