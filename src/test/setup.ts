import { vi } from 'vitest';

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock @tauri-apps/api/event
vi.mock('@tauri-apps/api/event', () => {
  const listeners = new Map<string, Set<(event: unknown) => void>>();

  return {
    listen: vi.fn((event: string, handler: (event: unknown) => void) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(handler);

      // Return unlisten function
      return Promise.resolve(() => {
        listeners.get(event)?.delete(handler);
      });
    }),
    emit: vi.fn((event: string, payload: unknown) => {
      const handlers = listeners.get(event);
      if (handlers) {
        for (const handler of handlers) {
          handler({ payload, event, id: 0 });
        }
      }
      return Promise.resolve();
    }),
    __getListeners: () => listeners,
    __clearListeners: () => listeners.clear(),
  };
});
