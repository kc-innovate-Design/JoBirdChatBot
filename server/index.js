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
const PDF_STORAGE_BASE = 'https://atmvjoymebksyajxfhwo.supabase.co/storage/v1/object/public/datasheets';

let aiInstance = null;
let supabaseInstance = null;

// Caching for Knowledge Base stats to prevent hanging
let kbStatsCache = null;
let kbStatsLastUpdated = 0;
const KB_STATS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const DB_TIMEOUT = 4000; // 4 seconds safety bound for DB calls

// Helper to strip citations from text
function stripCitations(text) {
    if (!text) return text;
    // Strip (Source: ... .pdf) and similar patterns
    return text.replace(/\(Source:\s*[^)]+\.pdf\)/gi, '')
        .replace(/Source:\s*[^)]+\.pdf/gi, '')
        .replace(/\[Source:\s*[^\]]+\.pdf\]/gi, '')
        .trim();
}

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
const SYSTEM_INSTRUCTION = `
1. ROLE & PURPOSE
You are the JoBird Cabinet Advisor, a senior technical sales engineer. Your goal is to guide the user to the single best GRP cabinet from the JoBird catalog. You provide rapid, expert recommendations and avoid repeating information across different sections of your response.

2. MANDATORY OPERATIONAL RULES
The "No-Repeat" Rule: If a piece of information is stated in the bold header (e.g., the model name and primary capacity), do NOT repeat it in a list or as a row in the table.

Technical Data Only: Use the table strictly for secondary technical specifications such as Dimensions, Weight, and IP Rating. Do not include "Capacity" or "Intended Use" in the table if they are already in the header.

Clean Table Format: Tables must contain only three columns: Spec | User Requirement | JoBird Model Specs. Never include "Status," "Match," or "PASS/FAIL" columns.

Expert Filtering: Never suggest more than 3 models in a single response.

No Code Leaks: Jump directly to the final response template. Never show internal reasoning, tool_code, or processing steps.

Product Name Integrity: JoBird product names are ONLY codes like **JB14**, **RS300LJ**, **SOS506**. Third-party names found in datasheet content must NEVER be mixed with product codes.

Datasheet Links: You MUST format every link as [Datasheet PDF](url) using ONLY the OFFICIAL_DATASHEET_URL from the catalog context. NEVER use jobird.co.uk links.

CRITICAL TABLE FORMAT: Tables MUST use proper Markdown with a separator row on line 2:
| Spec | User Requirement | JoBird Model Specs |
| :--- | :--- | :--- |
| Dimensions | Not specified | 1296 x 698 x 392 mm |

3. RESPONSE MODES
MODE A: DISCOVERY (Missing Specs)
Use this mode when dimensions or quantities are unknown.
Main Body: State: "To give you an accurate recommendation, I need to know:" followed by 2-3 specific questions.
Buttons: Provide user-led action buttons (e.g., "How to measure equipment").

MODE B: RECOMMENDATION (Specs/Capacity Provided)
Bold Header: State the recommendation and the primary fit (e.g., "The JB14LJ is the best fit for 8 automatic life jackets.").
Technical Data Table: Provide a table for physical dimensions and protection ratings only.
Verdict: A single direct link to the Datasheet PDF.

4. SUGGESTED FOLLOW-UPS (UI BUTTONS)
MANDATORY: Every response MUST end with exactly 4 follow-up questions written from the USER'S perspective.
Format: [[FOLLOWUP]] Action 1 | Action 2 | Action 3 | Action 4
Separator: Use the pipe | symbol to ensure the UI creates separate buttons.
NEVER use [[Question text]] format. ALWAYS use the single [[FOLLOWUP]] tag followed by pipe-separated actions.`;
// Embed query using Gemini
async function embedQuery(text) {
    const ai = getAI();
    if (!ai) throw new Error('Gemini not configured');

    console.log(`[server] Getting embedding for text (length: ${text.length})...`);

    const result = await Promise.race([
        ai.models.embedContent({
            model: 'gemini-embedding-001',
            contents: [{ parts: [{ text }] }],
            config: { outputDimensionality: 768 }
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Embedding Timeout')), 15000))
    ]);

    // SDK v1.40+ returns embeddings (plural) array
    const values = result.embeddings?.[0]?.values || result.embedding?.values;
    if (!values) throw new Error('No embedding values returned');
    return values;
}

// Search Supabase products table (Hybrid: keyword + fuzzy + vector)
async function searchProducts(question, matchCount = 10) {
    const supabase = getSupabase();
    if (!supabase) {
        console.error('[search] CRITICAL: Supabase not initialized! SUPABASE_URL:', SUPABASE_URL ? 'set' : 'MISSING', 'SUPABASE_SERVICE_ROLE_KEY:', SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'MISSING');
        return [];
    }

    try {
        console.log(`[search] Hybrid Product Search for: "${question}", matchCount=${matchCount}`);
        let results = [];
        const existingIds = new Set();

        const startTime = Date.now();
        const searchPromises = [];

        // 1. Keyword search (Product codes like JB64, RS140, SOS603T)
        // Extract ALL product codes from the query (not just the first) for comparison queries
        const allPartMatches = [...question.matchAll(/[A-Z]{2,3}[\d.]+[A-Z]*/gi)];
        for (const partMatch of allPartMatches) {
            const partNumber = partMatch[0];
            searchPromises.push(
                Promise.race([
                    supabase.from('products')
                        .select('id, product_code, name, category, specifications, description, applications, pdf_storage_url')
                        .or(`product_code.ilike.%${partNumber}%,name.ilike.%${partNumber}%`)
                        .limit(matchCount)
                        .then(({ data, error }) => {
                            if (error) console.error('[search] Keyword search DB error:', error.message);
                            console.log(`[search] Keyword search results: ${(data || []).length}`);
                            return (data || []).map(r => ({ ...r, similarity: 2.0, type: 'keyword' }));
                        }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Keyword Search Timeout')), DB_TIMEOUT))
                ]).catch(err => { console.warn(`[search] Keyword search failed: ${err.message}`); return []; })
            );
        }

        // 2. Fuzzy / metadata search on name, category, description, specs
        const normalizedQuery = question.toLowerCase();
        const synonymMap = {
            'life jacket': 'lifejacket', 'life jackets': 'lifejacket',
            'breathing apparatus': 'ba', 'scba': 'ba', 'self contained': 'ba', 'self-contained': 'ba',
            'fire extinguisher': 'extinguisher', 'first aid': 'first aid', 'emergency': 'sos',
            'hosepipe': 'hose', 'hosepipes': 'hose', 'fire hose': 'hose', 'wash down': 'wash'
        };

        let fuzzyTerms = [];
        Object.entries(synonymMap).forEach(([phrase, synonym]) => {
            if (normalizedQuery.includes(phrase)) fuzzyTerms.push(synonym);
        });
        const individualWords = normalizedQuery.split(/[\s.\-_]+/).filter(w => w.length > 2 && !w.match(/^(tell|about|show|what|have|find|with|does|include|list|will|hold|the|for|and|are|can|how|you|your|any|all|get|our|its|than|from|this|that|they|them|each|also|some|most|come|give|need|want|best|more|very|much|many|just|like|look|into|been|when|only|make|made|know|good|well|work|same|take|keep|help|sure|used|such|other|could|would|should|which|these|those|their|there|where|still|able|info|available|options|option)$/i));
        fuzzyTerms = [...new Set([...fuzzyTerms, ...individualWords])];

        if (fuzzyTerms.length > 0) {
            const orQuery = fuzzyTerms.map(term => `name.ilike.%${term}%,category.ilike.%${term}%,description.ilike.%${term}%,applications.ilike.%${term}%`).join(',');
            searchPromises.push(
                Promise.race([
                    supabase.from('products')
                        .select('id, product_code, name, category, specifications, description, applications, pdf_storage_url')
                        .or(orQuery)
                        .limit(matchCount)
                        .then(({ data, error }) => {
                            if (error) console.error('[search] Fuzzy search DB error:', error.message);
                            console.log(`[search] Fuzzy search results: ${(data || []).length}, terms: ${fuzzyTerms.join(', ')}`);
                            return (data || []).map(r => ({ ...r, similarity: 1.5, type: 'fuzzy' }));
                        }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Fuzzy Search Timeout')), DB_TIMEOUT))
                ]).catch(err => { console.warn(`[search] Fuzzy search failed: ${err.message}`); return []; })
            );
        }

        // 3. Vector search (Semantic) via match_products RPC
        searchPromises.push(
            (async () => {
                try {
                    const embedding = await Promise.race([
                        embedQuery(question),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Embedding Timeout')), 15000))
                    ]);
                    const { data, error: rpcError } = await supabase.rpc('match_products', { query_embedding: embedding, match_count: matchCount });
                    if (rpcError) console.error('[search] Vector RPC error:', rpcError.message);
                    console.log(`[search] Vector search results: ${(data || []).length}`);
                    return (data || []).map(r => ({ ...r, type: 'vector' }));
                } catch (vErr) {
                    console.warn(`[search] Vector Search failed: ${vErr.message}`);
                    return [];
                }
            })()
        );

        const allResults = await Promise.all(searchPromises);
        console.log(`[search] Parallel product search completed in ${Date.now() - startTime}ms, total batches: ${allResults.length}, total items: ${allResults.reduce((s, b) => s + b.length, 0)}`);

        // Merge and deduplicate by product ID
        for (const batch of allResults) {
            for (const product of batch) {
                if (!existingIds.has(product.id)) {
                    results.push(product);
                    existingIds.add(product.id);
                } else {
                    // Keep highest similarity score
                    const existing = results.find(r => r.id === product.id);
                    if (existing && product.similarity > existing.similarity) {
                        existing.similarity = product.similarity;
                        existing.type = product.type;
                    }
                }
            }
        }

        // Sort by relevance and cap results
        results.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
        return results.slice(0, matchCount);
    } catch (err) {
        console.error('Product search failed:', err);
        return [];
    }
}

// Expand short queries into descriptive search terms
async function expandQuery(query, history) {
    const isMetaQuery = query.toLowerCase().includes('category') || query.toLowerCase().includes('list of') || query.toLowerCase().includes('what classes') || query.toLowerCase().includes('what sections');

    if (query.match(/[A-Z]{2,3}[\d.]+[A-Z]*/i) || query.includes('_') || query.includes('-') || isMetaQuery) {
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
        console.log(`[server] Expanding query: "${query}" using gemini-2.0-flash...`);
        const conversationSummary = (history || []).slice(-3)
            .map(m => `${m.role.toUpperCase()}: ${m.content}`)
            .join('\n');

        // Added timeout to prevent hang
        const result = await Promise.race([
            ai.models.generateContent({
                model: 'models/gemini-2.0-flash',
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
            new Promise((_, reject) => setTimeout(() => reject(new Error('Expand Query Timeout')), 5000))
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
                model: 'models/gemini-3-flash-preview',
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

// Extract datasheet references from product search results
// PDFs are stored in the original Supabase project's public storage bucket
// Storage base URL for datasheets (now dynamic)

function extractDatasheetReferences(searchResults) {
    const uniqueProducts = new Map();

    console.log(`[datasheets] Extracting from ${searchResults?.length || 0} search results`);
    if (!searchResults || searchResults.length === 0) {
        console.warn('[datasheets] WARNING: No search results to extract from!');
        return [];
    }

    for (const product of searchResults) {
        const code = product.product_code;
        if (!code) {
            console.log(`[datasheets] Skipping product without code: ${product.name || 'Unknown'}`);
            continue;
        }

        const normalizedKey = code.toLowerCase().trim();
        if (!uniqueProducts.has(normalizedKey)) {
            const pdfFilename = product.pdf_storage_url || `${code}.pdf`;
            const entry = {
                filename: code,
                displayName: `${code} — ${product.name || product.category || ''}`.trim(),
                productCode: code,
                url: `${PDF_STORAGE_BASE}/${encodeURIComponent(pdfFilename)}`
            };
            console.log(`[datasheets] Extracted: ${code} URL: ${entry.url.substring(0, 80)}...`);
            uniqueProducts.set(normalizedKey, entry);
        }
    }

    console.log(`[datasheets] Total unique extracted: ${uniqueProducts.size}`);
    return Array.from(uniqueProducts.values());
}

// Filter datasheets to only include those actually cited in the AI response
function filterDatasheetsByCitations(responseText, allDatasheets, searchResults) {
    console.log(`[filter] Starting filter with ${allDatasheets?.length || 0} datasheets and response length ${responseText?.length || 0}`);
    if (!responseText || !allDatasheets || allDatasheets.length === 0) {
        return [];
    }

    const citedProductCodes = new Set();

    // Pattern 1: Bold code only, e.g. **JB02HR**
    const shortBoldPattern = /\*\*([A-Z]{2,3}[\d.]+[A-Za-z\d]*)\*\*/gi;
    let match;
    while ((match = shortBoldPattern.exec(responseText)) !== null) {
        citedProductCodes.add(match[1].toLowerCase());
    }

    // Pattern 2: Bold full product name, e.g. **JB93 Emergency Equipment Chest:**
    // Extracts just the product code from the start of the bold phrase
    const longBoldPattern = /\*\*([A-Z]{2,3}[\d.]+[A-Za-z\d]*)\s+[^*]+\*\*/gi;
    while ((match = longBoldPattern.exec(responseText)) !== null) {
        citedProductCodes.add(match[1].toLowerCase());
    }

    // Pattern 3: Unbolded product codes like JB02HR, RS300LJ mentioned in text
    const unboldedPattern = /\b(JB\d{2,3}[A-Z]{0,4}|RS\d{2,4}[A-Z]{0,4}|SOS\d{2,4}[A-Z]{0,4}|HS\d{2,4}[A-Z]{0,4})\b/gi;
    while ((match = unboldedPattern.exec(responseText)) !== null) {
        citedProductCodes.add(match[1].toLowerCase());
    }

    console.log(`[filter] Cited product codes from AI response:`, [...citedProductCodes]);

    const filtered = allDatasheets.filter(ds => {
        const dsCode = (ds.productCode || ds.filename).toLowerCase();
        for (const cited of citedProductCodes) {
            // Exact match
            if (dsCode === cited) {
                console.log(`[filter] SIDEBAR MATCH (exact): ${dsCode} === ${cited}`);
                return true;
            }
            // Cited code is a prefix of the datasheet code (e.g. "jb02hr" matches "jb02hr-mk2")
            if (dsCode.startsWith(cited) && cited.length >= 4) {
                console.log(`[filter] SIDEBAR MATCH (prefix): ${dsCode} starts with ${cited}`);
                return true;
            }
            // Datasheet code is a prefix of cited code (e.g. datasheet "jb02" matches cited "jb02hr")
            if (cited.startsWith(dsCode) && dsCode.length >= 4) {
                console.log(`[filter] SIDEBAR MATCH (reverse): ${cited} starts with ${dsCode}`);
                return true;
            }
        }
        return false;
    });

    console.log(`[filter] Final sidebar count: ${filtered.length}`);
    return filtered;
}

// Build conversation context
function buildConversationContext(history) {
    if (!history || history.length <= 1) return '';

    const recentHistory = history.slice(-10);
    let context = 'CONVERSATION CONTEXT (for follow-up questions):\n';

    for (const msg of recentHistory) {
        const role = msg.role === 'user' ? 'Customer' : 'Assistant';
        const strippedContent = stripCitations(msg.content);
        const content = strippedContent.length > 500 ? strippedContent.substring(0, 500) + '...' : strippedContent;
        context += `${role}: ${content}\n`;
    }

    return context + '\n---\n';
}

// Extract product codes mentioned in conversation history
function extractProductCodesFromHistory(history) {
    if (!history || history.length === 0) return [];
    const codes = new Set();
    const codeRegex = /\b([A-Z]{2,3}[\d.]+[A-Z\d]*)\b/gi;
    for (const msg of history) {
        const matches = msg.content?.matchAll(codeRegex);
        if (matches) {
            for (const m of matches) {
                codes.add(m[1].toUpperCase());
            }
        }
    }
    return Array.from(codes);
}

// Get knowledge base stats from products table
async function getKnowledgeBaseStats() {
    const supabase = getSupabase();
    if (!supabase) return { totalProducts: 0, sampleProducts: [], categories: [] };

    const now = Date.now();
    if (kbStatsCache && (now - kbStatsLastUpdated) < KB_STATS_CACHE_TTL) {
        return kbStatsCache;
    }

    try {
        console.log('[server] Updating Knowledge Base stats from products table...');
        const [countResult, categoriesResult, sampleResult] = await Promise.all([
            Promise.race([
                supabase.from('products').select('id', { count: 'exact', head: true }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Count Timeout')), 5000))
            ]),
            Promise.race([
                supabase.from('products').select('category').order('category'),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Categories Timeout')), 5000))
            ]),
            Promise.race([
                supabase.from('products').select('product_code, name').limit(20),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Sample Timeout')), 5000))
            ])
        ]);

        const uniqueCategories = [...new Set((categoriesResult.data || []).map(r => r.category).filter(Boolean))];
        const sampleProducts = (sampleResult.data || []).map(r => `${r.product_code} ${r.name}`);

        kbStatsCache = {
            totalProducts: countResult.count || 144,
            sampleProducts: sampleProducts.slice(0, 15),
            categories: uniqueCategories.length > 0 ? uniqueCategories : [
                "Fire Extinguisher Cabinet",
                "Fire Hose Cabinet",
                "Fire Hose Reel Cabinet",
                "Lifejacket Storage Cabinet",
                "Breathing Apparatus Cabinet",
                "Safety Equipment Storage",
                "General Purpose Cabinet"
            ]
        };
        kbStatsLastUpdated = now;
        return kbStatsCache;
    } catch (err) {
        console.warn('[server] KB Stats error:', err.message);
        return kbStatsCache || { totalProducts: 144, sampleProducts: [], categories: [] };
    }
}

// API Routes

// Password verification
// Password verification
app.get('/api/ping', (req, res) => res.send('pong-get'));
app.post('/api/ping', (req, res) => res.send('pong-post'));

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
        VITE_GEMINI_LIVE_API_KEY: '', // Feature removed
        VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || SUPABASE_URL
    });
});

// Chat endpoint
app.post('/api/chat/stream', async (req, res) => {
    console.log('[server] Incoming POST /api/chat/stream');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // === GLOBAL SAFETY NET ===
    // Hard kill after 60 seconds — nothing can bypass this
    const GLOBAL_TIMEOUT = 60000;
    let requestDone = false;
    const globalTimer = setTimeout(() => {
        if (!requestDone) {
            console.error('[server] GLOBAL TIMEOUT: Request exceeded 60s, force-ending.');
            try {
                res.write(`data: ${JSON.stringify({ type: 'error', error: 'Request timed out. Please try again.' })}\n\n`);
                res.end();
            } catch (e) { /* already closed */ }
        }
    }, GLOBAL_TIMEOUT);

    // Keepalive heartbeat every 8s so client/browser doesn't assume we died
    const heartbeat = setInterval(() => {
        if (!requestDone) {
            try { res.write(': keepalive\n\n'); } catch (e) { /* ignore */ }
        }
    }, 8000);

    const cleanup = () => { requestDone = true; clearTimeout(globalTimer); clearInterval(heartbeat); };
    res.on('close', cleanup);

    // Immediate heartbeat/progress to prevent browser timeout
    res.write('data: ' + JSON.stringify({ type: 'status', message: 'Analyzing query...' }) + '\n\n');

    try {
        const { query, history, files } = req.body;
        const uploadedContext = (files || [])
            .map(f => `[File: ${f.name}]\n${f.content}`)
            .join('\n\n');

        if (!query) {
            // SSE headers already sent, so use SSE error event instead of res.status()
            res.write(`data: ${JSON.stringify({ type: 'error', error: 'Query is required' })}\n\n`);
            cleanup();
            return res.end();
        }

        console.log('[server] Processing query:', query);

        // Extract product codes from history for follow-up context retention
        const historyProductCodes = extractProductCodesFromHistory(history);
        if (historyProductCodes.length > 0) {
            console.log('[server] Products from history:', historyProductCodes.join(', '));
        }

        // === FOLLOW-UP DETECTION ===
        // If the query references previous context (pronouns, comparisons) AND we have history,
        // skip the entire search pipeline — the conversation context has everything we need.
        const lowerQuery = query.toLowerCase();
        const hasHistory = history && history.length >= 2;
        const isFollowUp = hasHistory && (
            // Only trigger fast-path for queries that clearly reference previous conversation
            // AND don't involve technical spec lookups that need search
            (
                /\b(these|those|they|them|their|its|both|same|above|mentioned|compared?|versus|vs|which one|between them)\b/i.test(lowerQuery)
                || /\b(do they|are they|can they|does it|is it|can it|how do|how does|what about|tell me more)\b/i.test(lowerQuery)
            )
            // Very short questions with history are likely follow-ups (e.g. "what colour?", "dimensions?")
            || (query.length < 30 && !lowerQuery.match(/[A-Z]{2,3}[\d.]+/i) && !lowerQuery.match(/\b(cabinet|hose|fire|life|jacket|extinguisher|storage|breathing)\b/i))
        );

        // Even if it's a follow-up, if the user is asking about specs/ratings/dimensions,
        // or requesting more details about a product, we should re-fetch product data
        const needsSpecData = /\b(ip\s*rat|dimen|material|weight|height|width|depth|certif|approval|rating|specs|specification|construction|colou?r|locking|insulation|tell me more|more about|more info|details|describe|full|everything about|what is|what are|features|capacity|options?|extras|accessories)/i.test(lowerQuery);

        // If the query explicitly mentions a product code, ALWAYS search the database
        const queryContainsProductCode = /[A-Z]{2,3}[\d.]+[A-Z\d]*/i.test(query);

        let searchResults = [];
        let isFollowUpPath = false;

        console.log(`[server] Follow-up check: isFollowUp=${isFollowUp}, needsSpecData=${needsSpecData}, queryContainsProductCode=${queryContainsProductCode}, historyProducts=${historyProductCodes.length}, hasHistory=${hasHistory}`);

        if (isFollowUp && !uploadedContext && !needsSpecData && !queryContainsProductCode) {
            // === FAST PATH: Skip search entirely ===
            // Only for truly conversational follow-ups with no product codes or data requests
            console.log('[server] PATH: FAST (follow-up, no spec data needed, no product codes)');
            res.write('data: ' + JSON.stringify({ type: 'status', message: 'Generating response...' }) + '\n\n');
            isFollowUpPath = true;
        } else if (isFollowUp && (needsSpecData || queryContainsProductCode) && historyProductCodes.length > 0) {
            // === SPEC FOLLOW-UP PATH: Fetch specific products by code from history + current query ===
            // Also extract codes from the current query itself (user may type the code directly)
            const queryCodeRegex = /\b([A-Z]{2,3}[\d.]+[A-Z\d]*)\b/gi;
            const queryCodeMatches = [...query.matchAll(queryCodeRegex)].map(m => m[1].toUpperCase());
            const allCodes = [...new Set([...queryCodeMatches, ...historyProductCodes])];

            console.log('[server] PATH: SPEC FOLLOW-UP — fetching products for codes:', allCodes.join(', '));
            res.write('data: ' + JSON.stringify({ type: 'status', message: 'Looking up specifications...' }) + '\n\n');

            const supabase = getSupabase();
            if (supabase) {
                try {
                    const codeResults = await Promise.race([
                        Promise.all(allCodes.slice(0, 10).map(code => {
                            // Use wildcard matching to handle dots, dashes, and partial codes
                            // e.g., "RS300.600LJ" should match "RS300-600LJ" or "RS300600LJ"
                            const baseCode = code.replace(/[.\-]/g, '%');
                            return supabase.from('products')
                                .select('id, product_code, name, category, specifications, description, applications, pdf_storage_url')
                                .or(`product_code.ilike.%${baseCode}%,name.ilike.%${baseCode}%`)
                                .limit(3)
                                .then(({ data }) => data || [])
                                .catch(() => []);
                        })),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Spec lookup timeout')), DB_TIMEOUT))
                    ]);

                    const seenIds = new Set();
                    for (const products of codeResults) {
                        for (const product of products) {
                            if (!seenIds.has(product.id)) {
                                searchResults.push({ ...product, similarity: 2.0 });
                                seenIds.add(product.id);
                            }
                        }
                    }
                    console.log('[server] Spec follow-up fetched', searchResults.length, 'products.');
                } catch (err) {
                    console.warn('[server] Spec follow-up lookup failed:', err.message);
                }
            }

            // FALLBACK: If SPEC FOLLOW-UP found nothing, fall through to the standard search pipeline
            if (searchResults.length === 0) {
                console.log('[server] SPEC FOLLOW-UP found 0 results — falling back to STANDARD search.');
                res.write('data: ' + JSON.stringify({ type: 'status', message: 'Searching Knowledge Base...' }) + '\n\n');
                const expandedQuery = await expandQuery(query, history);
                searchResults = await searchProducts(expandedQuery, 15);
            }
        } else {
            // === STANDARD PATH: Full search pipeline ===
            res.write('data: ' + JSON.stringify({ type: 'status', message: 'Searching Knowledge Base...' }) + '\n\n');

            // If files are uploaded, use their content to generate search queries
            const hasUploadedFiles = uploadedContext && uploadedContext.length > 50;
            if (hasUploadedFiles) {
                console.log('[server] File upload detected, extracting requirements for search...');
                res.write('data: ' + JSON.stringify({ type: 'status', message: 'Extracting requirements from document...' }) + '\n\n');

                // Use the file content to generate targeted search queries
                const ai = getAI();
                let searchTerms = [query];
                if (ai) {
                    try {
                        const extractResult = await Promise.race([
                            ai.models.generateContent({
                                model: 'models/gemini-2.0-flash',
                                contents: [{
                                    role: 'user',
                                    parts: [{
                                        text: `You are analyzing a customer requirements document for a marine/offshore GRP cabinet company called JoBird.

Identify each DISTINCT PRODUCT the customer needs. Output ONE search phrase per product that describes WHAT the cabinet must store and its PRIMARY use case.

RULES:
- Focus on the PRODUCT TYPE, not individual features
- Include storage contents and quantities when mentioned
- DO NOT extract generic features like "IP56" or "stainless steel" as separate items
- Maximum 4 search phrases

Examples:
- "fire hose cabinet 2 x 30M hoses with nozzles"
- "lifejacket cabinet 12 automatic life jackets"
- "breathing apparatus BA storage cabinet"
- "electrical PPE storage cabinet boots gloves"
- "wash down hose cabinet potable water"

DOCUMENT:
${uploadedContext.substring(0, 3000)}

RESPONSE: (One search phrase per line, no numbering)`
                                    }]
                                }],
                                config: { temperature: 0.1, maxOutputTokens: 150 }
                            }),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Requirement extraction timeout')), 8000))
                        ]);
                        const phrases = extractResult.text?.split('\n').map(p => p.trim().replace(/^[\d.\-*]+\s*/, '')).filter(p => p.length > 5) || [];
                        if (phrases.length > 0) {
                            searchTerms = phrases;
                            console.log('[server] Extracted search terms from upload:', searchTerms);
                        }
                    } catch (err) {
                        console.warn('[server] Requirement extraction failed, falling back to query:', err.message);
                    }
                }

                res.write('data: ' + JSON.stringify({ type: 'status', message: `Searching for ${searchTerms.length} requirement(s)...` }) + '\n\n');

                // Search for each extracted requirement
                const searchPromises = searchTerms.map(term => searchProducts(term, 5));
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

                // Fallback: if any search term found < 2 results, retry with broader terms
                for (let i = 0; i < searchTerms.length; i++) {
                    if ((resultsArrays[i] || []).length < 2) {
                        console.log(`[server] Low results for "${searchTerms[i]}", trying broader search...`);
                        const broaderTerms = [
                            'GRP storage cabinet weatherproof',
                            'utility cabinet outdoor marine',
                            'general purpose cabinet IP56'
                        ];
                        for (const broader of broaderTerms) {
                            try {
                                const fallbackResults = await searchProducts(broader, 3);
                                for (const res of fallbackResults) {
                                    if (!seenIds.has(res.id)) {
                                        searchResults.push(res);
                                        seenIds.add(res.id);
                                    }
                                }
                                if (fallbackResults.length >= 2) break;
                            } catch (err) {
                                console.warn('[server] Fallback search failed:', err.message);
                            }
                        }
                    }
                }

                searchResults = searchResults.sort((a, b) => (b.similarity || 0) - (a.similarity || 0)).slice(0, 20);
            } else if (query.length > 200) {
                const searchTargets = await decomposeEnquiry(query);
                const searchPromises = searchTargets.map(target => searchProducts(target, 5));
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
                // Detect meta/overview questions that don't need product search
                const isMetaQuery = /how many|total|count|list.*categor|what.*categor|what.*types|overview|what do you (have|know)|what.*available/i.test(lowerQuery)
                    && !lowerQuery.match(/[A-Z]{2,3}[\d.]+/i);

                if (isMetaQuery) {
                    console.log('[server] Meta/overview query detected — skipping product search.');
                } else {
                    const expandedQuery = await expandQuery(query, history);
                    searchResults = await searchProducts(expandedQuery, 15);
                }
            }

            // === SPEC-VALUE SUPPLEMENT (runs for ALL query paths) ===
            // This catches products that vector/keyword search misses for queries like 'IP56 rating'
            const specValueMatch = lowerQuery.match(/\b(ip\s*\d{2}|ip\s*\d{1}x|stainless\s*steel|grp|composite|galvani[sz]ed|aluminium|mild\s*steel)\b/i);
            if (specValueMatch) {
                const specValue = specValueMatch[0].replace(/\s+/g, '');
                console.log('[server] Running structured spec-filter for:', specValue);
                const supabase = getSupabase();
                if (supabase) {
                    try {
                        const seenIds = new Set(searchResults.map(r => r.id));
                        const { data: allProducts } = await Promise.race([
                            supabase.from('products')
                                .select('id, product_code, name, category, specifications, description, applications, pdf_storage_url')
                                .limit(200),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Spec Filter Timeout')), DB_TIMEOUT))
                        ]);

                        let specAdded = 0;
                        for (const product of (allProducts || [])) {
                            if (!seenIds.has(product.id)) {
                                const specStr = JSON.stringify(product.specifications || {}).toLowerCase();
                                const descStr = (product.description || '').toLowerCase();
                                const appsStr = (product.applications || '').toLowerCase();
                                if (specStr.includes(specValue.toLowerCase()) || descStr.includes(specValue.toLowerCase()) || appsStr.includes(specValue.toLowerCase())) {
                                    searchResults.push({ ...product, similarity: 1.9, type: 'spec-filter' });
                                    seenIds.add(product.id);
                                    specAdded++;
                                }
                            }
                        }
                        console.log('[server] Spec-filter added', specAdded, 'products for', specValue);
                        // Re-sort and limit after adding spec-filter results
                        searchResults = searchResults.sort((a, b) => (b.similarity || 0) - (a.similarity || 0)).slice(0, 25);
                    } catch (err) {
                        console.warn('[server] Spec-filter supplement failed:', err.message);
                    }
                }
            }

            // === CATEGORY SUPPLEMENT (runs for ALL query paths) ===
            // When a query mentions a product category, fetch ALL matching products
            // so the AI can present the full range of options on the first response
            const categoryPatterns = [
                { pattern: /life\s*jacket|lifejacket/i, terms: ['lifejacket', 'life jacket', 'automatic life'] },
                { pattern: /fire\s*hose|firehose|hose\s*pipe|hosepipe|\bhose/i, terms: ['fire hose', 'hose reel', 'hose'] },
                { pattern: /fire\s*extinguisher/i, terms: ['extinguisher'] },
                { pattern: /breathing\s*apparatus|\bba\b|scba/i, terms: ['breathing apparatus', 'BA'] },
                { pattern: /lifebuoy|life\s*buoy|life\s*ring/i, terms: ['lifebuoy', 'life buoy'] },
                { pattern: /immersion\s*suit/i, terms: ['immersion suit'] },
                { pattern: /wash\s*down/i, terms: ['wash down', 'washdown'] },
                { pattern: /first\s*aid/i, terms: ['first aid'] },
                { pattern: /electrical|ppe/i, terms: ['electrical', 'PPE'] },
                { pattern: /general\s*purpose|utility|multi.?purpose/i, terms: ['general purpose', 'utility'] },
                { pattern: /stretcher/i, terms: ['stretcher'] },
                { pattern: /\bsos\b|rescue\s*line|rescue\s*equipment/i, terms: ['SOS', 'rescue'] },
                { pattern: /descent\s*device/i, terms: ['descent'] },
                { pattern: /\bev\b|electric\s*vehicle|fire\s*blanket/i, terms: ['EV', 'fire blanket'] },
                { pattern: /life\s*raft|liferaft/i, terms: ['liferaft', 'life raft'] },
                { pattern: /foam/i, terms: ['foam'] },
            ];

            const matchedCategory = categoryPatterns.find(c => c.pattern.test(lowerQuery));
            if (matchedCategory) {
                console.log('[server] Category supplement triggered for:', matchedCategory.terms.join('/'));
                const supabase = getSupabase();
                if (supabase) {
                    try {
                        const catSeenIds = new Set(searchResults.map(r => r.id));
                        const orQuery = matchedCategory.terms
                            .map(t => `name.ilike.%${t}%,category.ilike.%${t}%,description.ilike.%${t}%`)
                            .join(',');
                        const { data: catProducts } = await Promise.race([
                            supabase.from('products')
                                .select('id, product_code, name, category, specifications, description, applications, pdf_storage_url')
                                .or(orQuery)
                                .limit(50),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Category Search Timeout')), DB_TIMEOUT))
                        ]);

                        let catAdded = 0;
                        for (const product of (catProducts || [])) {
                            if (!catSeenIds.has(product.id)) {
                                searchResults.push({ ...product, similarity: 1.85, type: 'category' });
                                catSeenIds.add(product.id);
                                catAdded++;
                            }
                        }
                        console.log('[server] Category supplement added', catAdded, 'products for', matchedCategory.terms[0]);
                        // Allow more results for category queries so AI can list all options
                        searchResults = searchResults.sort((a, b) => (b.similarity || 0) - (a.similarity || 0)).slice(0, 30);
                    } catch (err) {
                        console.warn('[server] Category supplement failed:', err.message);
                    }
                }
            }

            // === FEATURE/ATTRIBUTE SUPPLEMENT ===
            // When a query asks about product features (colours, heaters, insulation, locking, extras, etc.)
            // scan ALL products to find those that mention the relevant feature
            const featurePatterns = [
                { pattern: /colou?r|paint|ral|finish/i, terms: ['colour', 'color', 'ral', 'paint', 'finish'] },
                { pattern: /heater|heated|heating/i, terms: ['heater', 'heated', 'heating'] },
                { pattern: /insulat/i, terms: ['insulation', 'insulated'] },
                { pattern: /lock|locking/i, terms: ['lock', 'locking'] },
                { pattern: /optional|extras|option|upgrade/i, terms: ['optional', 'extras', 'option'] },
                { pattern: /mount|wall.?mount|bracket/i, terms: ['mount', 'mounting', 'bracket'] },
                { pattern: /window|glazed|transparent/i, terms: ['window', 'glazed'] },
                { pattern: /shelf|shelves|rack/i, terms: ['shelf', 'shelves', 'rack'] },
                { pattern: /arctic|cold|frost/i, terms: ['arctic', 'cold', 'frost'] },
                { pattern: /door|hinge|seal/i, terms: ['door', 'hinge', 'seal'] },
            ];

            const matchedFeature = featurePatterns.find(f => f.pattern.test(lowerQuery));
            if (matchedFeature) {
                console.log('[server] Feature supplement triggered for:', matchedFeature.terms.join('/'));
                const supabase = getSupabase();
                if (supabase) {
                    try {
                        const featSeenIds = new Set(searchResults.map(r => r.id));
                        const { data: allProducts } = await Promise.race([
                            supabase.from('products')
                                .select('id, product_code, name, category, specifications, description, applications, pdf_storage_url')
                                .limit(200),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Feature Filter Timeout')), DB_TIMEOUT))
                        ]);

                        let featAdded = 0;
                        for (const product of (allProducts || [])) {
                            if (!featSeenIds.has(product.id)) {
                                const specStr = JSON.stringify(product.specifications || {}).toLowerCase();
                                const descStr = (product.description || '').toLowerCase();
                                const appsStr = (product.applications || '').toLowerCase();
                                const combined = specStr + ' ' + descStr + ' ' + appsStr;

                                const hasFeature = matchedFeature.terms.some(term => combined.includes(term.toLowerCase()));
                                if (hasFeature) {
                                    searchResults.push({ ...product, similarity: 1.85, type: 'feature-filter' });
                                    featSeenIds.add(product.id);
                                    featAdded++;
                                }
                            }
                        }
                        console.log('[server] Feature supplement added', featAdded, 'products for', matchedFeature.terms[0]);
                        searchResults = searchResults.sort((a, b) => (b.similarity || 0) - (a.similarity || 0)).slice(0, 30);
                    } catch (err) {
                        console.warn('[server] Feature supplement failed:', err.message);
                    }
                }
            }
        }

        // Skip history supplement and KB stats for follow-up fast path
        if (!isFollowUpPath) {
            // Supplement with history product codes that aren't already in results
            if (historyProductCodes.length > 0) {
                const existingIds = new Set(searchResults.map(r => r.id));
                const existingCodes = new Set(searchResults.map(r => r.product_code?.toLowerCase()).filter(Boolean));

                const missingCodes = historyProductCodes.filter(code => !existingCodes.has(code.toLowerCase()));

                if (missingCodes.length > 0) {
                    console.log('[server] Supplementing search with history products:', missingCodes.join(', '));
                    const supabase = getSupabase();
                    if (supabase) {
                        try {
                            const supplementResults = await Promise.race([
                                Promise.all(missingCodes.slice(0, 3).map(code =>
                                    supabase.from('products')
                                        .select('id, product_code, name, category, specifications, description, applications, pdf_storage_url')
                                        .or(`product_code.ilike.%${code}%,name.ilike.%${code}%`)
                                        .limit(3)
                                        .then(({ data }) => data || [])
                                        .catch(() => [])
                                )),
                                new Promise((_, reject) => setTimeout(() => reject(new Error('History Supplement Timeout')), DB_TIMEOUT))
                            ]);

                            for (const products of supplementResults) {
                                for (const product of products) {
                                    if (!existingIds.has(product.id)) {
                                        searchResults.push({ ...product, similarity: 1.8 });
                                        existingIds.add(product.id);
                                    }
                                }
                            }
                        } catch (suppErr) {
                            console.warn(`[server] History supplement skipped: ${suppErr.message}`);
                        }
                    }
                }
            }
        }

        console.log('[server] Search matched', searchResults.length, 'products.');

        // Build structured product context for Gemini
        const productContext = searchResults.map(p => {
            const specs = p.specifications || {};
            const specLines = Object.entries(specs)
                .map(([key, val]) => {
                    if (typeof val === 'object' && val !== null) {
                        return `  ${key}: ${JSON.stringify(val)}`;
                    }
                    return `  ${key}: ${val}`;
                })
                .join('\n');
            const pdfFilename = p.pdf_storage_url || `${p.product_code}.pdf`;
            const pdfUrl = `${PDF_STORAGE_BASE}/${encodeURIComponent(pdfFilename)}`;
            return `--- PRODUCT: ${p.product_code} ---
Name: ${p.name || 'N/A'}
Category: ${p.category || 'N/A'}
Specifications:
${specLines || '  (none)'}
Applications: ${p.applications || 'N/A'}
Description: ${p.description || 'N/A'}
OFFICIAL_DATASHEET_URL: ${pdfUrl}
`;
        }).join('\n');

        console.log('[server] searchResults count before datasheet extraction:', searchResults.length);
        console.log('[server] searchResults codes:', searchResults.map(r => r.product_code).filter(Boolean).join(', '));
        const referencedDatasheets = extractDatasheetReferences(searchResults);
        const conversationContext = buildConversationContext(history);

        // Get knowledge base stats (skip for follow-ups — not needed)
        let kbStatsContext = '';
        if (!isFollowUpPath) {
            const kbStats = await getKnowledgeBaseStats();
            const isBroad = searchResults.length < 3 || lowerQuery.includes('how many') || lowerQuery.includes('list') || lowerQuery.includes('categories');
            kbStatsContext = isBroad
                ? `\n\nKNOWLEDGE BASE OVERVIEW:\n- Total product entries in catalog: ${kbStats.totalProducts}\n- NOTE: The original master spreadsheet contains 183 product variants. These have been consolidated into ${kbStats.totalProducts} model-specific entries in the database. For example, size variants like JB08LJ.600 and JB08LJ.800 are merged into a single JB08LJ entry that covers all sizes. This consolidation reduces duplication while preserving all technical data.\n- Product Categories:\n  * ${kbStats.categories.join('\n  * ')}\n- Sample products: ${kbStats.sampleProducts.slice(0, 8).join(', ')}\n`
                : `\n\nKNOWLEDGE BASE OVERVIEW:\n- Total product entries in catalog: ${kbStats.totalProducts}\n- NOTE: The original master spreadsheet contains 183 product variants, consolidated into ${kbStats.totalProducts} model-specific entries (size/colour variants merged into single entries).\n`;
        }

        const promptContext = `
${conversationContext}
${kbStatsContext}

UPLOADED CONTEXT (PRIORITIZE THIS FOR THE USER'S SPECIFIC ENQUIRY):
${uploadedContext || 'No files uploaded.'}

PRODUCT CATALOG RESULTS:
${productContext || 'No matching products found.'}`;

        console.log(`[server] Prompt Context built. Length: ${promptContext.length}. Products: ${searchResults.length}`);
        // Log individual product URLs for verification
        searchResults.forEach(p => {
            const pdfFilename = p.pdf_storage_url || `${p.product_code}.pdf`;
            console.log(`[server] Product Context Item: ${p.product_code} -> ${PDF_STORAGE_BASE}/${encodeURIComponent(pdfFilename)}`);
        });

        res.write('data: ' + JSON.stringify({ type: 'status', message: 'Generating response...' }) + '\n\n');
        const chatModel = 'models/gemini-2.0-flash';
        const ai = getAI();

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
                            parts: [{ text: stripCitations(m.content) }]
                        })),
                        {
                            role: 'user',
                            parts: [
                                { text: promptContext },
                                { text: `CURRENT QUERY: ${query}\n\nSTRICT RULES:\n1. Do NOT include any parenthetical citations, source filenames, or "Source: ..." text in your response.\n2. For every recommended product, you MUST include a [Datasheet PDF](URL) link using ONLY the OFFICIAL_DATASHEET_URL from the PRODUCT CATALOG above. NEVER use jobird.co.uk links or any URL from your training data. Copy the exact URL from the OFFICIAL_DATASHEET_URL field.` }
                            ]
                        }
                    ],
                    config: {
                        systemInstruction: SYSTEM_INSTRUCTION,
                        temperature: 0.0
                    }
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('AI Generation Timeout (45s)')), 45000))
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
            // Per-chunk timeout: if no chunk arrives in 20s, break the loop
            const CHUNK_TIMEOUT = 20000;
            for await (const chunk of response) {
                if (requestDone) break; // Global timeout already fired
                chunkCount++;
                const chunkText = chunk.text || '';
                if (chunkText) {
                    fullText += chunkText;
                    // Apply real-time stripping for the stream
                    const displayOutput = stripCitations(fullText);
                    res.write(`data: ${JSON.stringify({ type: 'chunk', text: displayOutput })}\n\n`);
                }

                if (chunkCount % 5 === 0) {
                    console.log(`[server] Sent ${chunkCount} chunks so far...`);
                }
            }
            console.log(`[server] Stream complete. Total chunks: ${chunkCount}, Total chars: ${fullText.length}`);
        } catch (streamIterError) {
            console.error('[server] Error during stream iteration:', streamIterError);
            if (!requestDone) {
                res.write(`data: ${JSON.stringify({ type: 'chunk', text: fullText + '\n\n[Response was cut short. Please try again.]' })}\n\n`);
            }
        }

        // Extract citations from the response and filter datasheets
        console.log(`[server] Extracting citations for final event... Response length: ${fullText.length}`);
        const citedDatasheets = filterDatasheetsByCitations(fullText, referencedDatasheets, searchResults);

        // Final safety strip for citations
        const finalOutput = stripCitations(fullText);
        if (!requestDone) {
            console.log(`[server] Sending 'done' payload with ${citedDatasheets.length} datasheets`);
            res.write(`data: ${JSON.stringify({ type: 'done', text: finalOutput, datasheets: citedDatasheets })}\n\n`);
            res.end();
        }
        cleanup();

    } catch (error) {
        console.error('[server] Top-level Stream endpoint error:', error);
        console.error(error.stack);
        cleanup();
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

        const results = await searchProducts(query, matchCount);
        res.json({ results });

    } catch (error) {
        console.error('[server] Search error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// Diagnostic endpoint to check configuration without exposing secrets
app.get('/api/diag', async (req, res) => {
    const vars = Object.keys(process.env)
        .filter(k => k.includes('GEMINI') || k.includes('SUPABASE') || k.includes('FIREBASE') || k.includes('PASSWORD'))
        .reduce((acc, key) => {
            acc[key] = process.env[key] ? `set (length: ${process.env[key].length})` : 'MISSING';
            return acc;
        }, {});

    // Test Supabase connectivity
    let supabaseTest = 'not tested';
    try {
        const sb = getSupabase();
        if (sb) {
            const { data, error } = await sb.from('products').select('product_code').limit(3);
            supabaseTest = error ? `ERROR: ${error.message}` : `OK: ${(data || []).length} products (e.g. ${(data || []).map(p => p.product_code).join(', ')})`;
        } else {
            supabaseTest = 'Supabase client is NULL';
        }
    } catch (e) {
        supabaseTest = `EXCEPTION: ${e.message}`;
    }

    res.json({
        node_env: process.env.NODE_ENV,
        port: process.env.PORT,
        vars,
        resolved_supabase_url: SUPABASE_URL ? `${SUPABASE_URL.substring(0, 20)}...` : 'UNDEFINED',
        resolved_supabase_key: SUPABASE_SERVICE_ROLE_KEY ? `set (length: ${SUPABASE_SERVICE_ROLE_KEY.length})` : 'UNDEFINED',
        ai_initialized: !!aiInstance,
        supabase_initialized: !!supabaseInstance,
        supabase_test: supabaseTest,
        pdf_storage_base: PDF_STORAGE_BASE,
        server_time: new Date().toISOString()
    });
});

// Simple test endpoint to verify AI without streaming
app.get('/api/test-ai', async (req, res) => {
    try {
        const ai = getAI();
        if (!ai) return res.status(500).json({ error: 'AI not configured' });

        const result = await ai.models.generateContent({
            model: 'models/gemini-2.0-flash',
            contents: 'Say "AI is working"'
        });
        res.json({ result: result.text });
    } catch (err) {
        res.status(500).json({ error: err.message });
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
