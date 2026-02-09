// Client-side configuration - ONLY contains safe-to-expose values
// Sensitive keys (Gemini, Supabase service role) are now SERVER-SIDE ONLY

export interface AppConfig {
    VITE_FIREBASE_API_KEY: string;
    VITE_FIREBASE_AUTH_DOMAIN: string;
    VITE_FIREBASE_PROJECT_ID: string;
    VITE_FIREBASE_STORAGE_BUCKET: string;
    VITE_FIREBASE_MESSAGING_SENDER_ID: string;
    VITE_FIREBASE_APP_ID: string;
    VITE_FIREBASE_MEASUREMENT_ID: string;
    // These are kept for backwards compatibility but will be empty in production
    // The actual keys are now server-side only
    VITE_GEMINI_API_KEY: string;
    // Separate restricted key for Live Mode (voice) - safe to expose client-side
    VITE_GEMINI_LIVE_API_KEY: string;
    VITE_SUPABASE_URL: string;
    VITE_SUPABASE_SERVICE_ROLE_KEY: string;
    VITE_APP_PASSWORD: string;
}

let config: AppConfig | null = null;

export async function loadConfig(): Promise<AppConfig> {
    if (config) return config;

    // In production, we fetch from a JSON file that contains ONLY Firebase config
    // Sensitive keys are NOT included - they stay server-side
    try {
        const response = await fetch('/config.json');
        if (response.ok) {
            const runtimeConfig = await response.json();
            config = {
                VITE_FIREBASE_API_KEY: runtimeConfig.VITE_FIREBASE_API_KEY || import.meta.env.VITE_FIREBASE_API_KEY,
                VITE_FIREBASE_AUTH_DOMAIN: runtimeConfig.VITE_FIREBASE_AUTH_DOMAIN || import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
                VITE_FIREBASE_PROJECT_ID: runtimeConfig.VITE_FIREBASE_PROJECT_ID || import.meta.env.VITE_FIREBASE_PROJECT_ID,
                VITE_FIREBASE_STORAGE_BUCKET: runtimeConfig.VITE_FIREBASE_STORAGE_BUCKET || import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
                VITE_FIREBASE_MESSAGING_SENDER_ID: runtimeConfig.VITE_FIREBASE_MESSAGING_SENDER_ID || import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
                VITE_FIREBASE_APP_ID: runtimeConfig.VITE_FIREBASE_APP_ID || import.meta.env.VITE_FIREBASE_APP_ID,
                VITE_FIREBASE_MEASUREMENT_ID: runtimeConfig.VITE_FIREBASE_MEASUREMENT_ID || import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
                // These stay empty in production - calls go through backend API
                VITE_GEMINI_API_KEY: runtimeConfig.VITE_GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY || '',
                // Live Mode key - can be exposed client-side (should be a restricted key)
                VITE_GEMINI_LIVE_API_KEY: runtimeConfig.VITE_GEMINI_LIVE_API_KEY || import.meta.env.VITE_GEMINI_LIVE_API_KEY || '',
                VITE_SUPABASE_URL: runtimeConfig.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL || '',
                VITE_SUPABASE_SERVICE_ROLE_KEY: '', // NEVER sent to client
                VITE_APP_PASSWORD: '', // Password verification now done server-side
            };
            console.log("Runtime configuration loaded (secure mode)");
        }
    } catch (e) {
        console.warn("Could not load runtime config, falling back to build-time env vars", e);
    }

    if (!config) {
        const env = (import.meta as any).env || {};
        const procEnv = (typeof process !== 'undefined' ? process.env : {}) as any;

        config = {
            VITE_FIREBASE_API_KEY: env.VITE_FIREBASE_API_KEY || procEnv.VITE_FIREBASE_API_KEY || '',
            VITE_FIREBASE_AUTH_DOMAIN: env.VITE_FIREBASE_AUTH_DOMAIN || procEnv.VITE_FIREBASE_AUTH_DOMAIN || '',
            VITE_FIREBASE_PROJECT_ID: env.VITE_FIREBASE_PROJECT_ID || procEnv.VITE_FIREBASE_PROJECT_ID || '',
            VITE_FIREBASE_STORAGE_BUCKET: env.VITE_FIREBASE_STORAGE_BUCKET || procEnv.VITE_FIREBASE_STORAGE_BUCKET || '',
            VITE_FIREBASE_MESSAGING_SENDER_ID: env.VITE_FIREBASE_MESSAGING_SENDER_ID || procEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
            VITE_FIREBASE_APP_ID: env.VITE_FIREBASE_APP_ID || procEnv.VITE_FIREBASE_APP_ID || '',
            VITE_FIREBASE_MEASUREMENT_ID: env.VITE_FIREBASE_MEASUREMENT_ID || procEnv.VITE_FIREBASE_MEASUREMENT_ID || '',
            // For local development, these may be set via .env
            VITE_GEMINI_API_KEY: env.VITE_GEMINI_API_KEY || procEnv.VITE_GEMINI_API_KEY || '',
            // Live Mode key
            VITE_GEMINI_LIVE_API_KEY: env.VITE_GEMINI_LIVE_API_KEY || procEnv.VITE_GEMINI_LIVE_API_KEY || '',
            VITE_SUPABASE_URL: env.VITE_SUPABASE_URL || procEnv.VITE_SUPABASE_URL || '',
            VITE_SUPABASE_SERVICE_ROLE_KEY: '', // NEVER load this client-side
            VITE_APP_PASSWORD: '', // Password verified server-side
        };
    }

    return config;
}

export function getConfig(): AppConfig {
    if (!config) {
        throw new Error("Configuration not loaded. Call loadConfig() first.");
    }
    return config;
}
