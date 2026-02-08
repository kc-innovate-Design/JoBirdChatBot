# Stage 1: Build
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all files
COPY . .

# Build the application
RUN npm run build

# Stage 2: Serve
FROM nginx:stable-alpine

# Install envsubst (included in alpine)
RUN apk add --no-cache gettext

# Copy build output to nginx
COPY --from=build /app/dist /usr/share/nginx/html

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy config template
COPY public/config.json.template /usr/share/nginx/html/config.json.template

# Create startup script
RUN echo '#!/bin/sh' > /docker-entrypoint.d/40-generate-config.sh && \
    echo 'VARS="\$VITE_FIREBASE_API_KEY \$VITE_FIREBASE_AUTH_DOMAIN \$VITE_FIREBASE_PROJECT_ID \$VITE_FIREBASE_STORAGE_BUCKET \$VITE_FIREBASE_MESSAGING_SENDER_ID \$VITE_FIREBASE_APP_ID \$VITE_FIREBASE_MEASUREMENT_ID \$VITE_GEMINI_API_KEY \$VITE_SUPABASE_URL \$VITE_SUPABASE_SERVICE_ROLE_KEY \$VITE_APP_PASSWORD"' >> /docker-entrypoint.d/40-generate-config.sh && \
    echo 'envsubst "$VARS" < /usr/share/nginx/html/config.json.template > /usr/share/nginx/html/config.json' >> /docker-entrypoint.d/40-generate-config.sh && \
    chmod +x /docker-entrypoint.d/40-generate-config.sh

# Expose port (Cloud Run uses PORT env var, default 8080)
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
