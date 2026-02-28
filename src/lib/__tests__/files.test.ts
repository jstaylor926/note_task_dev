import { describe, it, expect, vi, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

afterEach(() => {
  vi.clearAllMocks();
});

describe('files lib', () => {
  it('fileRead calls invoke with correct args', async () => {
    const mockResponse = {
      content: 'Hello, world!',
      size: 13,
      extension: 'txt',
      path: '/tmp/hello.txt',
    };
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);
    const { fileRead } = await import('../files');
    const result = await fileRead('/tmp/hello.txt');
    expect(invoke).toHaveBeenCalledWith('file_read', { path: '/tmp/hello.txt' });
    expect(result).toEqual(mockResponse);
  });

  it('fileWrite calls invoke with path and content', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { fileWrite } = await import('../files');
    await fileWrite('/tmp/out.txt', 'New content');
    expect(invoke).toHaveBeenCalledWith('file_write', {
      path: '/tmp/out.txt',
      content: 'New content',
    });
  });

  it('fileListDirectory calls invoke with path', async () => {
    const mockEntries = [
      { name: 'src', path: '/tmp/src', is_dir: true, extension: null, size: 0 },
      { name: 'main.rs', path: '/tmp/main.rs', is_dir: false, extension: 'rs', size: 100 },
    ];
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockEntries);
    const { fileListDirectory } = await import('../files');
    const result = await fileListDirectory('/tmp');
    expect(invoke).toHaveBeenCalledWith('file_list_directory', { path: '/tmp' });
    expect(result).toEqual(mockEntries);
  });

  it('fileStat calls invoke with path', async () => {
    const mockStat = {
      path: '/tmp/hello.txt',
      size: 13,
      is_dir: false,
      is_file: true,
      extension: 'txt',
      readonly: false,
    };
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockStat);
    const { fileStat } = await import('../files');
    const result = await fileStat('/tmp/hello.txt');
    expect(invoke).toHaveBeenCalledWith('file_stat', { path: '/tmp/hello.txt' });
    expect(result).toEqual(mockStat);
  });

  it('fileRead propagates errors', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('File not found'));
    const { fileRead } = await import('../files');
    await expect(fileRead('/nonexistent')).rejects.toThrow('File not found');
  });
});
