import { describe, it, expect, vi, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

afterEach(() => {
  vi.clearAllMocks();
});

describe('pty lib', () => {
  it('ptyCreate calls invoke with correct args', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { ptyCreate } = await import('../pty');
    await ptyCreate('session-1', '/tmp');
    expect(invoke).toHaveBeenCalledWith('pty_create', {
      sessionId: 'session-1',
      cwd: '/tmp',
    });
  });

  it('ptyWrite calls invoke with base64 data', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { ptyWrite } = await import('../pty');
    await ptyWrite('session-1', 'aGVsbG8=');
    expect(invoke).toHaveBeenCalledWith('pty_write', {
      sessionId: 'session-1',
      data: 'aGVsbG8=',
    });
  });

  it('ptyResize calls invoke with cols and rows', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { ptyResize } = await import('../pty');
    await ptyResize('session-1', 120, 40);
    expect(invoke).toHaveBeenCalledWith('pty_resize', {
      sessionId: 'session-1',
      cols: 120,
      rows: 40,
    });
  });

  it('ptyKill calls invoke with session id', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { ptyKill } = await import('../pty');
    await ptyKill('session-1');
    expect(invoke).toHaveBeenCalledWith('pty_kill', {
      sessionId: 'session-1',
    });
  });

  it('onPtyOutput registers event listener', async () => {
    const { onPtyOutput } = await import('../pty');
    const callback = vi.fn();
    await onPtyOutput(callback);
    expect(listen).toHaveBeenCalledWith('pty:output', expect.any(Function));
  });

  it('onPtyExit registers event listener', async () => {
    const { onPtyExit } = await import('../pty');
    const callback = vi.fn();
    await onPtyExit(callback);
    expect(listen).toHaveBeenCalledWith('pty:exit', expect.any(Function));
  });
});
