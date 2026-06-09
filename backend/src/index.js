require('dotenv').config();
const express = require('express');
const http    = require('http');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const { setupWebSocket } = require('./websocket/manager');

// --- 1. Import Routes ---
const authRoutes         = require('./routes/auth');
const billRoutes         = require('./routes/bills');
const householdRoutes    = require('./routes/households');
const notificationRoutes = require('./routes/notifications');
const taskRoutes         = require('./routes/tasks');
const uploadRoutes       = require('./routes/uploads');
const requestRoutes      = require('./routes/requests');
const errorHandler       = require('./middleware/errorHandler');

const app    = express();
const server = http.createServer(app);

// --- 2. Global Middleware ---
app.use(cors());

// Body parser limit kept low (1mb). Bug #3 fix: we no longer try to push
// Base64 images through JSON — binary goes through multer/multipart instead,
// so the JSON body stays small and we don't need to raise this.
app.use(express.json({ limit: '1mb' }));

// --- 3. Static Frontend ---
const candidatePaths = [
  path.join(__dirname, '../../frontend'),
  path.join(__dirname, '../frontend'),
  path.join(__dirname, '../../rota-frontend-fixed')
];
const frontendPath = candidatePaths.find(p => fs.existsSync(p)) || candidatePaths[0];
app.use(express.static(frontendPath));

// --- 4. Static uploads removed — files now stored on Cloudflare R2.
// URLs are stored in the DB as full R2 public URLs so no local serving needed.

setupWebSocket(server);

// --- 5. API Routes ---
app.use('/api/auth',          authRoutes);
app.use('/api/bills',         billRoutes);
app.use('/api/households',    householdRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/tasks',         taskRoutes);
app.use('/api/upload',        uploadRoutes);
app.use('/api/requests',      requestRoutes);

// --- 6. Root & Fallback ---
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendPath, 'loadingscreen.html'));
});

app.get('*', (req, res, next) => {
  if (req.url.startsWith('/api')) return next();
  res.sendFile(path.join(frontendPath, 'loadingscreen.html'), (err) => {
    if (err) {
      console.error('❌ Path error — frontend at:', frontendPath);
      res.status(404).json({ error: 'Frontend folder not found at: ' + frontendPath });
    }
  });
});

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📁 Frontend served from: ${frontendPath}`);
  console.log(`☁️  File storage:         Cloudflare R2 (${process.env.R2_BUCKET_NAME})`);
});
