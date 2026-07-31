require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const session = require('express-session');
const path = require('node:path');
const { initializeDatabase, createUser, verifyUser } = require('./database');

const app = express();
const PORT = process.env.PORT || 5000;

// Railway sits in front of your app behind a proxy that terminates HTTPS.
app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// Simple memory store (works fine for free tier)
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', 
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 
  }
}));

// Initialize database
(async () => { 
  try {
    await initializeDatabase();
    console.log('✅ Database initialized');
  } catch (err) {
    console.error('❌ Database initialization failed:', err.message);
  }
})();

// ============================================
// AUTH ROUTES
// ============================================

app.get('/api/auth/me', (req, res) => {
  if (req.session.user) {
    return res.json({ loggedIn: true, user: req.session.user });
  }
  res.json({ loggedIn: false });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }
    if (!email.includes('@')) {
      return res.status(400).json({ success: false, error: 'Invalid email' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }
    const user = await createUser(email, password);
    req.session.user = user;
    res.json({ success: true, user });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }
    const user = await verifyUser(email, password);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    req.session.user = user;
    res.json({ success: true, user });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Logout failed' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

function isAuthenticated(req, res, next) {
  if (req.session?.user) {
    return next();
  }
  res.status(401).json({ success: false, error: 'Unauthorized' });
}

// ============================================
// DOWNLOAD API (TikWM Only – No API Key Needed)
// ============================================
app.get('/api/download', isAuthenticated, async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL required' });
    }
    if (!url.includes('tiktok.com')) {
      return res.status(400).json({ success: false, error: 'Invalid TikTok URL' });
    }

    console.log('📥 Downloading:', url);
    const response = await axios.get('https://api.tikwm.com/video/', {
      params: { 
        url: url,
        hd: 1,
        web: 1
      },
      timeout: 20000
    });

    const data = response?.data?.data;
    if (!data) {
      return res.status(404).json({ success: false, error: 'Video not found' });
    }

    const dur = data.duration || 0;
    const duration = `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}`;

    res.json({
      success: true,
      video: {
        id: data.video_id || '',
        caption: data.title || 'No caption',
        author: data.author?.unique_id || 'Unknown',
        hdUrl: data.hd_video_url || data.video_url || '',
        sdUrl: data.video_url || data.hd_video_url || '',
        duration: duration,
        uploadDate: data.create_time || 'Unknown',
        stats: {
          views: data.views || 0,
          likes: data.digg_count || 0,
          comments: data.comment_count || 0,
          shares: data.share_count || 0
        }
      }
    });

  } catch (error) {
    console.error('Download error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to download video. Please try again.' 
    });
  }
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Hassan Labs TikTok Downloader is running!',
    environment: process.env.NODE_ENV || 'development'
  });
});

// ============================================
// CATCH-ALL ROUTE (SPA Support)
// ============================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📱 Open: http://localhost:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});