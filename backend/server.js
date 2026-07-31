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
// DOWNLOAD API (4 APIs with Fallback)
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

    // =====================
    // API 1: Snaptik
    // =====================
    try {
      console.log('🔄 Trying Snaptik...');
      const response = await axios.get('https://snaptik.app/api/ajaxSearch', {
        params: { q: url, lang: 'en' },
        timeout: 20000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://snaptik.app/',
          'Origin': 'https://snaptik.app'
        }
      });

      const data = response?.data?.data;
      if (data && data.video_url) {
        console.log('✅ Snaptik success!');
        const dur = data.duration || 0;
        const duration = `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}`;
        return res.json({
          success: true,
          video: {
            id: data.video_id || Date.now().toString(),
            caption: data.title || 'No caption',
            author: data.author || 'Unknown',
            hdUrl: data.video_url || '',
            sdUrl: data.video_url || '',
            duration: duration,
            uploadDate: data.create_time || 'Unknown',
            stats: {
              views: data.views || 0,
              likes: data.likes || 0,
              comments: data.comments || 0,
              shares: data.shares || 0
            }
          }
        });
      }
    } catch (e) {
      console.log('❌ Snaptik failed:', e.message);
    }

    // =====================
    // API 2: TikWM
    // =====================
    try {
      console.log('🔄 Trying TikWM...');
      const response = await axios.get('https://www.tikwm.com/api/', {
        params: { url: url, hd: 1, web: 1 },
        timeout: 20000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://www.tikwm.com/',
          'Origin': 'https://www.tikwm.com'
        }
      });

      const data = response?.data?.data;
      if (data && (data.hd_video_url || data.video_url)) {
        console.log('✅ TikWM success!');
        const dur = data.duration || 0;
        const duration = `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}`;
        let uploadDate = data.create_time || 'Unknown';
        if (typeof uploadDate === 'number') {
          const date = new Date(uploadDate * 1000);
          uploadDate = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
        }
        return res.json({
          success: true,
          video: {
            id: data.video_id || Date.now().toString(),
            caption: data.title || 'No caption',
            author: data.author?.unique_id || data.author || 'Unknown',
            hdUrl: data.hd_video_url || data.video_url || '',
            sdUrl: data.video_url || data.hd_video_url || '',
            duration: duration,
            uploadDate: uploadDate,
            stats: {
              views: data.views || 0,
              likes: data.digg_count || 0,
              comments: data.comment_count || 0,
              shares: data.share_count || 0
            }
          }
        });
      }
    } catch (e) {
      console.log('❌ TikWM failed:', e.message);
    }

    // =====================
    // API 3: TikDownload
    // =====================
    try {
      console.log('🔄 Trying TikDownload...');
      const response = await axios.get('https://tikdownload.com/action.php', {
        params: { url: url, ajax: 1 },
        timeout: 20000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://tikdownload.com/'
        }
      });

      const data = response?.data;
      if (data && data.video_url) {
        console.log('✅ TikDownload success!');
        return res.json({
          success: true,
          video: {
            id: Date.now().toString(),
            caption: data.title || 'No caption',
            author: data.author || 'Unknown',
            hdUrl: data.video_url || '',
            sdUrl: data.video_url || '',
            duration: data.duration || '0:00',
            uploadDate: data.date || 'Unknown',
            stats: {
              views: data.views || 0,
              likes: data.likes || 0,
              comments: data.comments || 0,
              shares: data.shares || 0
            }
          }
        });
      }
    } catch (e) {
      console.log('❌ TikDownload failed:', e.message);
    }

    // =====================
    // API 4: ssstiktok (Backup)
    // =====================
    try {
      console.log('🔄 Trying ssstiktok...');
      const response = await axios.get('https://ssstiktok.io/api/v1/download', {
        params: { url: url },
        timeout: 20000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://ssstiktok.io/',
          'Origin': 'https://ssstiktok.io'
        }
      });

      const data = response?.data;
      if (data && data.video_url) {
        console.log('✅ ssstiktok success!');
        return res.json({
          success: true,
          video: {
            id: Date.now().toString(),
            caption: data.title || 'No caption',
            author: data.author || 'Unknown',
            hdUrl: data.video_url || '',
            sdUrl: data.video_url || '',
            duration: data.duration || '0:00',
            uploadDate: data.date || 'Unknown',
            stats: {
              views: data.views || 0,
              likes: data.likes || 0,
              comments: data.comments || 0,
              shares: data.shares || 0
            }
          }
        });
      }
    } catch (e) {
      console.log('❌ ssstiktok failed:', e.message);
    }

    // =====================
    // If all APIs fail
    // =====================
    console.log('❌ All APIs failed for URL:', url);
    return res.status(500).json({
      success: false,
      error: 'Unable to download this video. Please try a different URL.'
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