import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { GoogleGenAI, Modality } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '10mb' }));

// Sanitize all environment variables (important for production pastes with whitespace/tabs)
Object.keys(process.env).forEach(key => {
    const cleanKey = key.trim();
    if (process.env[key]) {
        const cleanValue = process.env[key].toString().trim();
        if (cleanKey !== key || cleanValue !== process.env[key]) {
            console.log(`[server] Sanitized env var: "${key}"`);
            process.env[cleanKey] = cleanValue;
        }
    }
});

// Environment variables (server-side only - NEVER sent to browser)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const APP_PASSWORD = process.env.APP_PASSWORD || process.env.VITE_APP_PASSWORD || 'jobird2026';

let aiInstance = null;
let supabaseInstance = null;

// Caching for Knowledge Base stats to prevent hanging
let kbStatsCache = null;
let kbStatsLastUpdated = 0;
const KB_STATS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getAI() {
    if (aiInstance) return aiInstance;

    // Refresh keys from process.env to be safe in dynamic environments
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

    if (!apiKey) {
        console.error('[server] CRITICAL: GEMINI_API_KEY not configured in process.env');
        console.log('[server] Available env vars:', Object.keys(process.env).filter(k => k.includes('GEMINI') || k.includes('SUPABASE')));
        return null;
    }

    console.log('[server] Initializing GoogleGenAI with key length:', apiKey.length);
    aiInstance = new GoogleGenAI({ apiKey: apiKey });
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
// System instruction for the AI
const SYSTEM_INSTRUCTION = `You are JoBird Cabinet Advisor, a concise and helpful assistant for JoBird salespeople and sales trainees.

YOUR PURPOSE:
Help sales staff quickly identify the correct GRP cabinet for their customer's requirements. Keep responses SHORT and scannable.

RESPONSE FORMAT (CRITICAL):
For each product recommendation, provide ONLY:
1. **Product Name** (bold, e.g., **JB02HR**)
2. A 2-sentence summary of why it fits the requirement

Example response:
**JB02HR** — Fire hose cabinet for 2 x 30M hoses. Dimensions: 937 x 835 x 347mm, IP56 rated with Lloyds approval.

**JB17** — Large life jacket cabinet for up to 24 suits. Arctic-rated options with heaters and insulation available.

DO NOT provide full specifications unless the user explicitly asks for more details. Keep initial responses brief so the chat stays clean.

FORMATTING RULES:
1. Use **bold** for product names only.
2. NO markdown symbols (###, *, -) for formatting.
3. One product per short paragraph.
4. Source citation at the end only if relevant (e.g., "Source: JB02HR Datasheet").

FOLLOW-UP QUESTIONS:
At the end, provide exactly 3 datasheet-related follow-up questions (comparisons, specs, features). NO questions about lead times, CAD, pricing, or availability.
Format: [[FOLLOWUP]] Question 1 | Question 2 | Question 3

RULES:
1. NEVER hallucinate specs - use exact numbers from context.
2. If info is missing, say: "I don't have that detail in the datasheets."
3. Ignore any files with "test" in the name.`;

// Embed query using Gemini
async function embedQuery(text) {
    const ai = getAI();
    if (!ai) throw new Error('Gemini not configured');

    console.log(`[server] Getting embedding for text (length: ${text.length})...`);

    // Added timeout for embedding
    const result = await Promise.race([
        ai.models.embedContent({
            model: 'gemini-embedding-001',
            content: text,
            config: { outputDimensionality: 768 }
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Embedding Timeout')), 15000))
    ]);

    return result.embedding.values;
}

// Search Supabase for PDF chunks
// Search Supabase for PDF chunks
async function searchPdfChunks(question, matchCount = 10) {
    const supabase = getSupabase();
    if (!supabase) return [];

    try {
        console.log(`[server] Hybrid Search for: "${question}"`);
        let results = [];
        const existingIds = new Set();

        // 1. Keyword search (very reliable for specific part numbers)
        // Updated regex to catch JoBird codes with dots and suffixes (e.g., JB10.600LJS)
        const partMatch = question.match(/[A-Z]{2,3}[\d.]+[A-Z]*/i);
        if (partMatch) {
            const partNumber = partMatch[0];
            const { data: keywordData } = await supabase
                .from('pdf_chunks')
                .select('id, content, metadata')
                .or(`content.ilike.%${partNumber}%,metadata->>source.ilike.%${partNumber}%`)
                .limit(matchCount);

            if (keywordData) {
                for (const chunk of keywordData) {
                    if (chunk.metadata?.source?.toLowerCase().includes('test') || chunk.content?.toLowerCase().includes('test data')) continue;
                    results.push({ ...chunk, similarity: 2.0 });
                    existingIds.add(chunk.id);
                }
            }
        }

        // 2. Priority Synonym/Fuzzy Match
        const normalizedQuery = question.toLowerCase();
        const synonymMap = {
            'life jacket': 'lifejacket',
            'life jackets': 'lifejacket',
            'breathing apparatus': 'ba',
            'fire extinguisher': 'fe',
            'first aid': 'fa',
            'emergency': 'sos',
            'hosepipe': 'hose',
            'hosepipes': 'hose'
        };

        let fuzzyTerms = [];
        Object.entries(synonymMap).forEach(([phrase, synonym]) => {
            if (normalizedQuery.includes(phrase)) fuzzyTerms.push(synonym);
        });
        if (normalizedQuery.includes(' ')) {
            fuzzyTerms.push(normalizedQuery.replace(/\s+/g, ''));
        }
        const individualWords = normalizedQuery.split(/[\s.\-_]+/).filter(w => w.length > 3 && !w.match(/tell|about|show|what|have|find|with|does|include|list|cabinets|will|hold/i));
        fuzzyTerms = [...new Set([...fuzzyTerms, ...individualWords])];

        if (fuzzyTerms.length > 0) {
            const orQuery = fuzzyTerms.map(term => `content.ilike.%${term}%,metadata->>source.ilike.%${term}%`).join(',');
            const { data: fuzzyData } = await supabase.from('pdf_chunks').select('id, content, metadata').or(orQuery).limit(matchCount);
            if (fuzzyData) {
                for (const chunk of fuzzyData) {
                    if (chunk.metadata?.source?.toLowerCase().includes('test') || chunk.content?.toLowerCase().includes('test data')) continue;
                    if (!existingIds.has(chunk.id)) {
                        results.push({ ...chunk, similarity: 1.5 });
                        existingIds.add(chunk.id);
                    }
                }
            }
        }

        // 3. Vector search (Semantic)
        try {
            const embedding = await Promise.race([
                embedQuery(question),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Embedding Timeout')), 15000))
            ]);
            const { data: vectorData } = await supabase.rpc('match_pdf_chunks', {
                query_embedding: embedding,
                match_count: matchCount
            });
            if (vectorData) {
                for (const chunk of vectorData) {
                    if (!existingIds.has(chunk.id)) {
                        results.push(chunk);
                        existingIds.add(chunk.id);
                    }
                }
            }
        } catch (vErr) {
            console.warn(`[server] Vector Search skipped/failed: ${vErr.message}`);
        }

        results.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
        const deduplicated = [];
        const sourceCounts = new Map();
        for (const res of results) {
            const source = res.metadata?.source;
            const count = sourceCounts.get(source) || 0;
            if (count < 2) {
                deduplicated.push(res);
                sourceCounts.set(source, count + 1);
            }
            if (deduplicated.length >= matchCount) break;
        }

        const topSources = [...new Set(deduplicated.slice(0, 8).map(r => r.metadata?.source).filter(Boolean))];
        if (topSources.length > 0) {
            const { data: siblingChunks, error: siblingError } = await supabase
                .from('pdf_chunks')
                .select('id, content, metadata')
                .in('metadata->>source', topSources);
            if (!siblingError && siblingChunks) {
                const finalExistingIds = new Set(deduplicated.map(r => r.id));
                for (const chunk of siblingChunks) {
                    if (chunk.metadata?.source?.toLowerCase().includes('test')) continue;
                    if (!finalExistingIds.has(chunk.id)) {
                        deduplicated.push({ ...chunk, similarity: 0.2 });
                    }
                }
            }
        }
        return deduplicated;
    } catch (err) {
        console.error('Search failed:', err);
        return [];
    }
}

// Expand short queries into descriptive search terms
async function expandQuery(query, history) {
    // Skip expansion for alphanumeric part numbers anywhere in the query (unanchored regex)
    // Also skip filenames with underscores/dashes to preserve exact identifiers
    if (query.match(/[A-Z]{2,3}[\d.]+[A-Z]*/i) || query.includes('_') || query.includes('-')) {
        return query;
    }

    if (query.length > 4 || query.includes(' ')) {
        // Apply expansion to almost everything except very short codes or exact part numbers
        // but keep the bypass for obvious part numbers/filenames
        // NO STRICT REGEX MATCH REQUIRED - let Gemini decide if it needs expansion
    } else {
        return query;
    }

    const ai = getAI();
    if (!ai) return query;

    try {
        console.log(`[server] Expanding query: "${query}" using gemini-2.0-flash-lite...`);
        const conversationSummary = (history || []).slice(-3)
            .map(m => `${m.role.toUpperCase()}: ${m.content}`)
            .join('\n');

        // Added timeout to prevent hang
        const result = await Promise.race([
            ai.models.generateContent({
                model: 'models/gemini-2.0-flash-lite',
                contents: [{
                    role: 'user',
                    parts: [{
                        text: `Based on this conversation history, expand the user's short query into a descriptive search query for a technical manual database.
                        
                        HISTORY:
                        ${conversationSummary}
                        
                        QUERY: "${query}"
                        
                        RESPONSE: (Just the expanded query, no decoration)`
                    }]
                }],
                config: {
                    temperature: 0.1,
                    maxOutputTokens: 50
                }
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Expand Query Timeout')), 10000))
        ]);

        const expanded = result.response.text().trim().replace(/^"|"$/g, '');
        console.log(`[server] Expanded "${query}" -> "${expanded}"`);
        return expanded;
    } catch (err) {
        console.warn('[server] Query expansion skipped/failed:', err.message);
        return query;
    }
}

// Decompose a complex enquiry into multiple search targets
async function decomposeEnquiry(query) {
    if (query.length < 150) return [query]; // Don't decompose short queries

    const ai = getAI();
    if (!ai) return [query];

    try {
        console.log(`[server] Decomposing complex enquiry...`);
        // Added timeout to prevent hang
        const result = await Promise.race([
            ai.models.generateContent({
                model: 'models/gemini-2.0-flash-lite',
                contents: [{
                    role: 'user',
                    parts: [{
                        text: `Analyze this complex customer enquiry and break it down into 2-4 distinct product categories or technical requirements.
                        Each category should be a short descriptive search phrase (e.g. "Life Jacket Cabinets Offshore", "SCBA storage with IP56 rating").
                        
                        ENQUIRY:
                        ${query}
                        
                        RESPONSE FORMAT:
                        Phrase 1
                        Phrase 2
                        (Just the phrases, one per line)`
                    }]
                }],
                config: {
                    temperature: 0.1,
                    maxOutputTokens: 100
                }
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Decompose Enquiry Timeout')), 10000))
        ]);

        const phrases = result.response.text().split('\n').map(p => p.trim()).filter(p => p.length > 5);
        console.log(`[server] Decomposed enquiry into:`, phrases);
        return phrases.length > 0 ? phrases : [query];
    } catch (err) {
        console.warn('[server] Enquiry decomposition skipped/failed:', err.message);
        return [query];
    }
}

// Extract datasheet references from search results
function extractDatasheetReferences(searchResults) {
    const uniqueSources = new Map();

    for (const result of searchResults) {
        const filename = result.metadata?.source;
        // FINAL SAFETY CHECK FOR TEST DATA
        if (filename && filename.toLowerCase().includes('test')) continue;

        if (filename) {
            // Normalize for deduplication (case-insensitive, trimmed)
            const normalizedKey = filename.toLowerCase().trim();

            if (!uniqueSources.has(normalizedKey)) {
                // Create clean display name from filename
                // e.g., "JB38.700SS Safety Station Datasheet 2024.pdf" -> "JB38.700SS Safety Station Datasheet 2024"
                const displayName = filename
                    .replace(/\.pdf$/i, '')
                    .replace(/_/g, ' ')
                    .replace(/\s*\(\d+\)$/, '') // Remove copy numbers like (1)
                    .trim();

                uniqueSources.set(normalizedKey, {
                    filename,
                    displayName,
                    url: `${SUPABASE_URL}/storage/v1/object/public/datasheets/${encodeURIComponent(filename)}`
                });
            }
        }
    }

    return Array.from(uniqueSources.values());
}

// Filter datasheets to only include those actually cited in the AI response
function filterDatasheetsByCitations(responseText, allDatasheets) {
    if (!responseText || !allDatasheets || allDatasheets.length === 0) {
        console.log('[filter] No response or datasheets to filter');
        return [];
    }

    // Extract source citations like "Source: RS550 Datasheet 2022.pdf" or "Source: JB02HR Datasheet"
    const sourcePattern = /Source:\s*([^\n\)]+)(?:\.pdf)?/gi;
    const productCodePattern = /\*\*([A-Z]{2,3}[\d.]+[A-Z]*)\*\*/g;

    const citedSources = new Set();
    let match;

    // Extract from "Source:" citations
    while ((match = sourcePattern.exec(responseText)) !== null) {
        const source = match[1].trim().toLowerCase()
            .replace(/\.pdf$/i, '')
            .replace(/[).,:\s]+$/, '')
            .replace(/^[(\s]+/, '');
        citedSources.add(source);
        console.log('[filter] Found source citation:', source);
    }

    // Extract from **ProductCode** bold mentions (e.g., **RS550**, **JB02HR**)
    while ((match = productCodePattern.exec(responseText)) !== null) {
        const productCode = match[1].toLowerCase();
        citedSources.add(productCode);
        console.log('[filter] Found product code:', productCode);
    }

    console.log('[filter] All cited sources:', Array.from(citedSources));
    console.log('[filter] Available datasheets:', allDatasheets.map(d => d.filename));

    // Filter datasheets that match any cited source
    const filtered = allDatasheets.filter(ds => {
        const filename = ds.filename.toLowerCase().replace(/\.pdf$/i, '');

        // Extract product code from filename (e.g., "jb02hr" from "JB02HR Datasheet 2023.pdf")
        const dsProductCode = filename.match(/^([a-z]{2,3}[\d.]+[a-z]*)/i);
        const productCode = dsProductCode ? dsProductCode[1].toLowerCase() : '';

        for (const cited of citedSources) {
            // Check if filename matches or contains cited source
            if (filename.includes(cited) || cited.includes(filename)) {
                console.log('[filter] Match via filename:', ds.filename);
                return true;
            }
            // Check if product code matches
            if (productCode && (cited.includes(productCode) || cited === productCode)) {
                console.log('[filter] Match via product code:', productCode, 'in', cited);
                return true;
            }
        }
        return false;
    });

    // Deduplicate by product code (keep first occurrence)
    const seen = new Set();
    const deduplicated = filtered.filter(ds => {
        const filename = ds.filename.toLowerCase().replace(/\.pdf$/i, '');
        const match = filename.match(/^([a-z]{2,3}[\d.]+[a-z]*)/i);
        const productCode = match ? match[1].toLowerCase() : filename;

        if (seen.has(productCode)) {
            console.log('[filter] Removing duplicate:', ds.filename);
            return false;
        }
        seen.add(productCode);
        return true;
    });

    console.log('[filter] Final datasheets:', deduplicated.map(d => d.filename));
    return deduplicated;
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

    const now = Date.now();
    if (kbStatsCache && (now - kbStatsLastUpdated) < KB_STATS_CACHE_TTL) {
        return kbStatsCache;
    }

    try {
        console.log('[server] Updating Knowledge Base stats...');
        // Optimized: Only fetch unique sources directly if possible, or use a more targeted query
        // For now, selecting only the source column from metadata
        const { data: sources, error } = await supabase
            .from('pdf_chunks')
            .select('metadata->source')
            .not('metadata->source', 'is', null);

        if (error) throw error;

        const uniqueSources = new Set(sources?.map(s => s.source).filter(Boolean) || []);
        const sampleProducts = Array.from(uniqueSources).slice(0, 10).map(s => s.replace(/\.pdf$/i, ''));

        kbStatsCache = {
            totalDatasheets: uniqueSources.size,
            sampleProducts
        };
        kbStatsLastUpdated = now;

        console.log(`[server] KB Stats updated: ${kbStatsCache.totalDatasheets} datasheets found.`);
        return kbStatsCache;
    } catch (err) {
        console.error('Failed to get KB stats:', err);
        return kbStatsCache || { totalDatasheets: 0, sampleProducts: [] };
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
        console.log('[server] Processing query:', query);

        // Expand search for complex queries using decomposition
        let searchResults = [];
        if (query.length > 200) {
            const searchTargets = await decomposeEnquiry(query);
            const searchPromises = searchTargets.map(target => searchPdfChunks(target, 5));
            const resultsArrays = await Promise.all(searchPromises);

            // Merge results and deduplicate
            const seenIds = new Set();
            for (const arr of resultsArrays) {
                for (const res of arr) {
                    if (!seenIds.has(res.id)) {
                        searchResults.push(res);
                        seenIds.add(res.id);
                    }
                }
            }
            // Limit to top 15 for context window management
            searchResults = searchResults.sort((a, b) => b.similarity - a.similarity).slice(0, 15);
        } else {
            const expandedQuery = await expandQuery(query, history);
            searchResults = await searchPdfChunks(expandedQuery, 10);
        }

        console.log('[server] Search matched', searchResults.length, 'chunks.');

        const pdfContext = searchResults
            .map(r => `[Source: ${r.metadata?.source}] ${r.content}`)
            .join('\n\n');

        const referencedDatasheets = extractDatasheetReferences(searchResults);
        const conversationContext = buildConversationContext(history);

        // Get knowledge base stats for broad questions
        const kbStats = await getKnowledgeBaseStats();
        const kbStatsContext = searchResults.length < 3 
            ? `\n\nKNOWLEDGE BASE OVERVIEW:\n- Total datasheets available: ${kbStats.totalDatasheets}\n- Recommended search topics: Fire Safety, Lifejackets, Breathing Apparatus, SOS Cabinets\n- Sample models for inspiration: ${kbStats.sampleProducts.slice(0, 5).join(', ')}\n`
            : `\n\nKNOWLEDGE BASE OVERVIEW:\n- Total datasheets available: ${kbStats.totalDatasheets}\n`;

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
        console.error('[server] Chat endpoint error:', error);
        console.error(error.stack);
        res.status(500).json({
            error: error.message || 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Streaming chat endpoint
app.post('/api/chat/stream', async (req, res) => {
    try {
        const { query, history, files } = req.body;

        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }

        console.log('[server] Starting stream for query:', query);

        // Set up SSE with strict headers for streaming
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        // Send 2KB of padding to bypass proxy buffers (Nginx, Cloud Run, etc.)
        res.write(`: ${' '.repeat(2048)}\n\n`);

        const ai = getAI();
        const supabase = getSupabase();

        // Initial status update - Removed "Initializing" as per user feedback

        if (!ai) {
            console.error('[server] AI Instance is NULL. Check environment variables.');
            res.write(`data: ${JSON.stringify({ type: 'error', error: 'AI service not configured on server. Please check Cloud Run secrets.' })}\n\n`);
            return res.end();
        }

        // Search for relevant context - optimize for file uploads
        let searchResults = [];
        const hasFiles = files && files.length > 0;

        if (hasFiles) {
            console.log('[server] Step 1/3: Processing uploaded documents...');
            // For file uploads, extract key terms from the file content for searching
            // For file uploads, extract key terms from the file content for searching
            // Limit file content to avoid extremely long decomposition
            const fileContent = files.map(f => f.content).join('\n').substring(0, 2000);
            const searchTargets = await decomposeEnquiry(fileContent);

            // Limit to 3 searches max for performance
            const limitedTargets = searchTargets.slice(0, 3);
            const searchPromises = limitedTargets.map(target => searchPdfChunks(target, 5));
            const resultsArrays = await Promise.all(searchPromises);

            const seenIds = new Set();
            for (const arr of resultsArrays) {
                for (const res of arr) {
                    if (!seenIds.has(res.id)) {
                        searchResults.push(res);
                        seenIds.add(res.id);
                    }
                }
            }
            searchResults = searchResults.sort((a, b) => b.similarity - a.similarity).slice(0, 12);
        } else if (query.length > 200) {
            console.log('[server] Step 1/3: Decomposing complex enquiry...');
            const searchTargets = await decomposeEnquiry(query);
            console.log('[server] Step 2/3: Searching knowledge base...');
            const searchPromises = searchTargets.map(target => searchPdfChunks(target, 6));
            const resultsArrays = await Promise.all(searchPromises);

            const seenIds = new Set();
            for (const arr of resultsArrays) {
                for (const res of arr) {
                    if (!seenIds.has(res.id)) {
                        searchResults.push(res);
                        seenIds.add(res.id);
                    }
                }
            }
            searchResults = searchResults.sort((a, b) => b.similarity - a.similarity).slice(0, 15);
        } else {
            console.log('[server] Step 1/2: Expanding and searching knowledge base...');
            const expandedQuery = await expandQuery(query, history);
            searchResults = await searchPdfChunks(expandedQuery, 15);
        }

        const pdfContext = searchResults
            .map(r => `[Source: ${r.metadata?.source}] ${r.content}`)
            .join('\n\n');

        const uploadedContext = (files || []).map(f => `[UPLOADED DOCUMENT: ${f.name}]\n${f.content}`).join('\n\n');

        const referencedDatasheets = extractDatasheetReferences(searchResults);
        const conversationContext = buildConversationContext(history);

        // Get knowledge base stats for broad questions
        const kbStats = await getKnowledgeBaseStats();
        const kbStatsContext = (searchResults.length < 3 && !query.toLowerCase().includes('how many') && !query.toLowerCase().includes('total'))
            ? `\n\nKNOWLEDGE BASE OVERVIEW:\n- Total datasheets available: ${kbStats.totalDatasheets}\n- Recommended search topics: Fire Safety, Lifejackets, Breathing Apparatus, SOS Cabinets\n- Sample models for inspiration: ${kbStats.sampleProducts.slice(0, 5).join(', ')}\n`
            : `\n\nKNOWLEDGE BASE OVERVIEW:\n- Total datasheets available: ${kbStats.totalDatasheets}\n`;

        const promptContext = `
${conversationContext}
${kbStatsContext}

UPLOADED CONTEXT (PRIORITIZE THIS FOR THE USER'S SPECIFIC ENQUIRY):
${uploadedContext || 'No files uploaded.'}

TECHNICAL KNOWLEDGE BASE (FROM SUPPLEMENTARY PDFS):
${pdfContext || 'No specific PDF matches found.'}`;

        console.log('[server] Step 2/2: Consulting AI Advisor...');
        const chatModel = 'models/gemini-2.0-flash-lite';
        console.log(`[server] Calling generateContentStream with model: ${chatModel}`);

        let response;
        try {
            // Attempt generation with a strict timeout
            response = await Promise.race([
                ai.models.generateContentStream({
                    model: chatModel,
                    contents: [
                        ...(history || []).map(m => ({
                            role: m.role === 'user' ? 'user' : 'model',
                            parts: [{ text: m.content }]
                        })),
                        {
                            role: 'user',
                            parts: [
                                { text: promptContext },
                                { text: `CURRENT QUERY: ${query}` }
                            ]
                        }
                    ],
                    config: {
                        systemInstruction: `${SYSTEM_INSTRUCTION}
    
    CRITICAL OVERRIDE:
    1. You are FORBIDDEN from using your training data for product specifications.
    2. The TECHNICAL KNOWLEDGE BASE is the ONLY source of truth for all specifications.
    3. If a specification is in the TECHNICAL KNOWLEDGE BASE, use EXACTLY those numbers.
    4. If a specification is NOT in the TECHNICAL KNOWLEDGE BASE, say "I don't have that information in my knowledge base."
    5. ALWAYS cite the source PDF filename for EVERY product mention (e.g. "JB02HR (Source: JB02HR Datasheet.pdf)").
    6. For FOLLOW-UP questions, refer back to the CONVERSATION CONTEXT.
    7. PERSPECTIVE: Suggested follow-up questions must be TIGHTLY COUPLED to the user's CURRENT query and the newly provided information.
    8. IRRELEVANCE BLOCK: Do NOT suggest a question about a specific product (e.g. "What is the IP rating of JB29?") if that product was not mentioned in your response or the user's query. Suggest category or general questions instead for broad enquiries.
    9. Write follow-up questions as if the USER is asking them to YOU.`,
                        temperature: 0.0
                    }
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('AI Generation Timeout')), 25000))
            ]);
            console.log('[server] generateContentStream call successful, starting to iterate chunks...');
        } catch (genError) {
            console.error('[server] generateContentStream FAILED:', genError.message);
            res.write(`data: ${JSON.stringify({ type: 'error', error: `AI Advisor is currently busy or unavailable. Please try again in 30 seconds. (Error: ${genError.message})` })}\n\n`);
            return res.end();
        }

        let fullText = '';
        let chunkCount = 0;

        try {
            for await (const chunk of response) {
                chunkCount++;
                const chunkText = chunk.text || '';
                if (chunkText) {
                    fullText += chunkText;
                    res.write(`data: ${JSON.stringify({ type: 'chunk', text: fullText })}\n\n`);
                }

                // Keep-alive/Flush indicator for long responses
                if (chunkCount % 5 === 0) {
                    console.log(`[server] Sent ${chunkCount} chunks so far...`);
                }
            }
            console.log(`[server] Stream complete. Total chunks: ${chunkCount}, Total chars: ${fullText.length}`);
        } catch (streamIterError) {
            console.error('[server] Error during stream iteration:', streamIterError);
            res.write(`data: ${JSON.stringify({ type: 'chunk', text: fullText + '\n\n[ERROR DURING STREAMING]' })}\n\n`);
        }

        // Extract citations from the response and filter datasheets
        console.log('[server] Extracting citations for final event...');
        const citedDatasheets = filterDatasheetsByCitations(fullText, referencedDatasheets);

        res.write(`data: ${JSON.stringify({ type: 'done', text: fullText, datasheets: citedDatasheets })}\n\n`);
        res.end();

    } catch (error) {
        console.error('[server] Top-level Stream endpoint error:', error);
        console.error(error.stack);
        try {
            res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
            res.end();
        } catch (writeErr) {
            console.error('[server] Failed to write error to stream:', writeErr);
        }
    }
});

// Knowledge base stats endpoint
app.get('/api/stats', async (req, res) => {
    try {
        const categoryKeyword = req.query.category;
        const kbStats = await getKnowledgeBaseStats();

        if (categoryKeyword) {
            // ... rest remains similar but uses cached stats or limited search ...
            return res.json({
                totalDatasheets: kbStats.totalDatasheets,
                categoryMatches: [{
                    keyword: categoryKeyword,
                    count: 0, // Simplified for performance
                    datasheets: kbStats.sampleProducts.filter(p => p.toLowerCase().includes(String(categoryKeyword).toLowerCase()))
                }]
            });
        }

        res.json({ totalDatasheets: kbStats.totalDatasheets });
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

// Diagnostic endpoint to check configuration without exposing secrets
app.get('/api/diag', (req, res) => {
    const vars = Object.keys(process.env)
        .filter(k => k.includes('GEMINI') || k.includes('SUPABASE') || k.includes('FIREBASE') || k.includes('PASSWORD'))
        .reduce((acc, key) => {
            acc[key] = process.env[key] ? `set (length: ${process.env[key].length})` : 'MISSING';
            return acc;
        }, {});

    res.json({
        node_env: process.env.NODE_ENV,
        port: process.env.PORT,
        vars,
        ai_initialized: !!aiInstance,
        supabase_initialized: !!supabaseInstance,
        server_time: new Date().toISOString()
    });
});

// Simple test endpoint to verify AI without streaming
app.get('/api/test-ai', async (req, res) => {
    try {
        const ai = getAI();
        if (!ai) return res.status(500).json({ error: 'AI not configured' });

        const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const result = await model.generateContent('Say "AI is working"');
        res.json({ result: result.response.text() });
    } catch (err) {
        res.status(500).json({ error: err.message });
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
