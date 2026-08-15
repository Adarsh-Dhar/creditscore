require('dotenv').config();
const express = require('express');
const cors = require('cors');

const walletsRouter = require('./routes/wallets');
const leaderboardRouter = require('./routes/leaderboard');
const chainsRouter = require('./routes/chains');
const queueRouter = require('./routes/queue');
const weightsRouter = require('./routes/weights');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS setup
const corsOrigins = process.env.CORS_ORIGINS 
  ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
  : ['http://localhost:3000'];

app.use(cors({
  origin: corsOrigins,
  credentials: true
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount routers
app.use('/api/wallets', walletsRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/chains', chainsRouter);
app.use('/api/queue', queueRouter);
app.use('/api/weights', weightsRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Centralized error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  
  // Never leak stack traces to the client
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
  console.log(`CORS origins: ${corsOrigins.join(', ')}`);
});

module.exports = app;
