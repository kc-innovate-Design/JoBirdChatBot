// Client-side wrapper that calls the secure backend API
// Supabase service role key is now only on the server

export interface ProductMatch {
    id: string;
    product_code: string;
    name: string;
    category: string;
    specifications: Record<string, any>;
    description: string;
    applications: string | null;
    pdf_storage_url: string;
    similarity: number;
}

// Legacy alias for backward compatibility
export type PdfChunkMatch = ProductMatch;

export async function searchProducts(
    question: string,
    matchCount = 5
): Promise<ProductMatch[]> {
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

// Legacy alias
export const searchPdfChunks = searchProducts;

export interface KnowledgeBaseStats {
    totalProducts: number;
    categories?: string[];
    sampleProducts?: string[];
}

export async function getKnowledgeBaseStats(): Promise<KnowledgeBaseStats> {
    try {
        const response = await fetch('/api/stats');

        if (!response.ok) {
            console.error('Stats API error:', response.status);
            return { totalProducts: 0 };
        }

        return await response.json();
    } catch (err) {
        console.error('Stats query failed:', err);
        return { totalProducts: 0 };
    }
}

// Legacy exports for compatibility - no longer used but kept for type definitions
export function getSupabase() {
    console.warn('getSupabase() is deprecated - all Supabase calls now go through the secure backend');
    return null;
}
