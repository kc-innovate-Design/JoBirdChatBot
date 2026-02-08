import dotenv from 'dotenv';
import { searchPdfChunks } from '../lib/supabaseSearch';

dotenv.config();

async function diagnose() {
    const query = "what are the dimensions of Ship to Shore cabinet (JB04SS) Typical";
    console.log(`Query: ${query}`);

    const results = await searchPdfChunks(query, 5);
    console.log(`\nFound ${results.length} matches:`);

    results.forEach((r, i) => {
        console.log(`\n--- Match ${i + 1} (Score: ${r.similarity.toFixed(4)}) ---`);
        console.log(`Source: ${r.metadata.source}`);
        console.log(`Content: ${r.content}`);
    });
}

diagnose();
