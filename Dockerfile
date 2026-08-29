FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy server and source code
COPY server/ ./server/
COPY src/ ./src/

# Ensure keys directory and database directory exist
RUN mkdir -p /app/server /app/data

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

# Start the VoltIQ production server
CMD ["npx", "tsx", "server/server.ts"]
