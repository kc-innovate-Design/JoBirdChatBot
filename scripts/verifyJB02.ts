import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl!, supabaseKey!);

async function verify() {
    const { data } = await supabase
        .from('pdf_chunks')
        .select('content, metadata')
        .ilike('content', '%JB02HR%')
        .limit(3);

    console.log(JSON.stringify(data, null, 2));
}

verify();
