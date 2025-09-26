const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { put, head } = require('@vercel/blob');

const app = express();

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
const sanitizeText = (text) =>
  typeof text === 'string' ? text.replace(/<[^>]*>/g, '').trim() : '';

const generateId = () =>
  `${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 5)}`;

const validateStudentNumber = (sn) => /^[a-zA-Z0-9]{3,20}$/.test(sn);

const sanitizeSiteName = (site) =>
  typeof site === 'string' ? site.replace(/[^a-zA-Z0-9.\-_]/g, '').trim() : '';

// In-memory cache to track blob URLs
const blobUrlCache = new Map();

const getBlobPath = (studentNumber, site) =>
  `comments/${studentNumber}_${sanitizeSiteName(site)}.json`;

const getBlobUrl = (studentNumber, site) => {
  const key = `${studentNumber}_${site}`;
  return blobUrlCache.get(key);
};

const setBlobUrl = (studentNumber, site, url) => {
  const key = `${studentNumber}_${site}`;
  blobUrlCache.set(key, url);
};

const readCommentsFromBlob = async (studentNumber, site) => {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    
    if (!token) {
      throw new Error('BLOB_READ_WRITE_TOKEN environment variable is not set');
    }

    // Try to get cached URL first
    let blobUrl = getBlobUrl(studentNumber, site);
    
    // If no cached URL, try to fetch using head
    if (!blobUrl) {
      const blobPath = getBlobPath(studentNumber, site);
      try {
        const blob = await head(blobPath, { token });
        blobUrl = blob.url;
        setBlobUrl(studentNumber, site, blobUrl);
      } catch (error) {
        // Blob doesn't exist yet
        return [];
      }
    }

    // Fetch the blob content
    const response = await fetch(blobUrl);
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('Error reading from blob:', error);
    return [];
  }
};

const writeCommentsToBlob = async (studentNumber, site, comments) => {
  const blobPath = getBlobPath(studentNumber, site);
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  
  if (!token) {
    throw new Error('BLOB_READ_WRITE_TOKEN environment variable is not set');
  }
  
  const blob = await put(blobPath, JSON.stringify(comments, null, 2), {
    access: 'public',
    contentType: 'application/json',
    token,
    addRandomSuffix: false, // Keep the same filename
  });
  
  // Cache the URL for future reads
  setBlobUrl(studentNumber, site, blob.url);
};

// Logging middleware
app.use((req, res, next) => {
  console.log(
    `${new Date().toISOString()} ${req.method} ${req.path} - Student: ${
      req.headers['x-student-number'] || 'none'
    }`
  );
  next();
});

// Routes
app.get('/api/comments', async (req, res) => {
  try {
    const studentNumber = req.headers['x-student-number'];
    const { site } = req.query;

    if (!studentNumber)
      return res.status(400).json({ error: 'Missing X-Student-Number header' });
    if (!validateStudentNumber(studentNumber))
      return res.status(401).json({ error: 'Invalid student number format' });
    if (!site) return res.status(400).json({ error: 'Missing site parameter' });

    const sanitizedSite = sanitizeSiteName(site);
    if (!sanitizedSite)
      return res.status(400).json({ error: 'Invalid site parameter' });

    const comments = await readCommentsFromBlob(studentNumber, sanitizedSite);
    res.json(comments);
  } catch (error) {
    console.error('Error getting comments:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/comments', async (req, res) => {
  try {
    const studentNumber = req.headers['x-student-number'];
    const { site, text, sender } = req.body;

    if (!studentNumber)
      return res.status(400).json({ error: 'Missing X-Student-Number header' });
    if (!validateStudentNumber(studentNumber))
      return res.status(401).json({ error: 'Invalid student number format' });
    if (!site || !text)
      return res.status(400).json({ error: 'Missing required fields: site and text' });

    const sanitizedSite = sanitizeSiteName(site);
    const sanitizedText = sanitizeText(text);
    const sanitizeSender = sanitizeText(sender);

    if (!sanitizedSite)
      return res.status(400).json({ error: 'Invalid site parameter' });
    if (sanitizedText.length === 0)
      return res.status(400).json({ error: 'Text cannot be empty after sanitization' });
    if (sanitizedText.length > 280)
      return res.status(400).json({ error: 'Text exceeds maximum length of 280 characters' });

    const comment = {
      id: generateId(),
      site: sanitizedSite,
      sender: sanitizeSender,
      text: sanitizedText,
      ts: new Date().toISOString(),
    };

    const comments = await readCommentsFromBlob(studentNumber, sanitizedSite);
    comments.push(comment);
    await writeCommentsToBlob(studentNumber, sanitizedSite, comments);

    console.log(`Comment added for student ${studentNumber} on site ${sanitizedSite}`);
    res.status(201).json(comment);
  } catch (error) {
    console.error('Error posting comment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/comments/:commentId', async (req, res) => {
  try {
    const studentNumber = req.headers['x-student-number'];
    const { site } = req.query;
    const { commentId } = req.params;

    if (!studentNumber || !validateStudentNumber(studentNumber))
      return res.status(401).json({ error: 'Invalid or missing student number' });
    if (!site) return res.status(400).json({ error: 'Missing site parameter' });

    const sanitizedSite = sanitizeSiteName(site);
    if (!sanitizedSite)
      return res.status(400).json({ error: 'Invalid site parameter' });

    let comments = await readCommentsFromBlob(studentNumber, sanitizedSite);
    const initialLength = comments.length;
    comments = comments.filter((comment) => comment.id !== commentId);

    if (comments.length === initialLength)
      return res.status(404).json({ error: 'Comment not found' });

    await writeCommentsToBlob(studentNumber, sanitizedSite, comments);
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

// Export app for Vercel
module.exports = app;