// frontend/script.js
const API_BASE_URL = 'http://localhost:5001';

// ======================================================
// PAGE ELEMENTS
// ======================================================
const authPage = document.getElementById('authPage');
const dashboardPage = document.getElementById('dashboardPage');

// Auth Form Elements
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const registerEmail = document.getElementById('registerEmail');
const registerPassword = document.getElementById('registerPassword');
const loginSubmitBtn = document.getElementById('loginSubmitBtn');
const registerSubmitBtn = document.getElementById('registerSubmitBtn');
const switchToRegister = document.getElementById('switchToRegister');
const switchToLogin = document.getElementById('switchToLogin');
const loginError = document.getElementById('loginError');
const registerError = document.getElementById('registerError');

// Dashboard Elements
const welcomeEmail = document.getElementById('welcomeEmail');
const userEmailDisplay = document.getElementById('userEmailDisplay');
const logoutBtn = document.getElementById('logoutBtn');

// Downloader Elements
const videoUrlInput = document.getElementById('videoUrl');
const downloadBtn = document.getElementById('downloadBtn');
const loading = document.getElementById('loading');
const result = document.getElementById('result');
const errorDiv = document.getElementById('error');
const errorText = document.getElementById('errorText');
const videoPreview = document.getElementById('videoPreview');
const videoCaption = document.getElementById('videoCaption');
const videoAuthor = document.getElementById('videoAuthor');
const videoDuration = document.getElementById('videoDuration');
const viewsCount = document.getElementById('viewsCount');
const uploadDate = document.getElementById('uploadDate');
const qualitySelect = document.getElementById('qualitySelect');
const downloadLink = document.getElementById('downloadLink');

let currentVideoData = null;

// ======================================================
// AUTH FUNCTIONS
// ======================================================

