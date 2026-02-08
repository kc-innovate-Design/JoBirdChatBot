/**
 * PDF → text → chunks → Gemini embeddings → Supabase
 * Node 18–24 | ESM | tsx-safe
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

dotenv.config();

/* ------------------------------------------------------------------ */
/* ENV CHECK                                                          */
/* ------------------------------------------------------------------ */
const REQUIRED_ENVS = [
    "VITE_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "VITE_GEMINI_API_KEY",
];

for (const key of REQUIRED_ENVS) {
    if (!process.env[key]) {
        throw new Error(`Missing env var: ${key}`);
    }
}

/* ------------------------------------------------------------------ */
/* SUPABASE CLIENT                                                     */
/* ------------------------------------------------------------------ */
const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/* ------------------------------------------------------------------ */
/* TEXT CHUNKING                                                       */
/* ------------------------------------------------------------------ */
function chunkText(text: string, size = 1000, overlap = 200): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
        const end = start + size;
        chunks.push(text.slice(start, end));
        start = end - overlap;
    }

    return chunks;
}

/* ------------------------------------------------------------------ */
/* GEMINI EMBEDDINGS                                                   */
/* ------------------------------------------------------------------ */
async function embedText(text: string): Promise<number[]> {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${process.env.VITE_GEMINI_API_KEY}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                content: { parts: [{ text }] },
                outputDimensionality: 768
            }),
        }
    );

    const json = await res.json();

    if (!json.embedding?.values) {
        throw new Error("Gemini embedding failed");
    }

    return json.embedding.values;
}

/* ------------------------------------------------------------------ */
/* PDF TEXT EXTRACTION                                                 */
/* ------------------------------------------------------------------ */
async function extractPdfText(filePath: string): Promise<string> {
    const data = new Uint8Array(fs.readFileSync(filePath));
    const pdf = await pdfjs.getDocument({ data }).promise;

    let text = "";

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();

        text += content.items
            .map((item: any) => item.str)
            .join(" ");
    }

    return text.replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ */
/* MAIN INGEST                                                         */
/* ------------------------------------------------------------------ */
async function ingestPdf() {
    console.log("🚀 Ingest script started");

    // Get PDF path from command line arguments
    const pdfArg = process.argv[2];
    if (!pdfArg) {
        throw new Error("Usage: npx tsx scripts/ingestPDF.ts <path-to-pdf>");
    }

    const pdfPath = path.isAbsolute(pdfArg) ? pdfArg : path.join(process.cwd(), pdfArg);
    const fileName = path.basename(pdfPath);

    console.log("Processing PDF:", pdfPath);

    if (!fs.existsSync(pdfPath)) {
        throw new Error(`PDF not found at: ${pdfPath}`);
    }

    console.log("Reading PDF…");
    const text = await extractPdfText(pdfPath);

    // Clear existing chunks for this file
    const { error: deleteError } = await supabase
        .from('pdf_chunks')
        .delete()
        .eq('metadata->>source', fileName);

    if (deleteError) {
        console.error("Error clearing old chunks:", deleteError);
    } else {
        console.log(`Cleared old chunks for ${fileName}`);
    }

    const chunks = chunkText(text);
    console.log(`Extracted ${chunks.length} chunks`);

    for (let i = 0; i < chunks.length; i++) {
        const embedding = await embedText(chunks[i]);

        const { error } = await supabase.from("pdf_chunks").insert({
            content: chunks[i],
            embedding,
            metadata: {
                source: fileName,
                chunk: i + 1,
            },
        });

        if (error) throw error;

        console.log(`Inserted chunk ${i + 1}/${chunks.length}`);
    }

    console.log(`✅ Ingestion complete for ${fileName}`);
}

/* ------------------------------------------------------------------ */
/* RUN                                                                 */
/* ------------------------------------------------------------------ */
ingestPdf().catch((err) => {
    console.error("❌ Ingestion failed");
    console.error(err);
    process.exit(1);
});
