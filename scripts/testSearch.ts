import dotenv from "dotenv";
import { searchPdfChunks } from "../lib/supabaseSearch";

dotenv.config();

async function test() {
    const results = await searchPdfChunks(
        "What is the colour specification of the fire hose cabinet?",
        3
    );

    for (const r of results) {
        console.log("—");
        console.log("Source:", r.metadata.source);
        console.log("Chunk:", r.metadata.chunk);
        console.log("Similarity:", r.similarity.toFixed(3));
        console.log("Text:", r.content);
    }
}

test().catch(console.error);
