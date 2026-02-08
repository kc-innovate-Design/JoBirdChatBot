
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

async function embedText(text: string): Promise<number[]> {
    console.error(`Embedding: "${text}"`);
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${geminiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                content: { parts: [{ text }] },
                outputDimensionality: 768
            }),
        }
    );

    if (!res.ok) {
        const errorText = await res.text();
        console.error(`API Error: ${res.status} ${res.statusText}`);
        console.error(`Response Body: ${errorText}`);
        throw new Error(`Embedding API failed with status ${res.status}`);
    }

    const json = await res.json();
    if (!json.embedding?.values) {
        console.error("Embedding response structure invalid:", JSON.stringify(json, null, 2));
        throw new Error("Embedding failed - no values returned");
    }
    return json.embedding.values;
}

async function debug() {
    console.error("--- DEBUG START ---");

    const query = process.argv[2] || "JB02HR specifications dimensions";

    // 2. Perform Vector Search
    console.error(`\nPerforming Vector Search for '${query}'...`);
    try {
        const embedding = await embedText(query);

        const { data: vectorMatches, error: rpcError } = await supabase.rpc("match_pdf_chunks", {
            query_embedding: embedding,
            match_count: 5,
        });

        if (rpcError) {
            console.error("RPC Error:", rpcError);
        } else {
            console.error(`\n*** VECTOR SEARCH RETURNED ${vectorMatches?.length} RESULTS ***`);

            if (!vectorMatches || !Array.isArray(vectorMatches)) {
                console.error("CRITICAL: vectorMatches is NULL or not an array!");
            } else {
                vectorMatches.forEach((m: any, index: number) => {
                    console.log(`\n--- RESULT ${index + 1} [Sim: ${m.similarity.toFixed(4)}] Source: ${m.metadata.source} ---`);
                    console.log(m.content);
                    console.log("----------------------------------------------------------------");
                });
            }
        }

    } catch (e) {
        console.error(e);
    }
}

debug();
