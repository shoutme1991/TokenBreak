/**
 * TokenBreak - Renderer Process
 *
 * Manages the UI: setup screen, video playback via webview,
 * and the attention overlay when AI tools need user input.
 */

// Allowed platforms and their URLs (whitelist)
const PLATFORM_URLS = Object.freeze({
  youtube: 'https://www.youtube.com/shorts/',
  instagram: 'https://www.instagram.com/reels/',
  tiktok: 'https://www.tiktok.com/',
});

const VALID_STATUSES = ['idle', 'working', 'waiting_for_input'];
const TITLEBAR_HEIGHT = 38;
const STATUS_BAR_HEIGHT = 56;
const PLAYER_SYNC_DELAYS = [0, 120, 480];

// ── State ───────────────────────────────────────────────────────────────────

let state = {
  platform: null,
  activeTools: [],
  aiStatus: 'idle',
  aiState: {
    status: 'idle',
    tool: null,
    toolName: null,
    activity: null,
    taskSummary: null,
  },
  isPlaying: false,
  translations: {},
};

// ── DOM refs ────────────────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const setupScreen = $('#setup-screen');
const aboutScreen = $('#about-screen');
const playerScreen = $('#player-screen');
const playerContent = $('.player-content');
const webviewHost = $('#webview-host');
const overlay = $('#attention-overlay');
const overlayTitle = $('#overlay-title');
const overlayMessage = $('#overlay-message');
const overlayTool = $('#overlay-tool');
const statusBar = $('#status-bar');
const statusDot = $('#status-dot');
const statusText = $('#status-text');
const statusDetail = $('#status-detail');
const toolList = $('#tool-list');
const langSelect = $('#lang-select');
const btnStart = $('#btn-start');
const btnAbout = $('#btn-about');
const btnAboutBack = $('#btn-about-back');
let webview = null;

// ── Init ────────────────────────────────────────────────────────────────────

async function init() {
  state.translations = await window.tokenBreak.getTranslations();
  const lang = await window.tokenBreak.getLanguage();
  langSelect.value = lang;
  applyTranslations();
  applyDirection(lang);
  updateStartButton();
  applyFixedViewport();
  showScreen('setup');

  const config = await window.tokenBreak.getMonitorConfig();
  renderToolCards(config.tools || []);

  setupEventListeners();
  setupWebviewListeners();

  window.tokenBreak.onAiStateChange(handleAiStateChange);
  window.tokenBreak.onLanguageChanged(handleLanguageChange);
  window.addEventListener('resize', applyFixedViewport);

  const aiState = await window.tokenBreak.getAiState();
  handleAiStateChange(aiState);
}

// ── Tool Cards (safe DOM construction — no innerHTML) ───────────────────────

function renderToolCards(tools) {
  toolList.textContent = '';

  for (const tool of tools) {
    const card = document.createElement('div');
    card.className = 'tool-card';
    if (tool.active) card.classList.add('active');
    if (tool.detected) card.classList.add('detected');
    card.dataset.toolId = tool.id;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'tool-icon';
    iconSpan.textContent = tool.icon;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'tool-name';
    nameSpan.textContent = tool.name;

    card.appendChild(iconSpan);
    card.appendChild(nameSpan);
    card.addEventListener('click', () => toggleTool(tool.id, card));
    toolList.appendChild(card);
  }

  state.activeTools = tools.filter(t => t.active).map(t => t.id);
}

function toggleTool(toolId, card) {
  card.classList.toggle('active');
  if (state.activeTools.includes(toolId)) {
    state.activeTools = state.activeTools.filter(id => id !== toolId);
  } else {
    state.activeTools.push(toolId);
  }
  window.tokenBreak.setActiveTools(state.activeTools);
}

// ── Event Listeners ─────────────────────────────────────────────────────────

function setupEventListeners() {
  $$('.platform-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.platform-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const platform = btn.dataset.platform;
      // Only accept known platforms
      if (PLATFORM_URLS[platform]) {
        state.platform = platform;
      }
      updateStartButton();
    });
  });

  langSelect.addEventListener('change', (e) => {
    window.tokenBreak.changeLanguage(e.target.value);
  });

  btnStart.addEventListener('click', startPlaying);
  btnAbout.addEventListener('click', () => showScreen('about'));
  btnAboutBack.addEventListener('click', () => showScreen('setup'));

  $('#btn-minimize').addEventListener('click', () => window.tokenBreak.minimize());
  $('#btn-maximize').addEventListener('click', () => window.tokenBreak.maximize());
  $('#btn-close').addEventListener('click', () => window.tokenBreak.close());

  $('#btn-back-to-setup').addEventListener('click', () => showScreen('setup'));
  $('#btn-settings').addEventListener('click', () => showScreen('setup'));
  $('#btn-platform-switch').addEventListener('click', cyclePlatform);
}

