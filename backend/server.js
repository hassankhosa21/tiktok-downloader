// backend/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const session = require('express-session');
const path = require('node:path');
const { initializeDatabase, createUser, verifyUser, getUserByEmail } = require('./database');

const app = express();
const PORT = process.env.PORT || 5000;

// Hide Express version
app.disable('x-powered-by');

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors({ 
    origin: process.env.NODE_ENV === 'production' 
        ? 'https://tiktok-downloader-production-8c99.up.railway.app' 
        : 'http://localhost:5000', 
    credentials: true 
}));
app.use(express.json());

// ✅ SERVE FRONTEND STATIC FILES (FIXED)
app.use(express.static(path.join(__dirname, 'frontend')));

// ============================================
// SESSION CONFIGURATION
// ============================================
app.use(session({
    secret: process.env.SESSION_SECRET || 'hassan_labs_super_secret_key_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 // 1 day
    }
}));

// ============================================
// DATABASE INITIALIZATION
// ============================================
(async () => {
    try {
        await initializeDatabase();
        console.log('✅ Database connected successfully');
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        process.exit(1);
    }
})();

// ============================================
// AUTH ROUTES
// ============================================

// Check if user is logged in
app.get('/api/auth/me', (req, res) => {
    if (req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

// Register Route
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password required' });
        }
        if (!email.includes('@')) {
            return res.status(400).json({ success: false, error: 'Invalid email address' });
        }
        if (password.length < 6) {
            return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
        }

        const user = await createUser(email, password);
        req.session.user = user;
        res.json({ success: true, user });
    } catch (error) {
        console.error('Register error:', error.message);
        res.status(400).json({ success: false, error: error.message });
    }
});

// Login Route
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password required' });
        }
        
        const user = await verifyUser(email, password);
        
        if (!user) {
            return res.status(401).json({ success: false, error: 'Invalid email or password' });
        }

        req.session.user = user;
        res.json({ success: true, user });
    } catch (error) {
        console.error('Login error:', error.message);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Logout Route
app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ success: false, error: 'Logout failed' });
        }
        res.clearCookie('connect.sid');
        res.json({ success: true, message: 'Logged out successfully' });
    });
});

// ============================================
// PROTECTED DOWNLOAD API
// ============================================

function isAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    res.status(401).json({ success: false, error: 'Please login first' });
}

app.get('/api/download', isAuthenticated, async (req, res) => {
    try {
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({ success: false, error: 'Please provide a TikTok URL' });
        }
        if (!url.includes('tiktok.com')) {
            return res.status(400).json({ success: false, error: 'Invalid TikTok URL' });
        }

        const apiKey = process.env.API_KEY;
        if (!apiKey || apiKey === 'your_api_key_here') {
            return res.status(500).json({ success: false, error: 'API key missing.' });
        }

        const response = await axios.get(
            'https://tiktok-scraper.omkar.cloud/tiktok/videos/details',
            {
                params: { video_url: url },
                headers: { 'API-Key': apiKey },
                timeout: 15000
            }
        );

        const data = response?.data;
        if (!data?.media) {
            return res.status(404).json({ success: false, error: 'Video not found or private' });
        }

        const uploadTimestamp = data?.create_time || Date.now() / 1000;
        const uploadDate = new Date(uploadTimestamp * 1000);
        const formattedDate = 
            uploadDate.getFullYear() +
            String(uploadDate.getMonth() + 1).padStart(2, '0') +
            String(uploadDate.getDate()).padStart(2, '0');

        const durationSec = data?.duration_seconds || 0;
        const minutes = Math.floor(durationSec / 60);
        const seconds = durationSec % 60;
        const formattedDuration = `${minutes}:${String(seconds).padStart(2, '0')}`;

        res.json({
            success: true,
            video: {
                id: data?.video_id || '',
                caption: data?.caption || 'No caption',
                author: data?.author?.handle || 'Unknown',
                hdUrl: data?.media?.hd_video_url || data?.media?.video_url || '',
                sdUrl: data?.media?.video_url || data?.media?.hd_video_url || '',
                thumbnail: data?.media?.thumbnail_url || '',
                duration: formattedDuration,
                uploadDate: formattedDate,
                stats: {
                    views: data?.stats?.views || 0,
                    likes: data?.stats?.likes || 0,
                    comments: data?.stats?.comments || 0,
                    shares: data?.stats?.shares || 0
                }
            }
        });

    } catch (error) {
        console.error('Download API Error:', error.message);
        
        if (error.code === 'ECONNABORTED') {
            return res.status(504).json({ success: false, error: 'Request timed out. Please try again.' });
        }
        if (error.response?.status === 401) {
            return res.status(401).json({ success: false, error: 'Invalid API Key.' });
        }
        if (error.response?.status === 429) {
            return res.status(429).json({ success: false, error: 'Rate limit exceeded. Try later.' });
        }

        res.status(500).json({ success: false, error: 'Failed to download video.' });
    }
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'TikTok Downloader is running!',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// ============================================
// ✅ CATCH-ALL ROUTE - SERVES INDEX.HTML (FIXES "Cannot GET /")
// ============================================
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`📱 Open this URL in your browser.`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});