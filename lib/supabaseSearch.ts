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

        const results = data as PdfChunkMatch[];

        // 3️⃣ Get unique source files from the top results
        const topSources = [...new Set(results.slice(0, 3).map(r => r.metadata.source))];

        // 4️⃣ Fetch ALL chunks from those source files to get complete product info
        if (topSources.length > 0) {
            const { data: siblingChunks, error: siblingError } = await client
                .from("pdf_chunks")
                .select("id, content, metadata")
                .in("metadata->>source", topSources);

            if (!siblingError && siblingChunks) {
                // Merge sibling chunks with original results, avoiding duplicates
                const existingIds = new Set(results.map(r => r.id));
                for (const chunk of siblingChunks) {
                    if (!existingIds.has(chunk.id)) {
                        results.push({
                            ...chunk,
                            similarity: 0.5 // Mark as sibling chunk with lower similarity
                        });
                    }
                }
            }
        }

        return results;
    } catch (err) {
        console.error("Search failed:", err);
        return [];
    }
}

export interface KnowledgeBaseStats {
    totalDatasheets: number;
    categoryMatches?: { keyword: string; count: number; datasheets: string[] }[];
}

export async function getKnowledgeBaseStats(categoryKeyword?: string): Promise<KnowledgeBaseStats> {
    const config = getConfig();
    if (!config.VITE_SUPABASE_URL || !config.VITE_SUPABASE_SERVICE_ROLE_KEY) {
        console.error("Supabase configuration missing");
        return { totalDatasheets: 0 };
    }

    try {
        const client = getSupabase();

        // Get all chunks to count unique sources
        const { data: sources, error } = await client
            .from("pdf_chunks")
            .select("metadata");

        if (error || !sources) {
            console.error("Failed to get stats:", error);
            return { totalDatasheets: 0 };
        }

        // Count unique PDF sources
        const uniqueSources = new Set(sources.map((s: any) => s.metadata?.source).filter(Boolean));
        const totalDatasheets = uniqueSources.size;

        // If a category keyword is provided, find matches and list them
        if (categoryKeyword) {
            const keyword = categoryKeyword.toLowerCase();
            const matchingSources = new Set<string>();

            for (const s of sources) {
                const source = s.metadata?.source?.toLowerCase() || '';
                if (source.includes(keyword)) {
                    matchingSources.add(s.metadata?.source);
                }
            }

            // Also search content for the keyword
            const { data: contentMatches } = await client
                .from("pdf_chunks")
                .select("metadata")
                .ilike("content", `%${categoryKeyword}%`);

            if (contentMatches) {
                for (const c of contentMatches) {
                    if (c.metadata?.source) {
                        matchingSources.add(c.metadata.source);
                    }
                }
            }

            // Convert to sorted array and create display names
            const datasheetList = Array.from(matchingSources).sort();

            return {
                totalDatasheets,
                categoryMatches: [{
                    keyword: categoryKeyword,
                    count: matchingSources.size,
                    datasheets: datasheetList
                }]
            };
        }

        return { totalDatasheets };
    } catch (err) {
        console.error("Stats query failed:", err);
        return { totalDatasheets: 0 };
    }
}

