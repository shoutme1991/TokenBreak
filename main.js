const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const i18next = require('i18next');
const { McpMonitor } = require('./mcp/monitor');
const { TOOL_CONFIGS } = require('./mcp/config');

let mainWindow = null;
let tray = null;
let mcpMonitor = null;
let currentLanguage = 'en';
const IS_DEV = !app.isPackaged;

// ── Supported languages (whitelist) ─────────────────────────────────────────

const SUPPORTED_LANGUAGES = ['en', 'ko', 'ja', 'zh', 'es', 'fr', 'de', 'pt', 'ar', 'hi'];
const VALID_TOOL_IDS = Object.keys(TOOL_CONFIGS);

// ── Validation helpers ──────────────────────────────────────────────────────

function isValidLanguage(lang) {
  return typeof lang === 'string' && SUPPORTED_LANGUAGES.includes(lang);
}

function isValidToolList(tools) {
  return Array.isArray(tools) && tools.every(t => typeof t === 'string' && VALID_TOOL_IDS.includes(t));
}

function isValidExternalUrl(url) {
  try {
    const parsed = new URL(url);
    return ['https:', 'http:', 'mailto:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

// ── i18n setup ──────────────────────────────────────────────────────────────

function loadLanguages() {
  const i18nDir = path.join(__dirname, 'i18n');
  const resources = {};
  for (const lang of SUPPORTED_LANGUAGES) {
    const filePath = path.join(i18nDir, `${lang}.json`);
    if (fs.existsSync(filePath)) {
      try {
        resources[lang] = { translation: JSON.parse(fs.readFileSync(filePath, 'utf-8')) };
      } catch (err) {
        console.error(`[i18n] Failed to load ${lang}.json:`, err.message);
      }
    }
  }
  return resources;
}

async function initI18n() {
  const resources = loadLanguages();
  const sysLang = app.getLocale().split('-')[0];
  currentLanguage = resources[sysLang] ? sysLang : 'en';

  await i18next.init({
    lng: currentLanguage,
    fallbackLng: 'en',
    resources,
  });
}

function t(key) {
  return i18next.t(key);
}

// ── Window ──────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 750,
    minWidth: 360,
    minHeight: 600,
    show: false,
    title: 'TokenBreak',
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Show window only when ready (prevents white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Prevent navigation away from app
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const appUrl = `file://${path.join(__dirname, 'renderer', 'index.html')}`;
    if (url !== appUrl) {
      e.preventDefault();
    }
  });

  // Block new window creation from renderer
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  mainWindow.on('close', (e) => {
    if (!IS_DEV && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ── Webview security ────────────────────────────────────────────────────────

function setupWebviewSecurity() {
  // Restrict webview creation to allowed domains only
  const ALLOWED_WEBVIEW_DOMAINS = [
    'youtube.com',
    'www.youtube.com',
    'instagram.com',
    'www.instagram.com',
    'tiktok.com',
    'www.tiktok.com',
  ];

  app.on('web-contents-created', (_, contents) => {
    // Secure webview attachments
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      // Strip away preload scripts (not ours)
      delete webPreferences.preload;

      // Harden webview preferences
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.allowRunningInsecureContent = false;
      webPreferences.experimentalFeatures = false;
      webPreferences.enableBlinkFeatures = '';
      webPreferences.autoplayPolicy = 'no-user-gesture-required';

      // Validate webview src URL
      if (params.src) {
        try {
          const url = new URL(params.src);
          const isAllowed = ALLOWED_WEBVIEW_DOMAINS.some(
            domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)
          );
          if (!isAllowed) {
            console.warn(`[security] Blocked webview navigation to: ${params.src}`);
            event.preventDefault();
          }
        } catch {
          event.preventDefault();
        }
      }
    });

    // Block navigation inside webviews to non-allowed domains
    contents.on('will-navigate', (event, url) => {
      if (contents.getType() === 'webview') {
        try {
          const parsed = new URL(url);
          const isAllowed = ALLOWED_WEBVIEW_DOMAINS.some(
            domain => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
          );
          if (!isAllowed) {
            console.warn(`[security] Blocked webview navigation to: ${url}`);
            event.preventDefault();
          }
        } catch {
          event.preventDefault();
        }
      }
    });

    // Block new window creation from webviews
    contents.setWindowOpenHandler(({ url }) => {
      if (isValidExternalUrl(url)) {
        shell.openExternal(url);
      }
      return { action: 'deny' };
    });
  });
}

// ── Tray ────────────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  let trayIcon;
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
  } else {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('TokenBreak');
  updateTrayMenu();

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    }
  });
}

