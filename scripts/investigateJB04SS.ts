import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl!, supabaseKey!);

async function investigate() {
    console.log("Searching for 'JB04SS'...");
    const { data: chunks } = await supabase
        .from('pdf_chunks')
        .select('content, metadata')
        .ilike('content', '%JB04SS%');

    console.log(`Found ${chunks?.length || 0} chunks containing 'JB04SS'`);
    chunks?.forEach((c, i) => {
        console.log(`\n--- Chunk ${i + 1} (Source: ${c.metadata.source}) ---`);
        console.log(c.content.substring(0, 500));
    });

    console.log("\nSearching for 'Ship to Shore'...");
    const { data: shipToShore } = await supabase
        .from('pdf_chunks')
        .select('content, metadata')
        .ilike('content', '%Ship to Shore%');

    console.log(`Found ${shipToShore?.length || 0} chunks containing 'Ship to Shore'`);
    shipToShore?.forEach((c, i) => {
        console.log(`\n--- Ship to Shore Chunk ${i + 1} (Source: ${c.metadata.source}) ---`);
        console.log(c.content.substring(0, 500));
    });
}

investigate();
