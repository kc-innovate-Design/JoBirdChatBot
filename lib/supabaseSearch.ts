// Client-side wrapper that calls the secure backend API
// Supabase service role key is now only on the server

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
    try {
        const response = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: question, matchCount })
        });

        if (!response.ok) {
            console.error('Search API error:', response.status);
            return [];
        }

        const data = await response.json();
        return data.results || [];
    } catch (err) {
        console.error('Search failed:', err);
        return [];
    }
}

export interface KnowledgeBaseStats {
    totalDatasheets: number;
    categoryMatches?: { keyword: string; count: number; datasheets: string[] }[];
}

export async function getKnowledgeBaseStats(categoryKeyword?: string): Promise<KnowledgeBaseStats> {
    try {
        const url = categoryKeyword
            ? `/api/stats?category=${encodeURIComponent(categoryKeyword)}`
            : '/api/stats';

        const response = await fetch(url);

        if (!response.ok) {
            console.error('Stats API error:', response.status);
            return { totalDatasheets: 0 };
        }

        return await response.json();
    } catch (err) {
        console.error('Stats query failed:', err);
        return { totalDatasheets: 0 };
    }
}

// Legacy exports for compatibility - no longer used but kept for type definitions
export function getSupabase() {
    console.warn('getSupabase() is deprecated - all Supabase calls now go through the secure backend');
    return null;
}
