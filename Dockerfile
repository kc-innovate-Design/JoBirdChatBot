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

# Copy startup script that generates config.json from env vars
COPY generate-config.sh /docker-entrypoint.d/40-generate-config.sh
RUN chmod +x /docker-entrypoint.d/40-generate-config.sh

# Expose port (Cloud Run uses PORT env var, default 8080)
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
