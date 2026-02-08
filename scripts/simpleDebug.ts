
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import fetch from "node-fetch";
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const geminiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

if (!supabaseUrl || !supabaseKey || !geminiKey) {
    console.error("Missing env vars");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function embedText(text: string): Promise<number[]> {
    console.log(`Embedding: "${text}"`);
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${geminiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                content: { parts: [{ text }] },
            }),
        }
    );
    const json = await res.json();
    return json.embedding?.values;
}

async function debug() {
    console.log("Starting debug...");
    const query = "JB02HR";
    const embedding = await embedText(query);

    const { data: vectorMatches, error } = await supabase.rpc("match_pdf_chunks", {
        query_embedding: embedding,
        match_count: 5,
    });

    if (error) {
        console.error("RPC Error:", error);
    } else {
        console.log(`Matches found: ${vectorMatches?.length}`);
        const outFile = path.resolve(process.cwd(), 'debug_results.json');
        fs.writeFileSync(outFile, JSON.stringify(vectorMatches, null, 2));
        console.log(`Wrote results to ${outFile}`);
    }
}

debug();
