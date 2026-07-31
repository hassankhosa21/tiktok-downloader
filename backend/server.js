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
// DOWNLOAD API (Using musicallydown.com)
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

    // ========================================
    // API: musicallydown.com
    // ========================================
    try {
      console.log('🔄 Trying musicallydown.com...');
      
      // First, get the initial page to get the token
      const response = await axios.get('https://musicallydown.com/', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5'
        },
        timeout: 15000
      });

      // Extract the token from the page
      const html = response.data;
      const tokenMatch = html.match(/name="_token"\s+value="([^"]+)"/);
      const token = tokenMatch ? tokenMatch[1] : '';

      if (!token) {
        console.log('❌ Could not extract token from musicallydown.com');
        throw new Error('Token extraction failed');
      }

      console.log('✅ Token extracted successfully');

      // Now make the POST request to download
      const downloadResponse = await axios.post(
        'https://musicallydown.com/download',
        new URLSearchParams({
          _token: token,
          url: url,
          submit: ''
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Referer': 'https://musicallydown.com/',
            'Origin': 'https://musicallydown.com'
          },
          timeout: 25000
        }
      );

      const resultHtml = downloadResponse.data;
      
      // Extract video URL from the response HTML
      // Try multiple patterns
      let videoUrl = null;
      let author = 'Unknown';
      let title = 'TikTok Video';

      // Pattern 1: video tag src attribute
      const videoSrcMatch = resultHtml.match(/<video[^>]+src="([^"]+\.mp4[^"]*)"[^>]*>/i);
      if (videoSrcMatch) {
        videoUrl = videoSrcMatch[1];
      }

      // Pattern 2: a tag with download link
      if (!videoUrl) {
        const downloadLinkMatch = resultHtml.match(/<a[^>]+href="([^"]+\.mp4[^"]*)"[^>]*>Download/i);
        if (downloadLinkMatch) {
          videoUrl = downloadLinkMatch[1];
        }
      }

      // Pattern 3: any mp4 URL
      if (!videoUrl) {
        const mp4Match = resultHtml.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"']*/i);
        if (mp4Match) {
          videoUrl = mp4Match[0];
        }
      }

      // Extract author and title
      const authorMatch = resultHtml.match(/<div[^>]*class="[^"]*username[^"]*"[^>]*>([^<]+)<\/div>/i);
      if (authorMatch) author = authorMatch[1].trim();

      const titleMatch = resultHtml.match(/<div[^>]*class="[^"]*caption[^"]*"[^>]*>([^<]+)<\/div>/i);
      if (titleMatch) title = titleMatch[1].trim();

      if (videoUrl) {
        console.log('✅ musicallydown.com success!');
        return res.json({
          success: true,
          video: {
            id: Date.now().toString(),
            caption: title || 'TikTok Video',
            author: author || 'Unknown Creator',
            hdUrl: videoUrl,
            sdUrl: videoUrl,
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
      }

      console.log('❌ musicallydown.com returned no video URL');

    } catch (error) {
      console.log('❌ musicallydown.com failed:', error.message);
    }

    // ========================================
    // FALLBACK: Return Original URL
    // ========================================
    console.log('❌ All APIs failed. Returning original URL.');
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