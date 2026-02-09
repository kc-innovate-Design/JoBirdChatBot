# Stage 1: Build the frontend
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all source files
COPY . .

# Build the Vite application
RUN npm run build

# Stage 2: Production server
FROM node:20-alpine

WORKDIR /app

# Copy package files for production dependencies
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy the built frontend
COPY --from=build /app/dist ./dist

# Copy the server
COPY server ./server

# Copy config template for Firebase (safe to expose)
COPY public/config.json.template ./dist/config.json.template

# Copy script to generate Firebase config at runtime
COPY generate-config.sh ./generate-config.sh

# Convert Windows CRLF to Unix LF line endings and make executable
RUN sed -i 's/\r$//' ./generate-config.sh && sed -i 's/\r$//' ./dist/config.json.template && chmod +x ./generate-config.sh

# Expose port (Cloud Run uses PORT env var, default 8080)
EXPOSE 8080

# Generate Firebase config and start the Express server
CMD sh -c "./generate-config.sh && node server/index.js"
