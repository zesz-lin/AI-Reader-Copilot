import { vi } from 'vitest';

// ── Chrome storage mock ────────────────────────────────────────────────

const storageStore: Record<string, unknown> = {};

const mockStorageLocal = {
  get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
    if (keys === undefined || keys === null) {
      return { ...storageStore };
    }
    if (typeof keys === 'string') {
      const v = storageStore[keys];
      return { [keys]: v ?? undefined };
    }
    if (Array.isArray(keys)) {
      const result: Record<string, unknown> = {};
      for (const k of keys) {
        result[k] = storageStore[k] ?? undefined;
      }
      return result;
    }
    // object
    const result: Record<string, unknown> = {};
    for (const [k, def] of Object.entries(keys)) {
      result[k] = k in storageStore ? storageStore[k] : def;
    }
    return result;
  }),
  set: vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(storageStore, items);
  }),
  remove: vi.fn(async (key: string) => {
    delete storageStore[key];
  }),
};

// Reset store between tests
export function resetStorage() {
  Object.keys(storageStore).forEach((k) => delete storageStore[k]);
}

// ── Chrome runtime mock (minimal) ──────────────────────────────────────

const mockRuntime = {
  onMessage: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
  sendMessage: vi.fn(),
  connect: vi.fn().mockReturnValue({
    onDisconnect: { addListener: vi.fn() },
    disconnect: vi.fn(),
  }),
  lastError: null as Error | null,
};

// ── Global chrome object ───────────────────────────────────────────────

const chrome = {
  storage: {
    local: mockStorageLocal,
    onChanged: {
      addListener: vi.fn(),
    },
  },
  runtime: mockRuntime,
  sidePanel: {
    setPanelBehavior: vi.fn().mockResolvedValue(undefined),
  },
  action: {
    onClicked: {
      addListener: vi.fn(),
    },
  },
  tabs: {
    query: vi.fn(),
    sendMessage: vi.fn(),
    update: vi.fn(),
  },
  commands: {
    onCommand: {
      addListener: vi.fn(),
    },
  },
  webNavigation: {
    onHistoryStateUpdated: {
      addListener: vi.fn(),
    },
  },
};

vi.stubGlobal('chrome', chrome);

// ── window.matchMedia polyfill (jsdom does not implement it) ────────────

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// ── crypto.randomUUID polyfill (jsdom does not implement it) ────────────

if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.randomUUID) {
  const mockUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: mockUUID },
    writable: true,
  });
}

// ── Jest/Vitest global type extension ──────────────────────────────────

declare module 'vitest' {
  interface ProvidedContext {
    chrome: typeof chrome;
  }
}

export { chrome };
