// Auto-detect API base URL
const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:5000'
  : '';

const authPage = document.getElementById('authPage');
const dashboardPage = document.getElementById('dashboardPage');
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
const welcomeEmail = document.getElementById('welcomeEmail');
const userEmailDisplay = document.getElementById('userEmailDisplay');
const logoutBtn = document.getElementById('logoutBtn');
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

async function checkAuth() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/me`, { credentials: 'include' });
    const data = await res.json();
    if (data.loggedIn) showLoggedInUI(data.user);
    else showLoggedOutUI();
  } catch { showLoggedOutUI(); }
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
  loginForm.classList.remove('hidden');
  registerForm.classList.add('hidden');
  loginError.classList.add('hidden');
  registerError.classList.add('hidden');
  result.classList.add('hidden');
  errorDiv.classList.add('hidden');
  videoPreview.src = '';
}

function showAuthError(el, msg) { el.textContent = msg; el.classList.remove('hidden'); setTimeout(() => el.classList.add('hidden'), 5000); }

registerSubmitBtn.addEventListener('click', async () => {
  const email = registerEmail.value.trim();
  const password = registerPassword.value.trim();
  if (!email || !password) return showAuthError(registerError, 'Fill all fields');
  if (!email.includes('@')) return showAuthError(registerError, 'Invalid email');
  if (password.length < 6) return showAuthError(registerError, 'Password too short');
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include'
    });
    const data = await res.json();
    if (data.success) showLoggedInUI(data.user);
    else showAuthError(registerError, data.error || 'Registration failed');
  } catch { showAuthError(registerError, 'Network error – is server running?'); }
});

loginSubmitBtn.addEventListener('click', async () => {
  const email = loginEmail.value.trim();
  const password = loginPassword.value.trim();
  if (!email || !password) return showAuthError(loginError, 'Fill all fields');
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include'
    });
    const data = await res.json();
    if (data.success) showLoggedInUI(data.user);
    else showAuthError(loginError, data.error || 'Invalid credentials');
  } catch { showAuthError(loginError, 'Network error – is server running?'); }
});

logoutBtn.addEventListener('click', async () => {
  await fetch(`${API_BASE_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' });
  showLoggedOutUI();
});

switchToRegister.addEventListener('click', () => { loginForm.classList.add('hidden'); registerForm.classList.remove('hidden'); loginError.classList.add('hidden'); registerError.classList.add('hidden'); });
switchToLogin.addEventListener('click', () => { loginForm.classList.remove('hidden'); registerForm.classList.add('hidden'); loginError.classList.add('hidden'); registerError.classList.add('hidden'); });

loginPassword.addEventListener('keypress', e => { if (e.key === 'Enter') loginSubmitBtn.click(); });
registerPassword.addEventListener('keypress', e => { if (e.key === 'Enter') registerSubmitBtn.click(); });

downloadBtn.addEventListener('click', handleDownload);
videoUrlInput.addEventListener('keypress', e => { if (e.key === 'Enter') handleDownload(); });
qualitySelect.addEventListener('change', updateDownloadLink);

async function handleDownload() {
  const url = videoUrlInput.value.trim();
  if (!url) return showError('Paste a TikTok URL');
  if (!url.includes('tiktok.com')) return showError('Invalid TikTok URL');
  hideAllResults();
  showLoading(true);
  downloadBtn.disabled = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/download?url=${encodeURIComponent(url)}`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) { showError('Login expired'); showLoggedOutUI(); return; }
      throw new Error(data.error || 'Download failed');
    }
    if (!data.success) throw new Error(data.error || 'Unknown error');
    currentVideoData = data.video;
    displayVideo(currentVideoData);
  } catch (err) {
    showError(err.message || 'Network error');
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
  if (!url) { url = currentVideoData.hdUrl || currentVideoData.sdUrl; qualitySelect.value = 'hd'; }
  downloadLink.href = url;
  downloadLink.download = `tiktok_${currentVideoData.id || 'video'}.mp4`;
}

function showLoading(show) { loading.classList.toggle('hidden', !show); }
function showError(msg) { errorText.textContent = msg; errorDiv.classList.remove('hidden'); setTimeout(() => errorDiv.classList.add('hidden'), 6000); }
function hideAllResults() { result.classList.add('hidden'); errorDiv.classList.add('hidden'); videoPreview.src = ''; currentVideoData = null; }
function formatNumber(n) { if (n >= 1e6) return (n/1e6).toFixed(1)+'M'; if (n >= 1e3) return (n/1e3).toFixed(1)+'K'; return n; }

// Sidebar navigation
document.querySelectorAll('.sidebar nav ul li').forEach(link => {
  link.addEventListener('click', function(e) {
    document.querySelectorAll('.sidebar nav ul li').forEach(l => l.classList.remove('active'));
    this.classList.add('active');
    const target = this.querySelector('a').getAttribute('href');
    if (target && target.startsWith('#')) {
      e.preventDefault();
      document.querySelector(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

checkAuth();
videoUrlInput.focus();