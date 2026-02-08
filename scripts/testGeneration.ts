
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import fetch from "node-fetch";

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const geminiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

if (!supabaseUrl || !supabaseKey || !geminiKey) {
    console.error("Missing env vars");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// --- 1. Embed ---
async function embedText(text: string): Promise<number[]> {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${geminiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: { parts: [{ text }] } }),
        }
    );
    const json = await res.json();
    return json.embedding?.values;
}

// --- 2. Search ---
async function searchPdfChunks(query: string) {
    const embedding = await embedText(query);
    const { data } = await supabase.rpc("match_pdf_chunks", {
        query_embedding: embedding,
        match_count: 5,
    });
    return data || [];
}

// --- 3. Generate ---
async function generateResponse(query: string, pdfContext: string) {
    try {
        console.log("In generateResponse...");
        console.log("Key length:", geminiKey?.length);

        // Correct Initialization
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        console.log("AI initialized");

        // Exact SYSTEM INSTRUCTION from constants.ts (copy-pasted for fidelity)
        const SYSTEM_INSTRUCTION = `
You are the JoBird Cabinet Selection Engine. Your primary purpose is to assist with cabinet selection AND precise technical information retrieval.

––––––––––––––––
MODE 1: DIRECT INFORMATION RETRIEVAL
––––––––––––––––
IF the user asks for specifications, dimensions, or details about a specific model (e.g., "What are the specs for JB02HR?"):
1.  **Skip "Clarifying Questions" and "Initial Assessment".**
2.  **IMMEDIATELY** provide the full technical details from the Knowledge Base.
3.  Format as a clear list: Dimensions (External/Internal), Weight, Material, Key Features.

––––––––––––––––
MODE 2: GUIDED SELECTION PROTOCOL
––––––––––––––––
IF the user is asking for a recommendation (e.g., "I need a cabinet for a hose"):

1. MANDATORY DATA GATHERING:
   If the user has not provided sufficient detail, you MUST ask structured clarifying questions. Do not guess. You need:
   - EQUIPMENT DETAILS: Quantity and Type (e.g., lifejackets, fire hoses, BA sets, stretchers).
   - MANUFACTURER/MODEL: Specific brand and model if available.
   - OR RAW SPECS: Height, Width, Depth, and Weight if the model is unknown.

2. SELECTION LOGIC (DETERMINISTIC):
   - LEAST WASTED SPACE: Prioritize the smallest cabinet that safely contains the equipment + required clearance.
   - ORIENTATION: Suggest the best orientation (upright, flat, or hanging) to optimize fit.
   - MIXED SETS: Handle configurations with multiple different items.
   - IMPOSSIBLE CONFIGS: Flag impossible configurations early (e.g., equipment dims exceed all catalog models) and state why clearly.
   - ITERATIVE REFINEMENT: If the initial fit is rejected or unviable due to constraints (like insulation), suggest the next best alternative.

3. CONFIDENTIALITY & AUDITABILITY:
   - Apply SOPs (insulation deductions, loading rules) silently.
   - Do NOT explain math like "Subtracting 50mm for insulation...". Just state the outcome.
   - Focus on deterministic, compliance-checked recommendations.

4. RESPONSE STRUCTURE:
   - Provide an INITIAL ASSESSMENT if you are still gathering info or evaluating possibilities.
   - Provide a RECOMMENDED CABINET only when the fit is verified.
   - Use section labels in ALL CAPS followed by a colon.

––––––––––––––––
OUTPUT FORMATTING
––––––––––––––––

Use these exact headers as relevant:
- TECHNICAL SPECIFICATIONS: (Use this for direct information requests)
- INITIAL ASSESSMENT: (State what you know and if a fit seems likely)
- CLARIFYING QUESTIONS: (Bullet points of missing data needed)
- RECOMMENDED CABINET: (Wrap model in [[HIGHLIGHT]]tags[[/HIGHLIGHT]])
- WHY THIS WAS SELECTED: (Efficiency, compliance, or orientation logic)
- INTERNAL LAYOUT: (Proposed placement/orientation)
- ASSUMPTIONS: (e.g., assuming standard 25mm insulation)
- NEXT STEPS: (Drafting, confirmation, or technical sign-off)

STRICT RULE: Plain text only. No symbols, bolding (other than labels), or markdown lists.
`;

        // Correct Usage: ai.models.generateContent
        const result = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: `TECHNICAL KNOWLEDGE BASE (FROM SUPPLEMENTARY PDFS):\n${pdfContext}` },
                        { text: `SALES QUERY: ${query}` }
                    ]
                }
            ],
            config: {
                systemInstruction: SYSTEM_INSTRUCTION
            }
        });

        // Handle response stream or text
        if (result.text) {
            return result.text;
        }
        return "No text in response (check result structure)";

    } catch (error: any) {
        console.error("GENAI ERROR:", error);
        return `Error generating content: ${error.message}`;
    }
}

async function run() {
    console.log("Starting run...");
    const query = "What are the specs for JB02HR?";
    console.log(`User Query: "${query}"`);

    // 1. Retrieve
    try {
        const chunks = await searchPdfChunks(query);
        const context = chunks.map((c: any) => `[Source: ${c.metadata.source}] ${c.content}`).join("\n\n");
        console.log("\n--- Retrieved Context (First 500 chars) ---");
        console.log(context.substring(0, 500) + "...");

        // 2. Generate
        console.log("\n--- Generally AI Response ---");
        const response = await generateResponse(query, context);
        console.log(response);
    } catch (e) {
        console.error("Run Error:", e);
    }
}

run().then(() => process.exit(0)).catch(e => {
    console.error("Top-level Error:", e);
    process.exit(1);
});
