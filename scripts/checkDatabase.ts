import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDatabase() {
    // Get total count
    const { count, error: countError } = await supabase
        .from('pdf_chunks')
        .select('*', { count: 'exact', head: true });

    console.log(`Total chunks in database: ${count}`);

    // Get unique sources
    const { data: sources, error: sourcesError } = await supabase
        .from('pdf_chunks')
        .select('metadata')
        .limit(1000);

    if (sources) {
        const uniqueSources = new Set(sources.map((s: any) => s.metadata?.source));
        console.log(`\nUnique PDF files: ${uniqueSources.size}`);
        console.log('\nFirst 20 PDF files:');
        Array.from(uniqueSources).slice(0, 20).forEach((source, i) => {
            console.log(`${i + 1}. ${source}`);
        });
    }

    // Search for JB08 specifically
    const { data: jb08Data, error: jb08Error } = await supabase
        .from('pdf_chunks')
        .select('content, metadata')
        .ilike('content', '%JB08%')
        .limit(5);

    console.log(`\n\nSearching for "JB08" in content:`);
    if (jb08Data && jb08Data.length > 0) {
        console.log(`Found ${jb08Data.length} chunks containing "JB08"`);
        jb08Data.forEach((chunk: any, i: number) => {
            console.log(`\n--- Chunk ${i + 1} ---`);
            console.log(`Source: ${chunk.metadata?.source}`);
            console.log(`Content preview: ${chunk.content.substring(0, 200)}...`);
        });
    } else {
        console.log('No chunks found containing "JB08"');
    }
}

checkDatabase();
