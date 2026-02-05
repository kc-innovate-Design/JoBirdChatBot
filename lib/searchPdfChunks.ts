// lib/searchPdfChunks.ts
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { embedQuery } from "./embedQuery";

dotenv.config(); // ✅ MUST be before createClient

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
    // 1️⃣ Embed the question
    const embedding = await embedQuery(question);

    // 2️⃣ Call the SQL function
    const { data, error } = await supabase.rpc("match_pdf_chunks", {
        query_embedding: embedding,
        match_count: matchCount,
    });

    if (error) {
        throw error;
    }

    return data as PdfChunkMatch[];
}
