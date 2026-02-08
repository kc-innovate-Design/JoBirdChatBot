import { readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// Directory containing your PDFs
const PDF_DIRECTORY = './temp_pdfs'; // Changed from ./pdfs to ./temp_pdfs

console.log(`Scanning for PDFs in: ${PDF_DIRECTORY}\n`);

try {
    const files = readdirSync(PDF_DIRECTORY);
    const pdfFiles = files.filter(f => f.toLowerCase().endsWith('.pdf'));

    console.log(`Found ${pdfFiles.length} PDF files\n`);

    if (pdfFiles.length === 0) {
        console.log('No PDF files found. Please update PDF_DIRECTORY in this script.');
        process.exit(1);
    }

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < pdfFiles.length; i++) {
        const pdfFile = pdfFiles[i];
        const pdfPath = join(PDF_DIRECTORY, pdfFile);

        console.log(`[${i + 1}/${pdfFiles.length}] Processing: ${pdfFile}`);

        try {
            execSync(`npx tsx scripts/ingestPDF.ts "${pdfPath}"`, {
                stdio: 'inherit',
                timeout: 60000 // 60 second timeout per PDF
            });
            successCount++;
            console.log(`✅ Success: ${pdfFile}\n`);
        } catch (error) {
            failCount++;
            console.error(`❌ Failed: ${pdfFile}`);
            console.error(`Error: ${error}\n`);
        }
    }

    console.log('\n=== BATCH PROCESSING COMPLETE ===');
    console.log(`Total PDFs: ${pdfFiles.length}`);
    console.log(`Successful: ${successCount}`);
    console.log(`Failed: ${failCount}`);

} catch (error) {
    console.error('Error reading PDF directory:', error);
    console.log('\nPlease update PDF_DIRECTORY in this script to point to your PDF folder.');
    process.exit(1);
}
