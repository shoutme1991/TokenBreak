const EventEmitter = require('events');
const { TOOL_CONFIGS } = require('./config');
const { ADAPTER_MAP } = require('./tools');

/**
 * McpMonitor - Watches AI development tools and emits state changes.
 *
 * States:
 *   - 'working'           → AI tool is actively processing (play video)
 *   - 'waiting_for_input'  → AI tool needs user attention (pause video)
 *   - 'idle'              → No AI tool activity detected (play video)
 */
const MONITOR_SETTINGS = {
  pollInterval: 1000,
  debounceMs: 500,
};

class McpMonitor extends EventEmitter {
  constructor() {
    super();
    this.adapters = {};
    this.activeTools = Object.keys(TOOL_CONFIGS);
    this.currentState = {
      status: 'idle',
      tool: null,
      toolName: null,
      activity: null,
      taskSummary: null,
    };
    this.pollTimer = null;
    this.debounceTimer = null;
    this.pendingState = null;

    this._initAdapters();
  }

  _initAdapters() {
    for (const [toolId, config] of Object.entries(TOOL_CONFIGS)) {
      const AdapterClass = ADAPTER_MAP[toolId];
      if (AdapterClass) {
        this.adapters[toolId] = new AdapterClass(config);
      }
    }
  }

  /**
   * Start monitoring all active tools
   */
  start() {
    this._poll();
    this.pollTimer = setInterval(() => this._poll(), MONITOR_SETTINGS.pollInterval);
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Set which tools to actively monitor
   */
  setActiveTools(tools) {
    this.activeTools = tools;
  }

  /**
   * Get current state
   */
  getState() {
    return { ...this.currentState };
  }

  /**
   * Get configuration for UI display
   */
  getConfig() {
    return {
      tools: Object.entries(TOOL_CONFIGS).map(([id, config]) => ({
        id,
        name: config.name,
        icon: config.icon,
        detected: this.adapters[id]?.detect() || false,
        active: this.activeTools.includes(id),
      })),
      settings: MONITOR_SETTINGS,
    };
  }

  /**
   * Poll all active adapters for state
   */
  _poll() {
    let nextState = {
      status: 'idle',
      tool: null,
      toolName: null,
      activity: null,
      taskSummary: null,
    };

    for (const toolId of this.activeTools) {
      const adapter = this.adapters[toolId];
      if (!adapter) continue;

      const state = adapter.getState();

      // waiting_for_input takes highest priority
      if (state.status === 'waiting_for_input') {
        nextState = {
          status: 'waiting_for_input',
          tool: toolId,
          toolName: TOOL_CONFIGS[toolId].name,
          activity: state.activity || null,
          taskSummary: state.taskSummary || null,
        };
        break;
      }

      // working takes priority over idle
      if (state.status === 'working' && nextState.status !== 'waiting_for_input') {
        nextState = {
          status: 'working',
          tool: toolId,
          toolName: TOOL_CONFIGS[toolId].name,
          activity: state.activity || null,
          taskSummary: state.taskSummary || null,
        };
      }
    }

    if (!this._stateEquals(nextState, this.currentState)) {
      if (nextState.status !== this.currentState.status) {
        this._debouncedStateChange(nextState);
      } else {
        this._applyStateChange(nextState);
      }
    }
  }

  _stateEquals(a, b) {
    return a.status === b.status
      && a.tool === b.tool
      && a.toolName === b.toolName
      && a.activity === b.activity
      && a.taskSummary === b.taskSummary;
  }

  _debouncedStateChange(newState) {
    // If transitioning to waiting_for_input, apply immediately (urgent)
    if (newState.status === 'waiting_for_input') {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      this._applyStateChange(newState);
      return;
    }

    // For other transitions, debounce
    this.pendingState = newState;
    if (!this.debounceTimer) {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        if (this.pendingState) {
          this._applyStateChange(this.pendingState);
          this.pendingState = null;
        }
      }, MONITOR_SETTINGS.debounceMs);
    }
  }

  _applyStateChange(newState) {
    this.currentState = newState;
    this.emit('state-change', newState);
  }
}

module.exports = { McpMonitor };
