const path = require('path');
const os = require('os');

const homeDir = os.homedir();
const platform = process.platform;

/**
 * Tool-specific configuration for monitoring AI dev tools.
 *
 * Each tool defines:
 *   - watchPaths / stateFiles: where to look for activity
 *   - waitingPatterns / workingPatterns: state detection
 *   - activityPatterns: maps regex → human-readable activity key (i18n)
 *
 * Security notes:
 * - All watchPaths are resolved from os.homedir() only
 * - Regex patterns use bounded quantifiers to prevent ReDoS
 * - State file reads are size-limited in tools.js
 */
const TOOL_CONFIGS = {
  'claude-code': {
    name: 'Claude Code',
    icon: '🤖',
    watchPaths: [
      path.join(homeDir, '.claude'),
    ],
    stateFiles: [
      path.join(homeDir, '.claude', '.local', 'state.json'),
    ],
    waitingPatterns: [
      /Do you want to proceed/i,
      /\(y\/n\)/i,
      /Press Enter/i,
      /waiting for\s{1,50}input/i,
      /approve or deny/i,
      /Would you like/i,
    ],
    workingPatterns: [
      /Thinking/i,
      /Generating/i,
      /Writing/i,
      /Reading/i,
      /Searching/i,
    ],
    // Each entry: [regex, i18n activity key]
    activityPatterns: [
      [/Thinking/i,                   'activity.thinking'],
      [/Generating/i,                 'activity.generating'],
      [/Writing\s{1,50}file/i,        'activity.writingFile'],
      [/Writing/i,                    'activity.writingCode'],
      [/Reading\s{1,50}file/i,        'activity.readingFile'],
      [/Reading/i,                    'activity.reading'],
      [/Searching/i,                  'activity.searching'],
      [/Editing/i,                    'activity.editing'],
      [/Running\s{1,50}command/i,     'activity.runningCommand'],
      [/Running\s{1,50}test/i,        'activity.runningTests'],
      [/Installing/i,                 'activity.installing'],
      [/Building/i,                   'activity.building'],
      [/Compiling/i,                  'activity.compiling'],
      [/Debugging/i,                  'activity.debugging'],
      [/Refactoring/i,                'activity.refactoring'],
      [/Analyzing/i,                  'activity.analyzing'],
      [/Creating/i,                   'activity.creating'],
      [/Deleting/i,                   'activity.deleting'],
      [/Updating/i,                   'activity.updating'],
      [/Committing/i,                 'activity.committing'],
      [/Pushing/i,                    'activity.pushing'],
      [/Pulling/i,                    'activity.pulling'],
      [/Do you want to proceed/i,     'activity.askConfirm'],
      [/\(y\/n\)/i,                   'activity.askYesNo'],
      [/approve or deny/i,            'activity.askApproval'],
      [/Would you like/i,             'activity.askChoice'],
    ],
  },

  'claude-team': {
    name: 'Claude Team',
    icon: '👥',
    watchPaths: [
      path.join(homeDir, '.claude'),
    ],
    stateFiles: [],
    waitingPatterns: [
      /awaiting\s{1,50}response/i,
      /needs\s{1,50}review/i,
    ],
    workingPatterns: [
      /processing/i,
      /generating/i,
    ],
    activityPatterns: [
      [/processing/i,                 'activity.processing'],
      [/generating/i,                 'activity.generating'],
      [/awaiting\s{1,50}response/i,   'activity.awaitingResponse'],
      [/needs\s{1,50}review/i,        'activity.needsReview'],
    ],
  },

  'codex': {
    name: 'Codex',
    icon: '💻',
    watchPaths: platform === 'win32'
      ? [path.join(homeDir, 'AppData', 'Local', 'codex')]
      : [path.join(homeDir, '.codex')],
    stateFiles: [],
    waitingPatterns: [
      /waiting for\s{1,50}input/i,
      /confirm/i,
      /approve/i,
    ],
    workingPatterns: [
      /running/i,
      /executing/i,
    ],
    activityPatterns: [
      [/running/i,                    'activity.running'],
      [/executing/i,                  'activity.executing'],
      [/generating/i,                 'activity.generating'],
      [/confirm/i,                    'activity.askConfirm'],
      [/approve/i,                    'activity.askApproval'],
    ],
  },

  'antigravity': {
    name: 'Antigravity',
    icon: '🚀',
    watchPaths: platform === 'win32'
      ? [path.join(homeDir, 'AppData', 'Local', 'antigravity')]
      : [path.join(homeDir, '.antigravity')],
    stateFiles: [],
    waitingPatterns: [
      /waiting/i,
      /confirm/i,
    ],
    workingPatterns: [
      /processing/i,
      /generating/i,
    ],
    activityPatterns: [
      [/processing/i,                 'activity.processing'],
      [/generating/i,                 'activity.generating'],
      [/confirm/i,                    'activity.askConfirm'],
    ],
  },
};

module.exports = { TOOL_CONFIGS };
