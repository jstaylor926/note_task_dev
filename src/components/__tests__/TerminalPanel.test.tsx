import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { invoke } from '@tauri-apps/api/core';

// Mock xterm.js — jsdom lacks canvas support
vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    cols = 80;
    rows = 24;
    loadAddon = vi.fn();
    open = vi.fn();
    onData = vi.fn();
    write = vi.fn();
    writeln = vi.fn();
    dispose = vi.fn();
  }
  return { Terminal: MockTerminal };
});

vi.mock('@xterm/addon-fit', () => {
  class MockFitAddon {
    fit = vi.fn();
  }
  return { FitAddon: MockFitAddon };
});

vi.mock('@xterm/addon-web-links', () => {
  class MockWebLinksAddon {}
  return { WebLinksAddon: MockWebLinksAddon };
});

vi.mock('@xterm/addon-search', () => {
  class MockSearchAddon {}
  return { SearchAddon: MockSearchAddon };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TerminalPanel', () => {
  it('renders terminal container with tab bar', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { default: TerminalPanel } = await import('../TerminalPanel');
    const { container } = render(() => <TerminalPanel />);
    expect(container.querySelector('div')).toBeTruthy();
  });

  it('renders + button for new tab', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { default: TerminalPanel } = await import('../TerminalPanel');
    const { container } = render(() => <TerminalPanel />);
    const buttons = container.querySelectorAll('button');
    const plusButton = Array.from(buttons).find(
      (b) => b.textContent?.trim() === '+',
    );
    expect(plusButton).toBeTruthy();
  });

  it('renders with full height and width', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { default: TerminalPanel } = await import('../TerminalPanel');
    const { container } = render(() => <TerminalPanel />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('h-full');
    expect(wrapper.className).toContain('w-full');
  });
});
