import dotenv from 'dotenv';
import { getSelectionResponse } from '../geminiService';

dotenv.config();

async function reproduce() {
    const query = "what are the dimensions of Ship to Shore cabinet (JB04SS) Typical";
    console.log(`Query: ${query}`);

    try {
        const response = await getSelectionResponse(query, []);
        console.log("\nAI RESPONSE:");
        console.log(response);
    } catch (e) {
        console.error(e);
    }
}

reproduce();
