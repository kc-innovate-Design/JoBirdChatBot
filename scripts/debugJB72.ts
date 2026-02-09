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

async function checkJB72() {
    console.log('--- Checking for JB72 in Database ---');

    // 1. Search in content
    const { data: contentData, error: contentError } = await supabase
        .from('pdf_chunks')
        .select('content, metadata')
        .ilike('content', '%JB72%')
        .limit(5);

    console.log(`\nSearch for "JB72" in content: Found ${contentData?.length || 0} chunks`);
    contentData?.forEach((c, i) => console.log(`  ${i + 1}. Source: ${c.metadata?.source}`));

    // 2. Search in metadata source
    const { data: metaData, error: metaError } = await supabase
        .from('pdf_chunks')
        .select('metadata')
        .ilike('metadata->>source', '%JB72%')
        .limit(5);

    console.log(`\nSearch for "JB72" in filename: Found ${metaData?.length || 0} chunks`);
    metaData?.forEach((c, i) => console.log(`  ${i + 1}. Filename: ${c.metadata?.source}`));

    // 3. Check for similar strings
    const { data: fuzzyData } = await supabase
        .from('pdf_chunks')
        .select('metadata')
        .ilike('metadata->>source', '%JB7%')
        .limit(10);

    console.log(`\nFuzzy search for "JB7":`);
    const uniqueFuzzy = new Set(fuzzyData?.map(d => d.metadata?.source));
    Array.from(uniqueFuzzy).forEach(s => console.log(`  - ${s}`));
}

checkJB72();
