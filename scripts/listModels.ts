
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Load .env from root
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}

const apiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

if (!apiKey) {
    fs.writeFileSync('models.txt', "No API Key found");
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

async function listModels() {
    try {
        const response = await ai.models.list();
        let output = "Available Models:\n";

        // Check if response is iterable directly or inside .models not working as expected
        // The previous output showed a JSON like structure with 'models' at the root but weird formatting.
        // Let's print the entire raw object to inspect structure if iteration fails, 
        // but try to safely iterate if possible.

        // Note: in 1.39.0, it might be an iterator or array.

        // Safer dumping:
        output += JSON.stringify(response, null, 2);

        fs.writeFileSync('models.txt', output);
        console.log("Written to models.txt");
    } catch (error: any) {
        fs.writeFileSync('models.txt', "Error: " + error.message + "\n" + JSON.stringify(error, null, 2));
    }
}

listModels();
