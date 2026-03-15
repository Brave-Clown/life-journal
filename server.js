const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 49182;
const DATA_DIR = path.join(__dirname, 'data', 'entries');

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating data directory:', error);
  }
}

// Sanitize storage keys to prevent path traversal
function sanitizeKey(key) {
  // Only allow alphanumeric, hyphens, colons, and underscores
  const sanitized = key.replace(/[^a-zA-Z0-9\-_:]/g, '');
  if (sanitized !== key) {
    return null; // Key contained invalid characters
  }
  // Extra safety: resolve and verify the path stays within DATA_DIR
  const resolved = path.resolve(DATA_DIR, `${sanitized}.json`);
  if (!resolved.startsWith(DATA_DIR)) {
    return null;
  }
  return sanitized;
}

// Storage API endpoints
app.get('/api/storage/list', async (req, res) => {
  try {
    const { prefix } = req.query;
    const files = await fs.readdir(DATA_DIR);
    
    let keys = files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
    
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

app.get('/api/storage/get/:key', async (req, res) => {
  try {
    const key = sanitizeKey(req.params.key);
    if (!key) {
      return res.status(400).json({ error: 'Invalid key' });
    }
    
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

app.post('/api/storage/set', async (req, res) => {
  try {
    const { key: rawKey, value } = req.body;
    
    if (!rawKey || value === undefined) {
      return res.status(400).json({ error: 'Key and value are required' });
    }
    
    const key = sanitizeKey(rawKey);
    if (!key) {
      return res.status(400).json({ error: 'Invalid key' });
    }
    
    const filePath = path.join(DATA_DIR, `${key}.json`);
    await fs.writeFile(filePath, value, 'utf8');
    
    res.json({ key, value });
  } catch (error) {
    console.error('Error writing file:', error);
    res.status(500).json({ error: 'Failed to save entry' });
  }
});

app.delete('/api/storage/delete/:key', async (req, res) => {
  try {
    const key = sanitizeKey(req.params.key);
    if (!key) {
      return res.status(400).json({ error: 'Invalid key' });
    }
    
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Start server
ensureDataDir().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Life Journal running on port ${PORT}`);
    console.log(`Access at: http://localhost:${PORT}`);
  });
});
