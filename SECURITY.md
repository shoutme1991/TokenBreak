# Security Policy

## Overview

TokenBreak is a local desktop application. It does **not** operate a server, collect telemetry, or transmit data to any remote endpoint. All monitoring happens on your local machine by reading local files.

## Architecture & Threat Model

### What TokenBreak accesses

- **Local AI tool directories** — Reads files in `~/.claude/`, `~/.codex/`, `~/.antigravity/` to detect activity. These reads are one-level-deep directory scans and bounded file reads (max 1 MB).
- **Social media via webview** — Loads YouTube, Instagram, and TikTok in an isolated Electron webview. This is equivalent to opening them in a browser tab.

### What TokenBreak does NOT do

- Does **not** intercept, modify, or proxy network traffic
- Does **not** inject code into AI tools or modify their configuration
- Does **not** access credentials, API keys, or tokens from AI tools
- Does **not** send any data to remote servers (no analytics, no telemetry)
- Does **not** store your social media credentials (handled by the webview's own session)

## Security Measures

### Electron Hardening

| Measure | Status |
|---------|--------|
| `contextIsolation: true` | Renderer cannot access Node.js |
| `nodeIntegration: false` | No Node.js in renderer process |
| `sandbox: true` | OS-level sandboxing enabled |
| `webSecurity: true` | Same-origin policy enforced |
| `allowRunningInsecureContent: false` | No mixed content |

### IPC Security

All IPC handlers validate their inputs:

- **`change-language`** — Only accepts language codes from a hardcoded whitelist (`en`, `ko`, `ja`, etc.)
- **`set-active-tools`** — Only accepts tool IDs matching known tool configurations
- **`open-external`** — Only allows `https:`, `http:`, and `mailto:` protocols. Blocks `file:`, `javascript:`, and all other schemes.

### Webview Isolation

- Webviews run in a **separate process** with their own security context
- Only **whitelisted domains** can load: `youtube.com`, `instagram.com`, `tiktok.com`
- All **permission requests** (camera, microphone, geolocation, notifications) are **denied by default**
- **New window creation** from webviews is blocked
- Navigation within webviews is restricted to allowed domains

### Content Security Policy

The renderer enforces a strict CSP:
```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none';
```

### File System Access

- Only reads files from known, hardcoded paths under the user's home directory
- No user-controlled file paths in any read operation
- State file reads are limited to 1 MB to prevent memory exhaustion
- Path traversal characters (`..`, `/`, `\`) in directory entries are rejected

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email the maintainers directly (see repository contact info)
3. Include steps to reproduce and potential impact

We will acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |
| < Latest | No       |

## Third-Party Dependencies

| Dependency | Purpose | Risk |
|------------|---------|------|
| Electron | Desktop app framework | Regularly updated; follow [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security) |
| i18next | Internationalization | Low risk — string localization only |
| chokidar | File watching | Low risk — local file observation only |
