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
    "GEMINI_API_KEY",
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
function chunkText(text: string, size = 700, overlap = 100): string[] {
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
        `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GEMINI_API_KEY}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                content: { parts: [{ text }] },
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
    console.log("🚀 ingestPDF.ts loaded");
    console.log("🚀 Ingest script started");

    const pdfPath = path.join(process.cwd(), "data", "test.pdf");
    console.log("Looking for PDF at:", pdfPath);

    if (!fs.existsSync(pdfPath)) {
        throw new Error("PDF not found");
    }

    console.log("Reading PDF…");
    const text = await extractPdfText(pdfPath);

    const chunks = chunkText(text);
    console.log(`Extracted ${chunks.length} chunks`);

    for (let i = 0; i < chunks.length; i++) {
        const embedding = await embedText(chunks[i]);

        const { error } = await supabase.from("pdf_chunks").insert({
            content: chunks[i],
            embedding,
            metadata: {
                source: "test.pdf",
                chunk: i + 1,
            },
        });

        if (error) throw error;

        console.log(`Inserted chunk ${i + 1}`);
    }

    console.log("✅ Ingestion complete");
}

/* ------------------------------------------------------------------ */
/* RUN                                                                 */
/* ------------------------------------------------------------------ */
ingestPdf().catch((err) => {
    console.error("❌ Ingestion failed");
    console.error(err);
    process.exit(1);
});
