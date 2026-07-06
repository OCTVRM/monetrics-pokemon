require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const cardsRouter = require('./routes/cards');
const configRouter = require('./routes/config');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));
app.use(morgan('dev'));
app.use(express.json());

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/cards', cardsRouter);
app.use('/api/config', configRouter);

// ─── Serve Frontend (LOCAL DEV ONLY — Vercel serves static files via CDN) ─────
if (process.env.VERCEL !== '1') {
  app.use(express.static(path.join(__dirname, '..', 'client')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
  });
}

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ─── Start server (local dev) ─────────────────────────────────────────────────
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`\n🚀 Monetrics Pokemon Server running on http://localhost:${PORT}`);
    console.log(`   API: http://localhost:${PORT}/api/cards/search?q=Charizard`);
  });
}

// ─── Export for Vercel Serverless ─────────────────────────────────────────────
module.exports = app;

