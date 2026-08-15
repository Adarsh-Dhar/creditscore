# Setup Instructions

## Prerequisites
- Node.js and pnpm installed
- PostgreSQL database running
- Wallet extension (MetaMask, etc.) for testing

## Backend API Setup

**Quick start (recommended):**
```bash
./start-api.sh
```

**Manual setup:**

1. **Configure database connection:**
   ```bash
   cd api
   cp .env.example .env
   # Edit .env with your actual DATABASE_URL and other credentials
   ```

2. **Install dependencies:**
   ```bash
   cd api
   pnpm install
   pnpm approve-builds  # Approve Prisma build scripts
   npx prisma generate
   ```

3. **Start the API server:**
   ```bash
   cd api
   pnpm run dev
   ```
   The API will run on port 3001

## Frontend Setup

1. **Configure API URL:**
   ```bash
   cd frontend
   cp .env.local.example .env.local
   # The API URL is already set to http://localhost:3001
   ```

2. **Start the frontend:**
   ```bash
   cd frontend
   pnpm run dev
   ```
   The frontend will run on port 3000 (or 3001 if 3000 is occupied)

## Troubleshooting

### API returns 404 errors
- Make sure the backend API server is running on port 3001
- Check that DATABASE_URL is correctly configured in api/.env
- Ensure Prisma client has been generated: `cd api && npx prisma generate`

### Wallet connection errors
- Ensure you have a wallet extension installed (MetaMask, etc.)
- Some browser extensions may cause conflicts - try disabling other extensions
- Check browser console for specific error messages

### CORS errors
- Update CORS_ORIGINS in api/.env to include your frontend URL
- Example: `CORS_ORIGINS=http://localhost:3000,http://localhost:3001`

### Database connection errors
- Verify PostgreSQL is running
- Check DATABASE_URL format: `postgresql://user:password@localhost:5432/database_name`
- Ensure the database exists and credentials are correct

### Wallet connection errors with browser extensions
- **Symptom**: "Unexpected error" or "chrome-extension" errors when connecting wallet
- **Cause**: Conflicting browser extensions interfering with wallet communication
- **Solutions**:
  1. Try in incognito/private mode (most extensions are disabled there)
  2. Disable other crypto/Web3 extensions temporarily
  3. Use a different browser
  4. Check browser console for specific extension causing conflicts
- **Common conflicting extensions**: Other wallet extensions, ad blockers, privacy tools
