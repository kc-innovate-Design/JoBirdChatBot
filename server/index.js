import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Modality } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '10mb' }));

// Environment variables (server-side only - NEVER sent to browser)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const APP_PASSWORD = process.env.APP_PASSWORD || process.env.VITE_APP_PASSWORD || 'jobird2026';

// Initialize clients lazily
let aiInstance = null;
let supabaseInstance = null;

function getAI() {
    if (aiInstance) return aiInstance;
    if (!GEMINI_API_KEY) {
        console.error('GEMINI_API_KEY not configured');
        return null;
    }
    aiInstance = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    return aiInstance;
}

function getSupabase() {
    if (supabaseInstance) return supabaseInstance;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        console.error('Supabase not configured');
        return null;
    }
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    return supabaseInstance;
}

// System instruction for the AI
const SYSTEM_INSTRUCTION = `You are JOBIRD CABINET SELECTION ASSISTANT, a friendly and helpful advisor for JoBird's range of GRP cabinets, chests, and storage solutions.

Your role is to help customers find the right storage solution based on their requirements.

RESPONSE STYLE:
- Be friendly, conversational, and helpful
- For simple questions (like "how many datasheets?"), give a brief, natural answer WITHOUT citing sources
- Only use formal headers (INITIAL ASSESSMENT:, RECOMMENDED CABINET:, etc.) when making detailed product recommendations
- Keep responses concise and easy to read

WHEN RECOMMENDING PRODUCTS:
- Use section headers like RECOMMENDED CABINET:, KEY FEATURES:, WHY THIS WAS SELECTED:
- Cite the actual PDF filename when providing technical specifications
- Be thorough but not overly technical
- You CAN suggest cabinets based on their size, dimensions, and general characteristics even if the specific use case isn't mentioned in the datasheets
- For example: if asked about storing life jackets, recommend larger cabinets based on their internal dimensions

INFERENCE GUIDELINES:
- Look at cabinet dimensions (internal height, width, depth) to determine suitability for items
- Consider weather protection features for outdoor storage needs
- Use your judgment to match cabinet sizes to typical item dimensions
- Be clear when you're making a size-based recommendation vs citing explicit specifications

CRITICAL RULES:
1. Use information from the TECHNICAL KNOWLEDGE BASE - dimensions and specs are accurate
2. NEVER make up specifications or dimensions
3. You CAN infer suitability based on dimensions (e.g., "this cabinet's 800mm internal height should accommodate standard life jackets")
4. ONLY cite actual PDF filenames as sources - never cite "KNOWLEDGE BASE OVERVIEW"
5. For simple questions, don't add source citations at all`;

// Embed query using Gemini
async function embedQuery(text) {
    const ai = getAI();
    if (!ai) throw new Error('Gemini not configured');

    const result = await ai.models.embedContent({
        model: 'gemini-embedding-001',
        content: text,
        config: { outputDimensionality: 768 }
    });

    return result.embedding.values;
}

// Search Supabase for PDF chunks
async function searchPdfChunks(question, matchCount = 5) {
    const supabase = getSupabase();
    if (!supabase) return [];

    try {
        const embedding = await embedQuery(question);

        const { data, error } = await supabase.rpc('match_pdf_chunks', {
            query_embedding: embedding,
            match_count: matchCount
        });

        if (error) {
            console.error('Supabase RPC Error:', error);
            throw error;
        }

        const results = data || [];

        // Get sibling chunks for complete context
        const topSources = [...new Set(results.slice(0, 3).map(r => r.metadata?.source).filter(Boolean))];

        if (topSources.length > 0) {
            const { data: siblingChunks, error: siblingError } = await supabase
                .from('pdf_chunks')
                .select('id, content, metadata')
                .in('metadata->>source', topSources);

            if (!siblingError && siblingChunks) {
                const existingIds = new Set(results.map(r => r.id));
                for (const chunk of siblingChunks) {
                    if (!existingIds.has(chunk.id)) {
                        results.push({ ...chunk, similarity: 0.5 });
                    }
                }
            }
        }

        return results;
    } catch (err) {
        console.error('Search failed:', err);
        return [];
    }
}

