const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Maximum file size to read for pattern matching (1 MB)
const MAX_STATE_FILE_SIZE = 1024 * 1024;

/**
 * Base adapter for AI tool state detection.
 *
 * Security notes:
 * - Only reads files from paths defined in config (not user-controlled)
 * - State file reads are size-limited to prevent memory exhaustion
 * - All errors are logged, not silently swallowed
 */
class BaseAdapter {
  constructor(config) {
    this.config = config;
    this._cachedContent = null;
    this._cacheTime = 0;
  }

  detect() {
    return this.config.watchPaths.some(p => {
      try {
        return fs.existsSync(p);
      } catch (err) {
        console.warn(`[monitor] Cannot access path ${p}:`, err.message);
        return false;
      }
    });
  }

  /**
   * @returns {{ status: string, activity: string|null }}
   */
  getState() {
    return { status: 'idle', activity: null, taskSummary: null };
  }

  hasRecentActivity(withinMs = 5000) {
    for (const watchPath of this.config.watchPaths) {
      try {
        if (!fs.existsSync(watchPath)) continue;
        const stat = fs.statSync(watchPath);
        if (Date.now() - stat.mtimeMs < withinMs) return true;

        if (stat.isDirectory()) {
          const children = fs.readdirSync(watchPath);
          for (const child of children) {
            if (child.includes('..') || child.includes('/') || child.includes('\\')) continue;
            const childPath = path.join(watchPath, child);
            try {
              const childStat = fs.statSync(childPath);
              if (Date.now() - childStat.mtimeMs < withinMs) return true;
            } catch (err) {
              console.warn(`[monitor] Cannot stat ${childPath}:`, err.message);
            }
          }
        }
      } catch (err) {
        console.warn(`[monitor] Error checking activity in ${watchPath}:`, err.message);
      }
    }
    return false;
  }

  matchPatterns(patterns) {
    const content = this._readStateContent();
    if (!content) return false;
    for (const pattern of patterns) {
      if (pattern.test(content)) return true;
    }
    return false;
  }

  /**
   * Detect current activity by matching activityPatterns.
   * Returns the i18n key of the first matching activity, or null.
   */
  detectActivity() {
    const patterns = this.config.activityPatterns;
    if (!patterns || patterns.length === 0) return null;

    const content = this._readStateContent();
    if (!content) return null;

    for (const [regex, activityKey] of patterns) {
      if (regex.test(content)) return activityKey;
    }
    return null;
  }

  /**
   * Read and cache state file content (refreshed at most once per second)
   * to avoid redundant disk reads across matchPatterns + detectActivity.
   */
  _readStateContent() {
    const now = Date.now();
    if (this._cachedContent !== null && now - this._cacheTime < 1000) {
      return this._cachedContent;
    }

    this._cachedContent = null;
    this._cacheTime = now;

    for (const stateFile of this.config.stateFiles) {
      try {
        if (!fs.existsSync(stateFile)) continue;

        const stat = fs.statSync(stateFile);
        if (stat.size > MAX_STATE_FILE_SIZE) {
          console.warn(`[monitor] Skipping oversized state file (${stat.size} bytes): ${stateFile}`);
          continue;
        }

        this._cachedContent = fs.readFileSync(stateFile, 'utf-8');
        return this._cachedContent;
      } catch (err) {
        console.warn(`[monitor] Error reading state file ${stateFile}:`, err.message);
      }
    }
    return null;
  }
}

/**
 * Claude Code adapter — monitors ~/.claude/ for activity
 */
class ClaudeCodeAdapter extends BaseAdapter {
  getState() {
    if (!this.detect()) return { status: 'idle', activity: null };
    if (!this.hasRecentActivity(10000)) return { status: 'idle', activity: null };

    const activity = this.detectActivity();

    if (this.matchPatterns(this.config.waitingPatterns)) {
      return { status: 'waiting_for_input', activity };
    }
    if (this.matchPatterns(this.config.workingPatterns)) {
      return { status: 'working', activity };
    }
    if (this.hasRecentActivity(3000)) {
      return { status: 'working', activity: activity || 'activity.processing' };
    }
    return { status: 'idle', activity: null };
  }
}

/**
 * Claude Team adapter
 */
class ClaudeTeamAdapter extends BaseAdapter {
  getState() {
    if (!this.detect()) return { status: 'idle', activity: null };
    if (!this.hasRecentActivity(10000)) return { status: 'idle', activity: null };

    const activity = this.detectActivity();

    if (this.matchPatterns(this.config.waitingPatterns)) {
      return { status: 'waiting_for_input', activity };
    }
    if (this.hasRecentActivity(3000)) {
      return { status: 'working', activity: activity || 'activity.processing' };
    }
    return { status: 'idle', activity: null };
  }
}

