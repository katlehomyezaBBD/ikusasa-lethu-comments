const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = './data/comments';

// Middleware
app.use(cors());
app.use(express.json({ limit: '4kb' }));

// Rate limiting: 10 requests per minute per student number
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  keyGenerator: (req) => req.headers['x-student-number'] || req.ip,
  message: { error: 'Rate limit exceeded. Maximum 10 requests per minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', limiter);

// Utility functions
const sanitizeText = (text) => {
  if (typeof text !== 'string') return '';
  // Strip HTML tags and trim whitespace
  return text.replace(/<[^>]*>/g, '').trim();
};

const generateId = () => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `${timestamp}_${random}`;
};

const validateStudentNumber = (studentNumber) => {
  // Simple validation: alphanumeric, 3-20 characters
  return /^[a-zA-Z0-9]{3,20}$/.test(studentNumber);
};

const sanitizeSiteName = (site) => {
  if (typeof site !== 'string') return '';
  // Allow alphanumeric, dots, hyphens, underscores
  return site.replace(/[^a-zA-Z0-9.\-_]/g, '').trim();
};

const ensureDataDirectory = async () => {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    console.log(`Created data directory: ${DATA_DIR}`);
  }
};

const getCommentsFilePath = (studentNumber, site) => {
  const sanitizedSite = sanitizeSiteName(site);
  return path.join(DATA_DIR, `${studentNumber}_${sanitizedSite}.json`);
};

const readCommentsFile = async (filePath) => {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []; // File doesn't exist, return empty array
    }
    throw error;
  }
};

const writeCommentsFile = async (filePath, comments) => {
  await fs.writeFile(filePath, JSON.stringify(comments, null, 2), 'utf8');
};

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path} - Student: ${req.headers['x-student-number'] || 'none'}`);
  next();
});

// Routes
app.get('/api/comments', async (req, res) => {
  try {
    const studentNumber = req.headers['x-student-number'];
    const { site } = req.query;

    // Validation
    if (!studentNumber) {
      return res.status(400).json({ error: 'Missing X-Student-Number header' });
    }

    if (!validateStudentNumber(studentNumber)) {
      return res.status(401).json({ error: 'Invalid student number format' });
    }

    if (!site) {
      return res.status(400).json({ error: 'Missing site parameter' });
    }

    const sanitizedSite = sanitizeSiteName(site);
    if (!sanitizedSite) {
      return res.status(400).json({ error: 'Invalid site parameter' });
    }

    const filePath = getCommentsFilePath(studentNumber, sanitizedSite);
    const comments = await readCommentsFile(filePath);

    res.json(comments);
  } catch (error) {
    console.error('Error getting comments:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Post comment
app.post('/api/comments', async (req, res) => {
  try {
    const studentNumber = req.headers['x-student-number'];
    const { site, text, sender } = req.body;

    // Validation
    if (!studentNumber) {
      return res.status(400).json({ error: 'Missing X-Student-Number header' });
    }

    if (!validateStudentNumber(studentNumber)) {
      return res.status(401).json({ error: 'Invalid student number format' });
    }

    if (!site || !text) {
      return res.status(400).json({ error: 'Missing required fields: site and text' });
    }

    const sanitizedSite = sanitizeSiteName(site);
    const sanitizedText = sanitizeText(text);
    const sanitizeSender = sanitizeText(sender);;

    if (!sanitizedSite) {
      return res.status(400).json({ error: 'Invalid site parameter' });
    }

    if (sanitizedText.length === 0) {
      return res.status(400).json({ error: 'Text cannot be empty after sanitization' });
    }

    if (sanitizedText.length > 280) {
      return res.status(400).json({ error: 'Text exceeds maximum length of 280 characters' });
    }

    // Create comment object
    const comment = {
      id: generateId(),
      site: sanitizedSite,
      sender: sanitizeSender,
      text: sanitizedText,
      ts: new Date().toISOString()
    };

    // Read existing comments, append new one, and write back
    const filePath = getCommentsFilePath(studentNumber, sanitizedSite);
    const comments = await readCommentsFile(filePath);
    comments.push(comment);
    await writeCommentsFile(filePath, comments);

    console.log(`Comment added for student ${studentNumber} on site ${sanitizedSite}`);
    res.status(201).json(comment);
  } catch (error) {
    console.error('Error posting comment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Optional: DELETE endpoint for teacher-admin (nice-to-have)
app.delete('/api/comments/:commentId', async (req, res) => {
  try {
    const studentNumber = req.headers['x-student-number'];
    const { site } = req.query;
    const { commentId } = req.params;

    // Validation
    if (!studentNumber || !validateStudentNumber(studentNumber)) {
      return res.status(401).json({ error: 'Invalid or missing student number' });
    }

    if (!site) {
      return res.status(400).json({ error: 'Missing site parameter' });
    }

    const sanitizedSite = sanitizeSiteName(site);
    if (!sanitizedSite) {
      return res.status(400).json({ error: 'Invalid site parameter' });
    }

    const filePath = getCommentsFilePath(studentNumber, sanitizedSite);
    let comments = await readCommentsFile(filePath);
    
    const initialLength = comments.length;
    comments = comments.filter(comment => comment.id !== commentId);

    if (comments.length === initialLength) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    await writeCommentsFile(filePath, comments);
    console.log(`Comment ${commentId} deleted for student ${studentNumber} on site ${sanitizedSite}`);
    res.json({ message: 'Comment deleted successfully' });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Initialize and start server
const startServer = async () => {
  try {
    await ensureDataDirectory();
    app.listen(PORT, () => {
      console.log(`Comments API server running on port ${PORT}`);
      console.log(`Data directory: ${path.resolve(DATA_DIR)}`);
      console.log(`Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Shutting down gracefully...');
  process.exit(0);
});

startServer();