// Extract datasheet references from search results
function extractDatasheetReferences(searchResults) {
    const uniqueSources = new Map();

    for (const result of searchResults) {
        const filename = result.metadata?.source;
        if (filename && !uniqueSources.has(filename)) {
            const displayName = filename
                .replace(/\.pdf$/i, '')
                .replace(/_/g, ' ')
                .replace(/-/g, ' ')
                .replace(/\s*\(\d+\)$/, '');

            let productName;
            const content = result.content || '';

            const pattern1 = content.match(/^[A-Z]{2}[\d.]+[A-Z]*\s+(.+?)\s+Typical use/i);
            if (pattern1) {
                productName = pattern1[1].trim();
            } else {
                const pattern2 = content.match(/^(.+?)\s*\([A-Z]{2}\d+[A-Z]*\)/);
                if (pattern2 && pattern2[1].length > 8 && pattern2[1].length < 60) {
                    productName = pattern2[1].trim();
                } else {
                    const pattern3 = content.match(/Typical use:?\s*For\s+(?:the\s+)?storage\s+of\s+(?:approximately\s+)?(?:\d+\s+)?(.+?)(?:\s+in|\s+\.|\s+This|$)/i);
                    if (pattern3 && pattern3[1].length > 3 && pattern3[1].length < 40) {
                        productName = pattern3[1].charAt(0).toUpperCase() + pattern3[1].slice(1) + ' Cabinet';
                    }
                }
            }

            if (productName) {
                productName = productName.replace(/[:\-–]$/, '').trim();
                if (productName.length < 5) productName = undefined;
            }

            uniqueSources.set(filename, { filename, displayName, productName });
        }
    }

    return Array.from(uniqueSources.values());
}

// Build conversation context
function buildConversationContext(history) {
    if (!history || history.length <= 1) return '';

    const recentHistory = history.slice(-10);
    let context = 'CONVERSATION CONTEXT (for follow-up questions):\n';

    for (const msg of recentHistory) {
        const role = msg.role === 'user' ? 'Customer' : 'Assistant';
        const content = msg.content.length > 500 ? msg.content.substring(0, 500) + '...' : msg.content;
        context += `${role}: ${content}\n`;
    }

    return context + '\n---\n';
}

// Get knowledge base stats for context
async function getKnowledgeBaseStats() {
    const supabase = getSupabase();
    if (!supabase) return { totalDatasheets: 0, sampleProducts: [] };

    try {
        const { data: sources } = await supabase
            .from('pdf_chunks')
            .select('metadata');

        const uniqueSources = new Set(sources?.map(s => s.metadata?.source).filter(Boolean) || []);
        const sampleProducts = Array.from(uniqueSources).slice(0, 10).map(s => s.replace(/\.pdf$/i, ''));

        return {
            totalDatasheets: uniqueSources.size,
            sampleProducts
        };
    } catch (err) {
        console.error('Failed to get KB stats:', err);
        return { totalDatasheets: 0, sampleProducts: [] };
    }
}

// API Routes

// Password verification
app.post('/api/verify-password', (req, res) => {
    const { password } = req.body;
    res.json({ valid: password === APP_PASSWORD });
});