/**
 * OpenAI Codex adapter
 */
class CodexAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this._taskSummary = null;
    this._taskSummaryCacheTime = 0;
    this._stateDbPath = null;
    this._stateDbPathCacheTime = 0;
    this._logsDbPath = null;
    this._logsDbPathCacheTime = 0;
    this._runtimeState = null;
    this._runtimeStateCacheTime = 0;
  }

  getState() {
    if (!this.detect()) return { status: 'idle', activity: null, taskSummary: null };

    const runtimeState = this._getRuntimeState();
    if (!runtimeState || runtimeState.status === 'idle') {
      return { status: 'idle', activity: null, taskSummary: null };
    }

    return {
      status: runtimeState.status,
      activity: runtimeState.activity || 'activity.processing',
      taskSummary: this.getTaskSummary(runtimeState.threadId),
    };
  }

  getTaskSummary(threadId = null) {
    const now = Date.now();
    if (now - this._taskSummaryCacheTime < 2000) {
      return this._taskSummary;
    }

    this._taskSummaryCacheTime = now;
    this._taskSummary = null;

    const dbPath = this._getStateDbPath();
    if (!dbPath) return null;

    try {
      const threadQuery = threadId
        ? `SELECT title FROM threads WHERE id = '${this._escapeSql(threadId)}' LIMIT 1;`
        : "SELECT title FROM threads ORDER BY updated_at DESC LIMIT 1;";

      let result = this._querySqlite(dbPath, threadQuery);
      if (!result && threadId) {
        result = this._querySqlite(dbPath, "SELECT title FROM threads ORDER BY updated_at DESC LIMIT 1;");
      }

      if (!result) return null;

      this._taskSummary = this._summarizeTitle(result);
      return this._taskSummary;
    } catch {
      return null;
    }
  }

  _getStateDbPath() {
    const now = Date.now();
    if (this._stateDbPath && now - this._stateDbPathCacheTime < 10000) {
      return this._stateDbPath;
    }

    this._stateDbPathCacheTime = now;
    this._stateDbPath = null;

    const codexDir = this.config.watchPaths[0];
    if (!codexDir || !fs.existsSync(codexDir)) return null;

    try {
      const candidates = fs.readdirSync(codexDir)
        .filter(name => /^state_\d+\.sqlite$/.test(name))
        .map(name => {
          const filePath = path.join(codexDir, name);
          return {
            filePath,
            mtimeMs: fs.statSync(filePath).mtimeMs,
          };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

      this._stateDbPath = candidates[0]?.filePath || null;
      return this._stateDbPath;
    } catch {
      return null;
    }
  }

  _getLogsDbPath() {
    const now = Date.now();
    if (this._logsDbPath && now - this._logsDbPathCacheTime < 10000) {
      return this._logsDbPath;
    }

    this._logsDbPathCacheTime = now;
    this._logsDbPath = null;

    const codexDir = this.config.watchPaths[0];
    if (!codexDir || !fs.existsSync(codexDir)) return null;

    try {
      const candidates = fs.readdirSync(codexDir)
        .filter(name => /^logs_\d+\.sqlite$/.test(name))
        .map(name => {
          const filePath = path.join(codexDir, name);
          return {
            filePath,
            mtimeMs: fs.statSync(filePath).mtimeMs,
          };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

      this._logsDbPath = candidates[0]?.filePath || null;
      return this._logsDbPath;
    } catch {
      return null;
    }
  }

  _getRuntimeState() {
    const now = Date.now();
    if (this._runtimeState && now - this._runtimeStateCacheTime < 1200) {
      return this._runtimeState;
    }

    this._runtimeStateCacheTime = now;
    this._runtimeState = { status: 'idle', activity: null, threadId: null };

    const dbPath = this._getLogsDbPath();
    if (!dbPath) return this._runtimeState;

    const cutoffSec = Math.floor(now / 1000) - 15;
    const sql = `
      SELECT ts, ifnull(thread_id, ''), replace(replace(substr(feedback_log_body, 1, 260), char(10), ' '), char(9), ' ')
      FROM logs
      WHERE ts >= ${cutoffSec}
        AND (
          feedback_log_body LIKE 'Received message {"type":"response.output_item.added"%'
          OR feedback_log_body LIKE 'Received message {"type":"response.created"%'
          OR feedback_log_body LIKE 'Received message {"type":"response.in_progress"%'
          OR feedback_log_body LIKE 'Received message {"type":"response.completed"%'
          OR feedback_log_body LIKE 'Received message {"type":"response.output_text.delta"%'
          OR feedback_log_body LIKE 'app-server event: turn/completed%'
          OR feedback_log_body LIKE 'app-server event: item/commandExecution/%'
          OR feedback_log_body LIKE 'app-server event: item/agentMessage/delta%'
        )
      ORDER BY id DESC
      LIMIT 40;
    `;

    const output = this._querySqlite(dbPath, sql, ['-separator', '\t']);
    if (!output) return this._runtimeState;

    const rows = output
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    for (const row of rows) {
      const [tsRaw, threadIdRaw, ...bodyParts] = row.split('\t');
      const ts = Number(tsRaw);
      const threadId = threadIdRaw || null;
      const body = bodyParts.join('\t');

      if (!Number.isFinite(ts) || !body) continue;

      const ageMs = now - (ts * 1000);
      if (ageMs > 15000) continue;

      if (
        /request_user_input/i.test(body)
        || /waiting for input/i.test(body)
        || /approve/i.test(body)
        || /confirm/i.test(body)
      ) {
        this._runtimeState = {
          status: 'waiting_for_input',
          activity: 'activity.askConfirm',
          threadId,
        };
        return this._runtimeState;
      }

      if (/response\.completed/i.test(body) || /turn\/completed/i.test(body)) {
        this._runtimeState = { status: 'idle', activity: null, threadId };
        return this._runtimeState;
      }

      if (/item\/commandExecution\/(?:outputDelta|terminalInteraction)/i.test(body)) {
        this._runtimeState = {
          status: 'working',
          activity: 'activity.runningCommand',
          threadId,
        };
        return this._runtimeState;
      }

      if (/item\/agentMessage\/delta/i.test(body) || /response\.output_text\.delta/i.test(body)) {
        this._runtimeState = {
          status: 'working',
          activity: 'activity.generating',
          threadId,
        };
        return this._runtimeState;
      }

      if (/response\.output_item\.added/i.test(body) && /"status":"in_progress"/i.test(body)) {
        const activity = /"name":"(?:exec_command|write_stdin)"/i.test(body)
          ? 'activity.runningCommand'
          : 'activity.processing';

        this._runtimeState = {
          status: 'working',
          activity,
          threadId,
        };
        return this._runtimeState;
      }

      if (/response\.(?:created|in_progress)/i.test(body)) {
        this._runtimeState = {
          status: 'working',
          activity: 'activity.processing',
          threadId,
        };
        return this._runtimeState;
      }
    }

    return this._runtimeState;
  }

  _querySqlite(dbPath, sql, extraArgs = []) {
    const result = spawnSync(
      'sqlite3',
      [
        ...extraArgs,
        dbPath,
        sql,
      ],
      {
        encoding: 'utf8',
        timeout: 1000,
        windowsHide: true,
      }
    );

    if (result.status !== 0 || !result.stdout) return null;
    return result.stdout;
  }

  _escapeSql(value) {
    return String(value).replace(/'/g, "''");
  }

  _summarizeTitle(rawTitle) {
    if (typeof rawTitle !== 'string') return null;

    const firstLine = rawTitle
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(Boolean);

    if (!firstLine) return null;

    const normalized = firstLine.replace(/\s+/g, ' ').trim();
    if (normalized.length <= 72) return normalized;
    return `${normalized.slice(0, 69).trimEnd()}...`;
  }
}

/**
 * Antigravity adapter
 */
class AntigravityAdapter extends BaseAdapter {
  getState() {
    if (!this.detect()) return { status: 'idle', activity: null };
    if (!this.hasRecentActivity(10000)) return { status: 'idle', activity: null };

    const activity = this.detectActivity();

    if (this.matchPatterns(this.config.waitingPatterns)) {
      return { status: 'waiting_for_input', activity };
    }
    if (this.hasRecentActivity(3000)) {
      return { status: 'working', activity: activity || 'activity.processing' };
    }
    return { status: 'idle', activity: null };
  }
}

const ADAPTER_MAP = {
  'claude-code': ClaudeCodeAdapter,
  'claude-team': ClaudeTeamAdapter,
  'codex': CodexAdapter,
  'antigravity': AntigravityAdapter,
};

module.exports = { ADAPTER_MAP, BaseAdapter };
