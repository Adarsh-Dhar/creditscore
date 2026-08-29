import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import express, { type Request, type Response, type NextFunction, type ErrorRequestHandler } from "express";
import cors from "cors";

import walletsRouter from "./routes/wallets";
import leaderboardRouter from "./routes/leaderboard";
import chainsRouter from "./routes/chains";
import queueRouter from "./routes/queue";
import weightsRouter from "./routes/weights";

const app = express();
const PORT = process.env.PORT || 3000;

// CORS setup
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((origin) => origin.trim())
  : ["http://localhost:3000"];

app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  })
);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount routers
app.use("/api/wallets", walletsRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/chains", chainsRouter);
app.use("/api/queue", queueRouter);
app.use("/api/weights", weightsRouter);

// Health check
app.get("/api/health", (req: Request, res: Response) => {
  // Check database connection status
  const dbConfigured = !!process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("user:password");

  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    database: dbConfigured ? "configured" : "not configured",
    message: dbConfigured ? "Database connection configured" : "Please configure DATABASE_URL in api/.env",
  });
});

interface HttpError extends Error {
  status?: number;
}

// Centralized error handler
const errorHandler: ErrorRequestHandler = (err: HttpError, req: Request, res: Response, next: NextFunction) => {
  console.error("Server error:", err);

  // Never leak stack traces to the client
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};
app.use(errorHandler);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// Start server
app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
  console.log(`CORS origins: ${corsOrigins.join(", ")}`);

  // Validate database connection on startup
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes("user:password")) {
    console.error("⚠️  WARNING: DATABASE_URL is not properly configured");
    console.error("Please edit api/.env with your actual PostgreSQL credentials");
    console.error("Format: postgresql://username:password@localhost:5432/database_name");
  }
});

export default app;
