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

1. **Set up PostgreSQL database:**
   ```bash
   # Make sure PostgreSQL is running
   brew services start postgresql  # macOS
   # or: sudo systemctl start postgresql  # Linux
   
   # Create database
   createdb creditscore_db
   
   # Or use psql to create:
   psql -d postgres
   CREATE DATABASE creditscore_db;
   \q
   ```

2. **Configure database connection:**
   ```bash
   cd api
   cp .env.example .env
   # Edit .env with your actual DATABASE_URL
   ```
   
   Example DATABASE_URL format:
   ```
   DATABASE_URL=postgresql://postgres:your_password@localhost:5432/creditscore_db
   ```
   
   Replace:
   - `postgres` with your PostgreSQL username
   - `your_password` with your PostgreSQL password
   - `localhost` with your database host if different
   - `5432` with your database port if different
   - `creditscore_db` with your database name if different

3. **Install dependencies:**
   ```bash
   cd api
   pnpm install
   pnpm approve-builds  # Approve Prisma build scripts
   npx prisma generate
   npx prisma migrate deploy
   ```

4. **Start the API server:**
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

### Database authentication errors
- **Error**: "Authentication failed for user user" or "ConnectorError"
- **Cause**: Using placeholder credentials (`user:password`) in DATABASE_URL
- **Fix**: Update `api/.env` with your actual PostgreSQL credentials
- **Format**: `postgresql://username:password@localhost:5432/database_name`
- **Steps**:
  1. Make sure PostgreSQL is running
  2. Create database: `createdb creditscore_db`
  3. Update DATABASE_URL in api/.env with real credentials
  4. Restart API server

### API returns 404 errors
- Make sure the backend API server is running on port 3001
- Check that DATABASE_URL is correctly configured in api/.env
- Ensure Prisma client has been generated: `cd api && npx prisma generate`

### Wallet connection errors
- Ensure you have MetaMask extension installed (the app is MetaMask-only)
- The app automatically ignores other wallet extensions to avoid conflicts
- Check browser console for specific error messages

### CORS errors
- Update CORS_ORIGINS in api/.env to include your frontend URL
- Current config: `CORS_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:3001`

### Wallet connection errors with browser extensions
- **Symptom**: "Unexpected error" or "chrome-extension" errors when connecting wallet
- **Cause**: Conflicting browser extensions interfering with wallet communication
- **Solutions**:
  1. Try in incognito/private mode (most extensions are disabled there)
  2. Disable other crypto/Web3 extensions temporarily
  3. Use a different browser
  4. Check browser console for specific extension causing conflicts
- **Common conflicting extensions**: Other wallet extensions, ad blockers, privacy tools
