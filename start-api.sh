#!/bin/bash

echo "Starting CreditScore API server..."
cd api

# Check if .env exists
if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "⚠️  Please edit api/.env with your actual DATABASE_URL and other credentials"
    echo "   Then run this script again."
    exit 1
fi

# Check if node_modules exists
if [ ! -d node_modules ]; then
    echo "Installing dependencies..."
    pnpm install
fi

# Generate Prisma client
echo "Generating Prisma client..."
npx prisma generate

# Start the server
echo "Starting API server on port 3002..."
PORT=3002 pnpm run dev
