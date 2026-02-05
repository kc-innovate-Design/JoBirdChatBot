// lib/embedQuery.ts
import fetch from "node-fetch";

export async function embedQuery(text: string): Promise<number[]> {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GEMINI_API_KEY}`,
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
        throw new Error("Failed to embed query");
    }

    return json.embedding.values;
}