function updateTrayMenu() {
  const langNames = {
    en: 'English', ko: '한국어', ja: '日本語', zh: '中文',
    es: 'Español', fr: 'Français', de: 'Deutsch', pt: 'Português',
    ar: 'العربية', hi: 'हिन्दी',
  };

  const langMenu = Object.entries(langNames).map(([code, label]) => ({
    label,
    type: 'radio',
    checked: currentLanguage === code,
    click: () => changeLanguage(code),
  }));

  const contextMenu = Menu.buildFromTemplate([
    { label: t('tray.show'), click: () => mainWindow?.show() },
    { label: t('tray.hide'), click: () => mainWindow?.hide() },
    { type: 'separator' },
    { label: t('tray.language'), submenu: langMenu },
    { type: 'separator' },
    { label: t('tray.quit'), click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);
}

function changeLanguage(lang) {
  if (!isValidLanguage(lang)) return;
  currentLanguage = lang;
  i18next.changeLanguage(lang);
  updateTrayMenu();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('language-changed', lang);
  }
}

// ── MCP Monitor ─────────────────────────────────────────────────────────────

function startMonitor() {
  mcpMonitor = new McpMonitor();

  mcpMonitor.on('state-change', (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ai-state-change', state);
    }

    // Update tray icon based on state
    const iconName = state.status === 'waiting_for_input' ? 'tray-icon-alert.png' : 'tray-icon.png';
    const iconPath = path.join(__dirname, 'assets', iconName);
    if (fs.existsSync(iconPath)) {
      const icon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
      tray?.setImage(icon);
    }

    // Flash window when AI needs attention
    if (state.status === 'waiting_for_input') {
      mainWindow?.flashFrame(true);
    }
  });

  mcpMonitor.start();
}

// ── IPC Handlers ────────────────────────────────────────────────────────────

function setupIPC() {
  ipcMain.handle('get-language', () => currentLanguage);

  ipcMain.handle('get-translations', () => {
    // currentLanguage is always validated via isValidLanguage before assignment
    const langFile = path.join(__dirname, 'i18n', `${currentLanguage}.json`);
    if (fs.existsSync(langFile)) {
      return JSON.parse(fs.readFileSync(langFile, 'utf-8'));
    }
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n', 'en.json'), 'utf-8'));
  });

  ipcMain.handle('change-language', (_, lang) => {
    if (!isValidLanguage(lang)) {
      throw new Error('Invalid language code');
    }
    changeLanguage(lang);
    return true;
  });

  ipcMain.handle('get-ai-state', () => {
    return mcpMonitor ? mcpMonitor.getState() : { status: 'idle', tool: null };
  });

  ipcMain.handle('get-monitor-config', () => {
    return mcpMonitor ? mcpMonitor.getConfig() : {};
  });

  ipcMain.handle('set-active-tools', (_, tools) => {
    if (!isValidToolList(tools)) {
      throw new Error('Invalid tool list');
    }
    if (mcpMonitor) mcpMonitor.setActiveTools(tools);
    return true;
  });

  ipcMain.handle('window-minimize', () => mainWindow?.minimize());
  ipcMain.handle('window-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.handle('window-close', () => {
    if (IS_DEV) {
      app.isQuitting = true;
      app.quit();
      return true;
    }

    mainWindow?.hide();
    return true;
  });

  ipcMain.handle('open-external', (_, url) => {
    if (typeof url !== 'string' || !isValidExternalUrl(url)) {
      throw new Error('Invalid or disallowed URL');
    }
    return shell.openExternal(url);
  });
}

// ── Permission handlers ─────────────────────────────────────────────────────

function setupPermissions() {
  // Deny all permission requests from webviews (camera, mic, geolocation, etc.)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = [];
    callback(allowedPermissions.includes(permission));
  });

  // Deny permission checks as well
  session.defaultSession.setPermissionCheckHandler(() => {
    return false;
  });
}

// ── App lifecycle ───────────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    await initI18n();
    setupPermissions();
    setupWebviewSecurity();
    setupIPC();
    createWindow();
    createTray();
    startMonitor();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (mcpMonitor) mcpMonitor.stop();
});
