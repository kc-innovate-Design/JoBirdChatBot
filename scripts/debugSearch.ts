
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
    if (!json.embedding?.values) {
        console.error("Embedding response:", JSON.stringify(json, null, 2));
        throw new Error("Embedding failed");
    }
    return json.embedding.values;
}

async function debug() {
    console.log("--- DEBUG START ---");

    // 1. Check if 'jb02hr' exists in raw text
    console.log("Checking for 'jb02' text in chunks...");
    const { data: textMatches, error: textError } = await supabase
        .from('pdf_chunks')
        .select('id, content, metadata')
        .ilike('content', '%jb02%')
        .limit(3);

    if (textError) {
        console.error("Text search error:", textError);
    } else {
        console.log(`\n*** FOUND ${textMatches?.length || 0} TEXT MATCHES FOR 'jb02' ***`);
        // Force output even if empty
        if (!textMatches || textMatches.length === 0) {
            console.log("No chunks contain 'jb02'. The data is DEFINITELY NOT in Supabase.");
        } else {
            textMatches.forEach(m => console.log(`- MATCH [${m.id}]: ${m.content.substring(0, 50)}...`));
        }
    }

    // 2. Perform Vector Search
    console.log("\nPerforming Vector Search for 'jb02hr details'...");
    try {
        const query = "jb02hr details";
        const embedding = await embedText(query);

        const { data: vectorMatches, error: rpcError } = await supabase.rpc("match_pdf_chunks", {
            query_embedding: embedding,
            match_count: 5,
        });

        if (rpcError) {
            console.error("RPC Error:", rpcError);
        } else {
            console.log(`\n*** VECTOR SEARCH RETURNED ${vectorMatches.length} RESULTS ***`);
            vectorMatches.forEach((m: any) => {
                console.log(`\n[Similarity: ${m.similarity.toFixed(4)}] Source: ${m.metadata.source}`);
                console.log(`Content: ${m.content.substring(0, 150)}...`);
            });
        }

    } catch (e) {
        console.error(e);
    }
}

debug();
