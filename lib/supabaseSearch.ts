import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "./config";
import { embedQuery } from "./embedQuery";

let supabase: SupabaseClient | null = null;

export function getSupabase() {
    if (supabase) return supabase;
    const config = getConfig();
    supabase = createClient(config.VITE_SUPABASE_URL, config.VITE_SUPABASE_SERVICE_ROLE_KEY);
    return supabase;
}

export interface PdfChunkMatch {
    id: string;
    content: string;
    metadata: {
        source: string;
        chunk: number;
    };
    similarity: number;
}


export async function searchPdfChunks(
    question: string,
    matchCount = 5
): Promise<PdfChunkMatch[]> {
    const config = getConfig();
    if (!config.VITE_SUPABASE_URL || !config.VITE_SUPABASE_SERVICE_ROLE_KEY) {
        console.error("Supabase configuration missing");
        return [];
    }

    try {
        // 1️⃣ Embed the question
        const embedding = await embedQuery(question);

        // 2️⃣ Call the SQL function
        const client = getSupabase();
        const { data, error } = await client.rpc("match_pdf_chunks", {
            query_embedding: embedding,
            match_count: matchCount,
        });

        if (error) {
            console.error("Supabase RPC Error:", error);
            throw error;
        }

        return data as PdfChunkMatch[];
    } catch (err) {
        console.error("Search failed:", err);
        return [];
    }
}
