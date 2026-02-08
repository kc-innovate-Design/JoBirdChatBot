import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const BUCKET_NAME = 'datasheets';
const TEMP_DIR = './temp_pdfs';

async function downloadAndIngestPDFs() {
    console.log('🔍 Fetching PDF list from Supabase Storage...\n');

    // Create temp directory
    if (!existsSync(TEMP_DIR)) {
        mkdirSync(TEMP_DIR, { recursive: true });
    }

    // List all files in the bucket
    const { data: files, error: listError } = await supabase
        .storage
        .from(BUCKET_NAME)
        .list('', {
            limit: 1000,
            sortBy: { column: 'name', order: 'asc' }
        });

    if (listError) {
        console.error('Error listing files:', listError);
        process.exit(1);
    }

    const pdfFiles = files?.filter(f => f.name.toLowerCase().endsWith('.pdf')) || [];
    console.log(`📄 Found ${pdfFiles.length} PDF files in Supabase Storage\n`);

    if (pdfFiles.length === 0) {
        console.log('No PDF files found in the bucket.');
        process.exit(0);
    }

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < pdfFiles.length; i++) {
        const file = pdfFiles[i];
        const fileName = file.name;

        console.log(`\n[${i + 1}/${pdfFiles.length}] Processing: ${fileName}`);

        try {
            // Download PDF from Supabase Storage
            console.log(`  ⬇️  Downloading...`);
            const { data: pdfData, error: downloadError } = await supabase
                .storage
                .from(BUCKET_NAME)
                .download(fileName);

            if (downloadError) {
                throw new Error(`Download failed: ${downloadError.message}`);
            }

            // Save to temp file
            const tempPath = join(TEMP_DIR, fileName);
            const arrayBuffer = await pdfData.arrayBuffer();
            writeFileSync(tempPath, Buffer.from(arrayBuffer));
            console.log(`  💾 Saved to: ${tempPath}`);

            // Process with ingestPDF.ts
            console.log(`  🔄 Ingesting into database...`);
            execSync(`npx tsx scripts/ingestPDF.ts "${tempPath}"`, {
                stdio: 'inherit',
                timeout: 300000 // Increased to 5 minutes per PDF for safety
            });

            successCount++;
            console.log(`  ✅ Success: ${fileName}`);

        } catch (error: any) {
            failCount++;
            console.error(`  ❌ Failed: ${fileName}`);
            console.error(`  Error: ${error.message}`);
        }
    }

    console.log('\n\n=== BATCH PROCESSING COMPLETE ===');
    console.log(`Total PDFs: ${pdfFiles.length}`);
    console.log(`✅ Successful: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log(`\nYou can now delete the ${TEMP_DIR} folder if you want.`);
}

downloadAndIngestPDFs();