// Runtime configuration for the frontend
// Only exposes non-sensitive Firebase keys and the restricted Live Mode key
app.get('/api/config', (req, res) => {
    res.json({
        VITE_FIREBASE_API_KEY: process.env.VITE_FIREBASE_API_KEY,
        VITE_FIREBASE_AUTH_DOMAIN: process.env.VITE_FIREBASE_AUTH_DOMAIN,
        VITE_FIREBASE_PROJECT_ID: process.env.VITE_FIREBASE_PROJECT_ID,
        VITE_FIREBASE_STORAGE_BUCKET: process.env.VITE_FIREBASE_STORAGE_BUCKET,
        VITE_FIREBASE_MESSAGING_SENDER_ID: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        VITE_FIREBASE_APP_ID: process.env.VITE_FIREBASE_APP_ID,
        VITE_FIREBASE_MEASUREMENT_ID: process.env.VITE_FIREBASE_MEASUREMENT_ID,
        VITE_GEMINI_LIVE_API_KEY: process.env.VITE_GEMINI_LIVE_API_KEY || process.env.GEMINI_API_KEY,
        VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || SUPABASE_URL
    });
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { query, history } = req.body;

        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }

        // Search for relevant context
        console.log('[server] Searching for:', query);
        const searchResults = await searchPdfChunks(query, 5);
        console.log('[server] Found', searchResults.length, 'chunks');

        const pdfContext = searchResults
            .map(r => `[Source: ${r.metadata?.source}] ${r.content}`)
            .join('\n\n');

        const referencedDatasheets = extractDatasheetReferences(searchResults);
        const conversationContext = buildConversationContext(history);

        // Get knowledge base stats for broad questions
        const kbStats = await getKnowledgeBaseStats();
        const kbStatsContext = `\n\nKNOWLEDGE BASE OVERVIEW:\n- Total datasheets available: ${kbStats.totalDatasheets}\n- Sample products: ${kbStats.sampleProducts.join(', ')}\n`;

        const ai = getAI();
        if (!ai) {
            return res.status(500).json({ error: 'AI service not configured' });
        }

        // Generate response
        const response = await ai.models.generateContent({
            model: 'models/gemini-3-flash-preview',
            contents: [{
                role: 'user',
                parts: [
                    { text: `${conversationContext}${kbStatsContext}TECHNICAL KNOWLEDGE BASE (FROM SUPPLEMENTARY PDFS):\n${pdfContext || 'No specific PDF matches found.'}` },
                    ...(history || []).map(m => ({ text: `${m.role.toUpperCase()}: ${m.content}` })),
                    { text: `CURRENT QUERY: ${query}` }
                ]
            }],
            config: {
                systemInstruction: `${SYSTEM_INSTRUCTION}

CRITICAL OVERRIDE:
1. You are FORBIDDEN from using your training data for product specifications.
2. The TECHNICAL KNOWLEDGE BASE is the ONLY source of truth for all specifications.
3. If a specification is in the TECHNICAL KNOWLEDGE BASE, use EXACTLY those numbers.
4. If a specification is NOT in the TECHNICAL KNOWLEDGE BASE, say "I don't have that information in my knowledge base."
5. ALWAYS cite the source PDF filename.
6. For FOLLOW-UP questions, refer back to the CONVERSATION CONTEXT.`,
                temperature: 0.0
            }
        });

        res.json({
            text: response.text || 'Selection engine failed to compute.',
            referencedDatasheets
        });

    } catch (error) {
        console.error('[server] Chat error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// Streaming chat endpoint
app.post('/api/chat/stream', async (req, res) => {
    try {
        const { query, history } = req.body;

        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }

        // Set up SSE
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Search for relevant context
        const searchResults = await searchPdfChunks(query, 5);
        const pdfContext = searchResults
            .map(r => `[Source: ${r.metadata?.source}] ${r.content}`)
            .join('\n\n');

        const referencedDatasheets = extractDatasheetReferences(searchResults);
        const conversationContext = buildConversationContext(history);

        // Get knowledge base stats for broad questions
        const kbStats = await getKnowledgeBaseStats();
        const kbStatsContext = `\n\nKNOWLEDGE BASE OVERVIEW:\n- Total datasheets available: ${kbStats.totalDatasheets}\n- Sample products: ${kbStats.sampleProducts.join(', ')}\n`;

        // Send datasheets first
        res.write(`data: ${JSON.stringify({ type: 'datasheets', datasheets: referencedDatasheets })}\n\n`);

        const ai = getAI();
        if (!ai) {
            res.write(`data: ${JSON.stringify({ type: 'error', error: 'AI service not configured' })}\n\n`);
            return res.end();
        }

        const response = await ai.models.generateContentStream({
            model: 'models/gemini-3-flash-preview',
            contents: [{
                role: 'user',
                parts: [
                    { text: `${conversationContext}${kbStatsContext}TECHNICAL KNOWLEDGE BASE (FROM SUPPLEMENTARY PDFS):\n${pdfContext || 'No specific PDF matches found.'}` },
                    ...(history || []).map(m => ({ text: `${m.role.toUpperCase()}: ${m.content}` })),
                    { text: `CURRENT QUERY: ${query}` }
                ]
            }],
            config: {
                systemInstruction: `${SYSTEM_INSTRUCTION}

CRITICAL OVERRIDE:
1. You are FORBIDDEN from using your training data for product specifications.
2. The TECHNICAL KNOWLEDGE BASE is the ONLY source of truth for all specifications.
3. If a specification is in the TECHNICAL KNOWLEDGE BASE, use EXACTLY those numbers.
4. If a specification is NOT in the TECHNICAL KNOWLEDGE BASE, say "I don't have that information in my knowledge base."
5. ALWAYS cite the source PDF filename.
6. For FOLLOW-UP questions, refer back to the CONVERSATION CONTEXT.`,
                temperature: 0.0
            }
        });

        let fullText = '';
        for await (const chunk of response) {
            const chunkText = chunk.text || '';
            if (chunkText) {
                fullText += chunkText;
                res.write(`data: ${JSON.stringify({ type: 'chunk', text: fullText })}\n\n`);
            }
        }

        res.write(`data: ${JSON.stringify({ type: 'done', text: fullText, datasheets: referencedDatasheets })}\n\n`);
        res.end();

    } catch (error) {
        console.error('[server] Stream error:', error);
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
        res.end();
    }
});

// Knowledge base stats endpoint
app.get('/api/stats', async (req, res) => {
    try {
        const categoryKeyword = req.query.category;
        const supabase = getSupabase();

        if (!supabase) {
            return res.status(500).json({ error: 'Database not configured' });
        }

        const { data: sources, error } = await supabase
            .from('pdf_chunks')
            .select('metadata');

        if (error) {
            throw error;
        }

        const uniqueSources = new Set(sources.map(s => s.metadata?.source).filter(Boolean));
        const totalDatasheets = uniqueSources.size;

        if (categoryKeyword) {
            const keyword = categoryKeyword.toLowerCase();
            const matchingSources = new Set();

            for (const s of sources) {
                const source = s.metadata?.source?.toLowerCase() || '';
                if (source.includes(keyword)) {
                    matchingSources.add(s.metadata?.source);
                }
            }

            // Also search content
            const { data: contentMatches } = await supabase
                .from('pdf_chunks')
                .select('metadata')
                .ilike('content', `%${categoryKeyword}%`);

            if (contentMatches) {
                for (const c of contentMatches) {
                    if (c.metadata?.source) {
                        matchingSources.add(c.metadata.source);
                    }
                }
            }

            const datasheetList = Array.from(matchingSources).sort();

            return res.json({
                totalDatasheets,
                categoryMatches: [{
                    keyword: categoryKeyword,
                    count: matchingSources.size,
                    datasheets: datasheetList
                }]
            });
        }

        res.json({ totalDatasheets });

    } catch (error) {
        console.error('[server] Stats error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// Search endpoint (for direct searches)
app.post('/api/search', async (req, res) => {
    try {
        const { query, matchCount = 5 } = req.body;

        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }

        const results = await searchPdfChunks(query, matchCount);
        res.json({ results });

    } catch (error) {
        console.error('[server] Search error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// Text-to-speech endpoint
app.post('/api/speech', async (req, res) => {
    try {
        const { text } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }

        const ai = getAI();
        if (!ai) {
            return res.status(500).json({ error: 'AI service not configured' });
        }

        const response = await ai.models.generateContent({
            model: 'models/gemini-3-flash-preview',
            contents: [{ parts: [{ text: `Recommendation: ${text}` }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: 'Kore' }
                    }
                }
            }
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        res.json({ audio: base64Audio });

    } catch (error) {
        console.error('[server] Speech error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// Serve static files from dist
app.use(express.static(path.join(__dirname, '..', 'dist')));

// SPA fallback - serve index.html for all non-API routes
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
    }
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`GEMINI_API_KEY: ${GEMINI_API_KEY ? 'configured' : 'MISSING'}`);
    console.log(`SUPABASE_URL: ${SUPABASE_URL ? 'configured' : 'MISSING'}`);
    console.log(`SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY ? 'configured' : 'MISSING'}`);
});
