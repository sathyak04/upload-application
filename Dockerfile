    # --- Stage 1: The Builder ---
    # This stage will install all dependencies and build the TypeScript code.
    FROM node:20-slim AS builder

    WORKDIR /app

    # Install pnpm globally in the container
    RUN npm install -g pnpm

    # Copy the entire project context into the builder
    COPY . .

    # Install ALL dependencies for the entire monorepo (including dev dependencies)
    RUN pnpm install

    # Run the "build" script specifically for the 'server' package
    RUN pnpm --filter server build

    # After the build is complete, remove all development dependencies to keep the
    # final image small.
    RUN pnpm prune --prod


    # --- Stage 2: The Final Production Image ---
    # This stage will create a small, clean image with only what's needed to run.
    FROM node:20-slim

    WORKDIR /app

    # Copy the entire pruned project (with built code and production node_modules)
    # from the 'builder' stage.
    COPY --from=builder /app .

    # Expose the port that the server will run on
    EXPOSE 3000

    # The command to start the server. Note the path to the final built JavaScript file.
    CMD ["node", "packages/server/dist/index.js"]