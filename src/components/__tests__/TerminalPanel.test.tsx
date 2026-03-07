import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@solidjs/testing-library';
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(() => {
  cleanup();
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
    expect(container.querySelector('[data-testid="terminal-add-tab"]')).toBeTruthy();
  });

  it('renders with full height and width', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { default: TerminalPanel } = await import('../TerminalPanel');
    const { container } = render(() => <TerminalPanel />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('h-full');
    expect(wrapper.className).toContain('w-full');
  });

  it('creates a new tab when + button is clicked', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { default: TerminalPanel } = await import('../TerminalPanel');
    const { container } = render(() => <TerminalPanel />);

    expect(container.querySelectorAll('[data-testid^="terminal-tab-"]').length).toBe(1);
    const plusButton = container.querySelector('[data-testid="terminal-add-tab"]') as HTMLElement;
    fireEvent.click(plusButton);
    expect(container.querySelectorAll('[data-testid^="terminal-tab-"]').length).toBe(2);
  });

  it('handles Cmd+T shortcut to create a new tab', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { default: TerminalPanel } = await import('../TerminalPanel');
    const { container } = render(() => <TerminalPanel />);

    expect(container.querySelectorAll('[data-testid^="terminal-tab-"]').length).toBe(1);
    fireEvent.keyDown(document, { key: 't', metaKey: true });
    expect(container.querySelectorAll('[data-testid^="terminal-tab-"]').length).toBe(2);
  });

  it('handles Cmd+D shortcut to split pane vertically', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { default: TerminalPanel } = await import('../TerminalPanel');
    const { container } = render(() => <TerminalPanel />);
    
    // Mock getBoundingClientRect for split container width
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 500 });
    
    // We start with one xterm instance container
    let xtermContainers = container.querySelectorAll('.xterm');
    
    // Simulate Cmd+D (split vertically)
    fireEvent.keyDown(document, { key: 'd', metaKey: true });
    
    // Give SolidJS a tick to render
    await Promise.resolve();
    
    // Now there should be two panes rendered in the DOM, meaning 2 xterm containers
    // Note: Due to jsdom and mocks, we might not have .xterm classes. Let's check for the split divider.
    const dividers = container.querySelectorAll('.cursor-col-resize');
    expect(dividers.length).toBe(1);
  });
});