function setupWebviewListeners() {
  if (!webview) return;
  if (webview.dataset.listenersAttached === 'true') return;
  webview.dataset.listenersAttached = 'true';

  const syncPlaybackViewport = () => {
    scheduleFixedViewportSync();
    ensurePlayback();
  };

  webview.addEventListener('dom-ready', syncPlaybackViewport);
  webview.addEventListener('did-stop-loading', syncPlaybackViewport);
  webview.addEventListener('did-navigate', syncPlaybackViewport);
  webview.addEventListener('did-navigate-in-page', syncPlaybackViewport);

  webview.addEventListener('did-fail-load', (event) => {
    // Ignore common redirect/intermediate aborts from social platforms.
    if (event && event.errorCode === -3) return;
  });
}

function updateStartButton() {
  btnStart.disabled = !state.platform;
}

// ── Screen Navigation ───────────────────────────────────────────────────────

function showScreen(name) {
  setupScreen.classList.remove('active');
  aboutScreen.classList.remove('active');
  playerScreen.classList.remove('active');

  if (name === 'setup') {
    setupScreen.classList.add('active');
  } else if (name === 'about') {
    aboutScreen.classList.add('active');
  } else if (name === 'player') {
    playerScreen.classList.add('active');
    applyFixedViewport();
  }
}

// ── Video Playback ──────────────────────────────────────────────────────────

function startPlaying() {
  if (!state.platform || !PLATFORM_URLS[state.platform]) return;

  showScreen('player');
  state.isPlaying = true;
  requestAnimationFrame(() => {
    const metrics = applyFixedViewport();
    mountWebview(metrics, true);
    scheduleFixedViewportSync();
    requestAnimationFrame(() => {
      if (webview) webview.src = PLATFORM_URLS[state.platform];
    });
  });
}

function cyclePlatform() {
  const platforms = Object.keys(PLATFORM_URLS);
  const currentIdx = platforms.indexOf(state.platform);
  const nextIdx = (currentIdx + 1) % platforms.length;
  state.platform = platforms[nextIdx];
  if (!playerScreen.classList.contains('active')) return;

  const metrics = applyFixedViewport();
  mountWebview(metrics, false);
  scheduleFixedViewportSync();
  requestAnimationFrame(() => {
    if (webview) webview.src = PLATFORM_URLS[state.platform];
  });
}

function mountWebview(metrics, forceRemount = false) {
  if (!webviewHost) return null;

  if (forceRemount && webview && webview.isConnected) {
    webview.remove();
    webview = null;
  }

  if (webview && webview.isConnected) {
    applyWebviewMetrics(metrics);
    return webview;
  }

  const nextWebview = document.createElement('webview');
  nextWebview.id = 'video-webview';
  nextWebview.className = 'video-webview';
  nextWebview.setAttribute('partition', 'persist:tokenbreak');
  nextWebview.setAttribute('allowpopups', 'false');
  applyWebviewMetrics(metrics, nextWebview);

  webviewHost.textContent = '';
  webviewHost.appendChild(nextWebview);
  webview = nextWebview;
  setupWebviewListeners();
  return webview;
}

function applyFixedViewport() {
  if (!playerScreen || !playerContent || !webviewHost || !statusBar) return;

  const fullWidth = Math.max(0, Math.round(window.innerWidth));
  const appHeight = Math.max(0, Math.round(window.innerHeight - TITLEBAR_HEIGHT));
  const playerHeight = Math.max(0, appHeight - STATUS_BAR_HEIGHT);
  const statusHeight = statusBar.offsetHeight || STATUS_BAR_HEIGHT;

  if (!fullWidth || !appHeight || !playerHeight) return null;

  playerScreen.style.width = `${fullWidth}px`;
  playerScreen.style.height = `${appHeight}px`;

  playerContent.style.width = `${fullWidth}px`;
  playerContent.style.height = `${playerHeight}px`;
  playerContent.style.minHeight = `${playerHeight}px`;
  playerContent.style.maxHeight = `${playerHeight}px`;

  webviewHost.style.width = `${fullWidth}px`;
  webviewHost.style.height = `${playerHeight}px`;
  webviewHost.style.minHeight = `${playerHeight}px`;
  webviewHost.style.maxHeight = `${playerHeight}px`;

  statusBar.style.width = `${fullWidth}px`;
  statusBar.style.height = `${statusHeight}px`;

  const metrics = { fullWidth, playerHeight };
  applyWebviewMetrics(metrics);
  return metrics;
}

function applyWebviewMetrics(metrics, target = webview) {
  if (!target || !metrics) return;

  target.style.display = 'flex';
  target.style.width = `${metrics.fullWidth}px`;
  target.style.height = `${metrics.playerHeight}px`;
  target.style.minWidth = `${metrics.fullWidth}px`;
  target.style.minHeight = `${metrics.playerHeight}px`;
  target.style.maxWidth = `${metrics.fullWidth}px`;
  target.style.maxHeight = `${metrics.playerHeight}px`;
}