async function checkAuth() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/me`, { credentials: 'include' });
        const data = await response.json();
        if (data.loggedIn) {
            showLoggedInUI(data.user);
        } else {
            showLoggedOutUI();
        }
    } catch (error) {
        showLoggedOutUI();
    }
}

function showLoggedInUI(user) {
    authPage.classList.add('hidden');
    dashboardPage.classList.remove('hidden');
    welcomeEmail.textContent = user.email;
    userEmailDisplay.textContent = user.email;
}

function showLoggedOutUI() {
    authPage.classList.remove('hidden');
    dashboardPage.classList.add('hidden');
    // Reset forms
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    loginError.classList.add('hidden');
    registerError.classList.add('hidden');
    // Reset downloader UI
    result.classList.add('hidden');
    errorDiv.classList.add('hidden');
    videoPreview.src = '';
}

function showAuthError(element, message) {
    element.textContent = message;
    element.classList.remove('hidden');
    setTimeout(() => element.classList.add('hidden'), 5000);
}

// REGISTER
registerSubmitBtn.addEventListener('click', async () => {
    const email = registerEmail.value.trim();
    const password = registerPassword.value.trim();

    if (!email || !password) {
        showAuthError(registerError, 'Please fill all fields');
        return;
    }
    if (!email.includes('@')) {
        showAuthError(registerError, 'Please enter a valid email address');
        return;
    }
    if (password.length < 6) {
        showAuthError(registerError, 'Password must be at least 6 characters');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
            credentials: 'include'
        });
        const data = await response.json();

        if (data.success) {
            showLoggedInUI(data.user);
        } else {
            showAuthError(registerError, data.error || 'Registration failed');
        }
    } catch (error) {
        showAuthError(registerError, 'Network error. Is the server running?');
    }
});

// LOGIN
loginSubmitBtn.addEventListener('click', async () => {
    const email = loginEmail.value.trim();
    const password = loginPassword.value.trim();

    if (!email || !password) {
        showAuthError(loginError, 'Please fill all fields');
        return;
    }
    if (!email.includes('@')) {
        showAuthError(loginError, 'Please enter a valid email address');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
            credentials: 'include'
        });
        const data = await response.json();

        if (data.success) {
            showLoggedInUI(data.user);
        } else {
            showAuthError(loginError, data.error || 'Invalid email or password');
        }
    } catch (error) {
        showAuthError(loginError, 'Network error. Is the server running?');
    }
});

// LOGOUT
logoutBtn.addEventListener('click', async () => {
    try {
        await fetch(`${API_BASE_URL}/api/auth/logout`, {
            method: 'POST',
            credentials: 'include'
        });
        showLoggedOutUI();
        result.classList.add('hidden');
        errorDiv.classList.add('hidden');
        videoPreview.src = '';
    } catch (error) {
        alert('Logout failed. Please try again.');
    }
});

// Switch between Login/Register
switchToRegister.addEventListener('click', () => {
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
    loginError.classList.add('hidden');
    registerError.classList.add('hidden');
});
switchToLogin.addEventListener('click', () => {
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    loginError.classList.add('hidden');
    registerError.classList.add('hidden');
});

// Enter key support
loginPassword.addEventListener('keypress', (e) => { if (e.key === 'Enter') loginSubmitBtn.click(); });
registerPassword.addEventListener('keypress', (e) => { if (e.key === 'Enter') registerSubmitBtn.click(); });

// ======================================================
// DOWNLOADER FUNCTIONS
// ======================================================

downloadBtn.addEventListener('click', handleDownload);
videoUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleDownload();
});
qualitySelect.addEventListener('change', updateDownloadLink);

async function handleDownload() {
    const url = videoUrlInput.value.trim();

    if (!url) {
        showError('Please paste a TikTok video URL');
        return;
    }
    if (!url.includes('tiktok.com')) {
        showError('Please enter a valid TikTok URL');
        return;
    }

    hideAllResults();
    showLoading(true);
    downloadBtn.disabled = true;

    try {
        const response = await fetch(`${API_BASE_URL}/api/download?url=${encodeURIComponent(url)}`, {
            credentials: 'include'
        });
        const data = await response.json();

        if (!response.ok) {
            if (response.status === 401) {
                showError('Session expired. Please login again.');
                showLoggedOutUI();
                return;
            }
            throw new Error(data.error || 'Failed to download');
        }
        if (!data.success) {
            throw new Error(data.error || 'Something went wrong');
        }

        currentVideoData = data.video;
        displayVideo(currentVideoData);

    } catch (error) {
        showError(error.message || 'Network error. Is the server running?');
    } finally {
        showLoading(false);
        downloadBtn.disabled = false;
    }
}

function displayVideo(video) {
    videoPreview.src = video.hdUrl || video.sdUrl;
    videoPreview.load();

    videoCaption.textContent = video.caption || 'No Title';
    videoAuthor.textContent = video.author || 'Unknown';
    videoDuration.textContent = video.duration || '0:00';
    viewsCount.textContent = formatNumber(video.stats.views);
    uploadDate.textContent = video.uploadDate || 'Unknown';

    updateDownloadLink();
    result.classList.remove('hidden');
    result.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function updateDownloadLink() {
    if (!currentVideoData) return;
    
    const quality = qualitySelect.value;
    let url = quality === 'hd' ? currentVideoData.hdUrl : currentVideoData.sdUrl;
    
    if (!url) {
        url = currentVideoData.hdUrl || currentVideoData.sdUrl;
        qualitySelect.value = 'hd';
    }

    downloadLink.href = url;
    downloadLink.download = `tiktok_${currentVideoData.id || 'video'}.mp4`;
}

function showLoading(show) {
    loading.classList.toggle('hidden', !show);
}

function showError(message) {
    errorText.textContent = message;
    errorDiv.classList.remove('hidden');
    setTimeout(() => errorDiv.classList.add('hidden'), 6000);
}

function hideAllResults() {
    result.classList.add('hidden');
    errorDiv.classList.add('hidden');
    videoPreview.src = '';
    currentVideoData = null;
}

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

// ======================================================
// SIDEBAR NAVIGATION
// ======================================================
const navLinks = document.querySelectorAll('.sidebar nav ul li');
navLinks.forEach(link => {
    link.addEventListener('click', function(e) {
        navLinks.forEach(l => l.classList.remove('active'));
        this.classList.add('active');
        const targetId = this.querySelector('a').getAttribute('href');
        if (targetId && targetId.startsWith('#')) {
            e.preventDefault();
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    });
});

// ======================================================
// INIT
// ======================================================
checkAuth();
videoUrlInput.focus();