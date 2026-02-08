// lib/embedQuery.ts
import { getConfig } from "./config";

export async function embedQuery(text: string): Promise<number[]> {
    const config = getConfig();

    if (!config.VITE_GEMINI_API_KEY) {
        throw new Error("Gemini API key is missing in configuration");
    }

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${config.VITE_GEMINI_API_KEY}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                content: { parts: [{ text }] },
                outputDimensionality: 768
            }),
        }
    );

    const json = await res.json() as any;

    if (!json.embedding?.values) {
        console.error("Embedding API Error:", json);
        throw new Error("Failed to embed query: " + (json.error?.message || "Unknown error"));
    }

    return json.embedding.values;
}
