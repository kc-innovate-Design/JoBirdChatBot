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

# Expose port (Cloud Run uses PORT env var, default 8080)
EXPOSE 8080

# Start the Express server
# Frontend now fetches config via /api/config
CMD ["node", "server/index.js"]
