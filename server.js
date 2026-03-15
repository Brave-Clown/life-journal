const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 49182;
const DATA_DIR = path.join(__dirname, 'data', 'entries');
const AUTH_FILE = path.join(__dirname, 'data', 'auth.json');

// Optional env override (takes precedence if set)
const ENV_PASSWORD = process.env.JOURNAL_PASSWORD || '';

// Active sessions: Map<token, expiry>
const sessions = new Map();
const SESSION_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days

// Login rate limiting: Map<ip, { attempts, blockedUntil }>
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const BLOCK_DURATION = 15 * 60 * 1000; // 15 minutes

// ─── Password hashing ───

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, storedHash, storedSalt) {
  const { hash } = hashPassword(password, storedSalt);
  const hashBuffer = Buffer.from(hash, 'hex');
  const storedBuffer = Buffer.from(storedHash, 'hex');
  return hashBuffer.length === storedBuffer.length &&
    crypto.timingSafeEqual(hashBuffer, storedBuffer);
}

// ─── Auth file management ───

async function getStoredAuth() {
  try {
    const data = await fs.readFile(AUTH_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveAuth(password) {
  const { hash, salt } = hashPassword(password);
  const auth = { hash, salt, createdAt: new Date().toISOString() };
  await fs.writeFile(AUTH_FILE, JSON.stringify(auth, null, 2), 'utf8');
  return auth;
}

async function isSetupComplete() {
  if (ENV_PASSWORD) return true;
  const auth = await getStoredAuth();
  return auth !== null;
}

async function checkPassword(password) {
  // Env password takes precedence
  if (ENV_PASSWORD) {
    const passBuffer = Buffer.from(password || '');
    const correctBuffer = Buffer.from(ENV_PASSWORD);
    return passBuffer.length === correctBuffer.length &&
      crypto.timingSafeEqual(passBuffer, correctBuffer);
  }

  const auth = await getStoredAuth();
  if (!auth) return false;
  return verifyPassword(password, auth.hash, auth.salt);
}

// ─── Middleware ───

app.use(express.json({ limit: '10mb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.tailwindcss.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data:; " +
    "connect-src 'self'"
  );
  next();
});

// ─── Authentication ───

function isAuthenticated(req) {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/journal_session=([a-f0-9]+)/);
  if (!match) return false;
  const token = match[1];
  const expiry = sessions.get(token);
  if (!expiry || Date.now() > expiry) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

// ─── Auth endpoints ───

// Check setup and auth status
app.get('/api/auth-status', async (req, res) => {
  const setupDone = await isSetupComplete();
  res.json({
    authenticated: isAuthenticated(req),
    setupComplete: setupDone
  });
});

// First-time setup: create password
app.post('/api/setup', async (req, res) => {
  // Block if already set up
  const setupDone = await isSetupComplete();
  if (setupDone) {
    return res.status(400).json({ error: 'Password already configured' });
  }

  const { password } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  await saveAuth(password);

  // Auto-login after setup
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_DURATION);
  res.setHeader('Set-Cookie',
    `journal_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DURATION / 1000}`
  );
  res.json({ success: true });
});

// Login
app.post('/api/login', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const record = loginAttempts.get(ip) || { attempts: 0, blockedUntil: 0 };

  if (record.blockedUntil > now) {
    const waitSec = Math.ceil((record.blockedUntil - now) / 1000);
    return res.status(429).json({ error: `Too many attempts. Try again in ${waitSec}s` });
  }

  const { password } = req.body;
  const isCorrect = await checkPassword(password);

  if (!isCorrect) {
    record.attempts++;
    if (record.attempts >= MAX_ATTEMPTS) {
      record.blockedUntil = now + BLOCK_DURATION;
      record.attempts = 0;
    }
    loginAttempts.set(ip, record);
    return res.status(401).json({ error: 'Incorrect password' });
  }

  loginAttempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, now + SESSION_DURATION);

  res.setHeader('Set-Cookie',
    `journal_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DURATION / 1000}`
  );
  res.json({ success: true });
});

// Change password (requires current session)
app.post('/api/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  const isCorrect = await checkPassword(currentPassword);
  if (!isCorrect) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  await saveAuth(newPassword);
  res.json({ success: true });
});

// Logout
app.post('/api/logout', (req, res) => {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/journal_session=([a-f0-9]+)/);
  if (match) sessions.delete(match[1]);
  res.setHeader('Set-Cookie', 'journal_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  res.json({ success: true });
});

// ─── Static files ───
app.use(express.static('public'));

// ─── Ensure data directory ───
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating data directory:', error);
  }
}

// ─── Key sanitization ───
function sanitizeKey(key) {
  const sanitized = key.replace(/[^a-zA-Z0-9\-_:]/g, '');
  if (sanitized !== key) return null;
  const resolved = path.resolve(DATA_DIR, `${sanitized}.json`);
  if (!resolved.startsWith(DATA_DIR)) return null;
  return sanitized;
}

// ─── Protected storage API ───

app.get('/api/storage/list', requireAuth, async (req, res) => {
  try {
    const { prefix } = req.query;
    const files = await fs.readdir(DATA_DIR);
    let keys = files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
    if (prefix) {
      const safePrefix = prefix.replace(/[^a-zA-Z0-9\-_:]/g, '');
      keys = keys.filter(k => k.startsWith(safePrefix));
    }
    res.json({ keys, prefix });
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.json({ keys: [], prefix: req.query.prefix });
    } else {
      console.error('Error listing files:', error);
      res.status(500).json({ error: 'Failed to list entries' });
    }
  }
});

app.get('/api/storage/get/:key', requireAuth, async (req, res) => {
  try {
    const key = sanitizeKey(req.params.key);
    if (!key) return res.status(400).json({ error: 'Invalid key' });
    const filePath = path.join(DATA_DIR, `${key}.json`);
    const data = await fs.readFile(filePath, 'utf8');
    res.json({ key, value: data });
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'Entry not found' });
    } else {
      console.error('Error reading file:', error);
      res.status(500).json({ error: 'Failed to read entry' });
    }
  }
});

app.post('/api/storage/set', requireAuth, async (req, res) => {
  try {
    const { key: rawKey, value } = req.body;
    if (!rawKey || value === undefined) {
      return res.status(400).json({ error: 'Key and value are required' });
    }
    const key = sanitizeKey(rawKey);
    if (!key) return res.status(400).json({ error: 'Invalid key' });
    const filePath = path.join(DATA_DIR, `${key}.json`);
    await fs.writeFile(filePath, value, 'utf8');
    res.json({ key, value });
  } catch (error) {
    console.error('Error writing file:', error);
    res.status(500).json({ error: 'Failed to save entry' });
  }
});

app.delete('/api/storage/delete/:key', requireAuth, async (req, res) => {
  try {
    const key = sanitizeKey(req.params.key);
    if (!key) return res.status(400).json({ error: 'Invalid key' });
    const filePath = path.join(DATA_DIR, `${key}.json`);
    await fs.unlink(filePath);
    res.json({ key, deleted: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'Entry not found' });
    } else {
      console.error('Error deleting file:', error);
      res.status(500).json({ error: 'Failed to delete entry' });
    }
  }
});

// ─── Health check (unauthenticated for Docker) ───
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// ─── Start ───
ensureDataDir().then(async () => {
  const setupDone = await isSetupComplete();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Life Journal running on port ${PORT}`);
    if (ENV_PASSWORD) {
      console.log('Auth: using JOURNAL_PASSWORD from environment');
    } else if (setupDone) {
      console.log('Auth: password configured');
    } else {
      console.log('Auth: FIRST RUN — password setup required');
    }
  });
});
