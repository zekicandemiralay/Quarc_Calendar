const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { initDb } = require('./db');
const { requireAuth } = require('./middleware/auth');
const syncRoutes = require('./routes/sync');

const app = express();
const PORT = process.env.PORT || 3006;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'quarc-calendar-backend' }));

// Everything the client does goes through sync (offline-first): the client
// reads/writes its local database and exchanges changes here in batches.
app.use('/api/sync', requireAuth, syncRoutes);

initDb();

if (require.main === module) {
  app.listen(PORT, () => console.log(`Quarc Calendar backend listening on :${PORT}`));
}

module.exports = app;
