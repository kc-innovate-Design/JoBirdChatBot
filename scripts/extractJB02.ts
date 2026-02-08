import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl!, supabaseKey!);

async function extract() {
    const { data } = await supabase
        .from('pdf_chunks')
        .select('content')
        .ilike('content', '%JB02HR%')
        .order('id');

    if (data) {
        const fullText = data.map(d => d.content).join("\n\n---\n\n");
        fs.writeFileSync('jb02hr_content.txt', fullText);
        console.log("Extracted to jb02hr_content.txt");
    }
}

extract();
