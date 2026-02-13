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

async function listSources() {
    const { data, error } = await supabase
        .from('pdf_chunks')
        .select('metadata')
        .limit(2000);

    if (error) {
        console.error(error);
        return;
    }

    const uniqueSources = Array.from(new Set(data.map((s: any) => s.metadata?.source))).sort();
    console.log(`Total unique sources: ${uniqueSources.length}`);
    uniqueSources.forEach(s => console.log(s));
}

listSources();
