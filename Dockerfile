# --- Stage 1: The Builder ---
# This stage installs all dependencies and builds our TypeScript code
FROM node:20-slim AS builder

WORKDIR /app

# Copy root pnpm files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install pnpm itself
RUN npm install -g pnpm

# Copy the package.json files for all workspaces to leverage caching
COPY packages/server/package.json ./packages/server/
COPY packages/client/package.json ./packages/client/

# Install ALL dependencies (including dev dependencies needed for the build)
RUN pnpm install

# Now copy the rest of the source code
COPY . .

# Run the "build" script we just added to our server's package.json
RUN pnpm --filter server build


# --- Stage 2: The Final Production Image ---
# This stage creates a smaller, cleaner image for running the application
FROM node:20-slim

WORKDIR /app

# Copy the necessary files from the 'builder' stage
COPY --from=builder /app .

# Expose the port the server will run on
EXPOSE 3000

# The command to start the server. Note the path to the built output.
CMD ["node", "packages/server/dist/index.js"]