function scheduleFixedViewportSync() {
  PLAYER_SYNC_DELAYS.forEach((delay) => {
    window.setTimeout(() => {
      applyFixedViewport();
    }, delay);
  });
}

function ensurePlayback() {
  if (!webview || !state.platform || !playerScreen.classList.contains('active')) return;

  webview.executeJavaScript(`
    (() => {
      document.documentElement.style.background = '#000';
      document.body.style.background = '#000';
      document.body.style.margin = '0';
      document.body.style.overflow = 'hidden';

      document.querySelectorAll('video').forEach((video) => {
        video.setAttribute('playsinline', 'true');
        video.style.background = '#000';
        video.play().catch(() => {});
      });
    })();
  `).catch(() => {});
}

function pauseVideo() {
  if (!webview || !state.isPlaying) return;
  try {
    // Static JS string — no user input interpolated
    webview.executeJavaScript(
      "document.querySelectorAll('video').forEach(function(v) { v.pause(); });"
    ).catch(() => {});
  } catch {
    // webview might not be ready
  }
}

function resumeVideo() {
  if (!webview || !state.isPlaying) return;
  try {
    webview.executeJavaScript(
      "document.querySelectorAll('video').forEach(function(v) { v.play().catch(function(){}); });"
    ).catch(() => {});
  } catch {
    // webview might not be ready
  }
}

// ── AI State Handling ───────────────────────────────────────────────────────

function handleAiStateChange(aiState) {
  if (!aiState || !VALID_STATUSES.includes(aiState.status)) return;

  const prevStatus = state.aiState.status;
  state.aiStatus = aiState.status;
  state.aiState = {
    ...state.aiState,
    ...aiState,
  };

  renderAiState(state.aiState);

  if (state.aiState.status === 'waiting_for_input') {
    pauseVideo();
    showOverlay(state.aiState);
  } else if (prevStatus === 'waiting_for_input') {
    hideOverlay();
    resumeVideo();
  }
}

function renderAiState(aiState) {
  const dotClass = aiState.status === 'waiting_for_input' ? 'waiting' : aiState.status;
  statusDot.className = `status-dot ${dotClass}`;

  const statusKeys = {
    idle: 'status.idle',
    working: 'status.working',
    waiting_for_input: 'status.waiting',
  };
  statusText.textContent = t(statusKeys[aiState.status] || 'status.idle');

  const detail = buildStatusDetail(aiState);
  statusDetail.textContent = detail;
  statusDetail.classList.toggle('visible', Boolean(detail));
}

function buildStatusDetail(aiState) {
  if (!aiState || aiState.status === 'idle') return '';

  const summary = aiState.taskSummary || getActivityLabel(aiState.activity);
  const parts = [aiState.toolName, summary].filter(Boolean);
  return parts.join(' · ');
}

function buildOverlayContext(aiState) {
  const summary = getActivityLabel(aiState.activity) || aiState.taskSummary;
  const parts = [aiState.toolName, summary].filter(Boolean);
  return parts.join(' · ');
}

function getActivityLabel(activityKey) {
  if (typeof activityKey !== 'string' || !activityKey) return '';

  const translated = t(activityKey);
  if (translated !== activityKey) return translated;

  if (!activityKey.startsWith('activity.')) return activityKey;

  const humanized = activityKey
    .slice('activity.'.length)
    .replace(/([A-Z])/g, ' $1')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  return humanized.charAt(0).toUpperCase() + humanized.slice(1);
}

function renderOverlayContext(aiState) {
  const context = buildOverlayContext(aiState);
  if (context) {
    overlayTool.textContent = context;
    overlayTool.style.display = 'flex';
  } else {
    overlayTool.textContent = '';
    overlayTool.style.display = 'none';
  }
}

function showOverlay(aiState) {
  overlayTitle.textContent = t('overlay.title');
  overlayMessage.textContent = t('overlay.message');
  renderOverlayContext(aiState);
  overlay.classList.remove('hidden');
}

function hideOverlay() {
  overlay.classList.add('hidden');
}

// ── i18n ────────────────────────────────────────────────────────────────────

function t(key) {
  if (typeof key !== 'string') return '';
  const keys = key.split('.');
  let val = state.translations;
  for (const k of keys) {
    if (val && typeof val === 'object') val = val[k];
    else return key;
  }
  return (typeof val === 'string') ? val : key;
}

function applyTranslations() {
  $$('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translated = t(key);
    if (translated !== key) {
      el.textContent = translated;
    }
  });
}

async function handleLanguageChange(lang) {
  state.translations = await window.tokenBreak.getTranslations();
  langSelect.value = lang;
  applyTranslations();
  applyDirection(lang);
  renderAiState(state.aiState);
  if (state.aiState.status === 'waiting_for_input') {
    showOverlay(state.aiState);
  }
}

function applyDirection(lang) {
  const rtlLangs = ['ar', 'he', 'fa', 'ur'];
  document.documentElement.dir = rtlLangs.includes(lang) ? 'rtl' : 'ltr';
}

// ── Boot ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
