#!/bin/sh
# Generate config.json from template using environment variables
# This runs at container startup before the Express server starts
# SECURITY: Only Firebase config and Live Mode key are included
# Main Gemini/Supabase keys stay server-side

envsubst '${VITE_FIREBASE_API_KEY} ${VITE_FIREBASE_AUTH_DOMAIN} ${VITE_FIREBASE_PROJECT_ID} ${VITE_FIREBASE_STORAGE_BUCKET} ${VITE_FIREBASE_MESSAGING_SENDER_ID} ${VITE_FIREBASE_APP_ID} ${VITE_FIREBASE_MEASUREMENT_ID} ${VITE_GEMINI_LIVE_API_KEY}' \
  < ./dist/config.json.template \
  > ./dist/config.json

echo "Generated config.json with Firebase and Live Mode configuration"
