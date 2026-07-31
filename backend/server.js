require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const session = require('express-session');
const path = require('node:path');
const { initializeDatabase, createUser, verifyUser } = require('./database');

const app = express();
const PORT = process.env.PORT || 5000;

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

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
// DOWNLOAD API (Omkar Cloud API - Working)
// ============================================
app.get('/api/download', isAuthenticated, async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL required' });
    }
    if (!url.includes('tiktok.com') && !url.includes('vm.tiktok.com')) {
      return res.status(400).json({ success: false, error: 'Invalid TikTok URL' });
    }

    console.log('📥 Downloading:', url);

    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      console.log('❌ API_KEY not found in environment variables');
      return res.status(500).json({ 
        success: false, 
        error: 'API key missing. Please set API_KEY in environment variables.' 
      });
    }

    // Use Omkar Cloud API (works on Railway)
    try {
      console.log('🔄 Trying Omkar Cloud API...');
      const response = await axios.get('https://tiktok-scraper.omkar.cloud/tiktok/videos/details', {
        params: { video_url: url },
        headers: { 'API-Key': apiKey },
        timeout: 20000
      });

      const data = response?.data;
      if (data && data.media) {
        const videoUrl = data.media?.hd_video_url || data.media?.video_url || data.media?.play_url || '';
        if (videoUrl) {
          console.log('✅ Omkar Cloud success!');
          const dur = data.duration_seconds || 0;
          const duration = `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}`;
          const uploadDate = new Date((data.create_time || Date.now()) * 1000);
          const formattedDate = `${uploadDate.getFullYear()}${String(uploadDate.getMonth() + 1).padStart(2, '0')}${String(uploadDate.getDate()).padStart(2, '0')}`;
          
          return res.json({
            success: true,
            video: {
              id: data.video_id || Date.now().toString(),
              caption: data.caption || data.title || 'No caption',
              author: data.author?.handle || data.author?.unique_id || 'Unknown',
              hdUrl: data.media?.hd_video_url || videoUrl,
              sdUrl: data.media?.video_url || videoUrl,
              duration: duration,
              uploadDate: formattedDate,
              stats: {
                views: data.stats?.views || data.views || 0,
                likes: data.stats?.likes || data.digg_count || 0,
                comments: data.stats?.comments || data.comment_count || 0,
                shares: data.stats?.shares || data.share_count || 0
              }
            }
          });
        }
      }
      console.log('❌ Omkar Cloud returned no video URL');
    } catch (error) {
      console.log('❌ Omkar Cloud failed:', error.message);
      if (error.response?.status === 401) {
        return res.status(401).json({ 
          success: false, 
          error: 'Invalid API key. Please check your API_KEY environment variable.' 
        });
      }
      if (error.response?.status === 429) {
        return res.status(429).json({ 
          success: false, 
          error: 'API rate limit exceeded. Please try again later.' 
        });
      }
    }

    // ========================================
    // FALLBACK: Return original URL if all APIs fail
    // ========================================
    console.log('❌ All APIs failed. Returning fallback.');
    return res.json({
      success: true,
      video: {
        id: Date.now().toString(),
        caption: 'Click the link below to watch the video on TikTok',
        author: 'TikTok Video',
        hdUrl: url,
        sdUrl: url,
        duration: '0:00',
        uploadDate: new Date().toISOString().split('T')[0].replace(/-/g, ''),
        stats: {
          views: 0,
          likes: 0,
          comments: 0,
          shares: 0
        }
      }
    });

  } catch (error) {
    console.error('Download error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Something went wrong. Please try again.'
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
// CATCH-ALL ROUTE
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