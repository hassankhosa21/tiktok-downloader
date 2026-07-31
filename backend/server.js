require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('node:path');
const { initializeDatabase, createUser, verifyUser } = require('./database');

const app = express();
const PORT = process.env.PORT || 5000;

// Railway sits in front of your app behind a proxy that terminates HTTPS.
// Without this, secure cookies won't be set/read correctly in production.
app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// ✅ MongoDB session store (properly imported)
const mongoUrl = process.env.MONGODB_URI;
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ 
    mongoUrl: mongoUrl,
    collectionName: 'sessions',
    ttl: 24 * 60 * 60 // 1 day
  }),
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

// Check if user is logged in
app.get('/api/auth/me', (req, res) => {
  if (req.session.user) {
    return res.json({ loggedIn: true, user: req.session.user });
  }
  res.json({ loggedIn: false });
});

// Register
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

// Login
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

// Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Logout failed' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================
function isAuthenticated(req, res, next) {
  if (req.session?.user) {
    return next();
  }
  res.status(401).json({ success: false, error: 'Unauthorized' });
}

// ============================================
// DOWNLOAD API (Primary: Omkar Cloud)
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

    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'API key missing' });
    }

    // Try Omkar Cloud API first
    const response = await axios.get('https://tiktok-scraper.omkar.cloud/tiktok/videos/details', {
      params: { video_url: url },
      headers: { 'API-Key': apiKey },
      timeout: 15000
    });

    const data = response?.data;
    if (!data?.media) {
      return res.status(404).json({ success: false, error: 'Video not found' });
    }

    // Format response
    const uploadDate = new Date((data.create_time || Date.now()) * 1000);
    const formattedDate = `${uploadDate.getFullYear()}${String(uploadDate.getMonth() + 1).padStart(2, '0')}${String(uploadDate.getDate()).padStart(2, '0')}`;
    const dur = data.duration_seconds || 0;
    const duration = `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}`;

    res.json({
      success: true,
      video: {
        id: data.video_id || '',
        caption: data.caption || 'No caption',
        author: data.author?.handle || 'Unknown',
        hdUrl: data.media?.hd_video_url || data.media?.video_url || '',
        sdUrl: data.media?.video_url || data.media?.hd_video_url || '',
        duration,
        uploadDate: formattedDate,
        stats: {
          views: data.stats?.views || 0,
          likes: data.stats?.likes || 0,
          comments: data.stats?.comments || 0,
          shares: data.stats?.shares || 0
        }
      }
    });

  } catch (error) {
    console.error('Download error (Omkar API):', error.message);
    
    // If Omkar Cloud fails, try fallback API (TikWM)
    try {
      console.log('🔄 Trying fallback API (TikWM)...');
      const fallbackResponse = await axios.get('https://api.tikwm.com/video/', {
        params: { 
          url: req.query.url,
          hd: 1,
          web: 1
        },
        timeout: 15000
      });

      const fallbackData = fallbackResponse?.data?.data;
      if (!fallbackData) {
        throw new Error('No data from fallback API');
      }

      const dur2 = fallbackData.duration || 0;
      const duration2 = `${Math.floor(dur2 / 60)}:${String(dur2 % 60).padStart(2, '0')}`;

      res.json({
        success: true,
        video: {
          id: fallbackData.video_id || '',
          caption: fallbackData.title || 'No caption',
          author: fallbackData.author?.unique_id || 'Unknown',
          hdUrl: fallbackData.hd_video_url || fallbackData.video_url || '',
          sdUrl: fallbackData.video_url || fallbackData.hd_video_url || '',
          duration: duration2,
          uploadDate: fallbackData.create_time || 'Unknown',
          stats: {
            views: fallbackData.views || 0,
            likes: fallbackData.digg_count || 0,
            comments: fallbackData.comment_count || 0,
            shares: fallbackData.share_count || 0
          }
        }
      });

    } catch (fallbackError) {
      console.error('Fallback API also failed:', fallbackError.message);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to download video. Please try again.' 
      });
    }
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