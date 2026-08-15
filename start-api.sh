#!/bin/bash

echo "Starting CreditScore API server..."
cd api

# Check if .env exists
if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "⚠️  Please edit api/.env with your actual DATABASE_URL and other credentials"
    echo "   Then run this script again."
    echo ""
    echo "Required configuration:"
    echo "  DATABASE_URL=postgresql://username:password@localhost:5432/database_name"
    echo "  CONTRACT_ADDRESS=your_actual_contract_address"
    echo "  CC3_TESTNET_RPC=your_rpc_url (or SEPOLIA_RPC)"
    exit 1
fi

# Check if DATABASE_URL is still using placeholder values
if grep -q "user:password" .env; then
    echo "⚠️  WARNING: DATABASE_URL still has placeholder credentials"
    echo "Please edit api/.env with your actual PostgreSQL credentials"
    echo ""
    echo "Example format:"
    echo "  DATABASE_URL=postgresql://postgres:password@localhost:5432/creditscore_db"
    echo ""
    echo "To fix this:"
    echo "  1. Make sure PostgreSQL is running"
    echo "  2. Create a database: createdb creditscore_db"
    echo "  3. Update DATABASE_URL in api/.env with your credentials"
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
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
