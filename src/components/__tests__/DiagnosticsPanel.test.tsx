import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { invoke } from '@tauri-apps/api/core';

const mockDiagnostics = {
  generated_at_epoch_sec: 1_700_000_000,
  sidecar_process_status: 'Healthy',
  health: {
    tauri: 'ok',
    sidecar: 'ok',
    sqlite: 'ok',
    lancedb: 'ok',
  },
  indexing: {
    completed: 10,
    total: 10,
    current_file: null,
    is_idle: true,
  },
  active_profile_id: 'default',
  project_root: '/tmp/project',
  git_branch: 'main',
  remote_access: {
    enabled: false,
    port: 9401,
    paired_device_count: 0,
  },
  recent_audit_events: [
    {
      event_type: 'remote_access.enabled_changed',
      actor: 'local_user',
      trace_id: null,
      created_at: '2026-03-07 12:00:00',
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DiagnosticsPanel', () => {
  it('loads and renders startup diagnostics', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === 'startup_diagnostics') {
        return Promise.resolve(mockDiagnostics);
      }
      return Promise.resolve(null);
    });

    const { default: DiagnosticsPanel } = await import('../DiagnosticsPanel');
    const { container } = render(() => <DiagnosticsPanel />);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('startup_diagnostics');
      expect(container.textContent).toContain('Healthy');
      expect(container.textContent).toContain('default');
      expect(container.textContent).toContain('remote_access.enabled_changed');
    });
  });

  it('refreshes diagnostics on refresh click', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockDiagnostics);
    const { default: DiagnosticsPanel } = await import('../DiagnosticsPanel');
    const { getByText, queryByText } = render(() => <DiagnosticsPanel />);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('startup_diagnostics');
      expect(queryByText('Refresh')).toBeTruthy();
    });

    fireEvent.click(getByText('Refresh'));

    await waitFor(() => {
      const calls = (invoke as ReturnType<typeof vi.fn>).mock.calls
        .filter((call) => call[0] === 'startup_diagnostics').length;
      expect(calls).toBeGreaterThanOrEqual(2);
    });
  });

  it('exports diagnostics and shows export path', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === 'startup_diagnostics') {
        return Promise.resolve(mockDiagnostics);
      }
      if (cmd === 'diagnostics_export') {
        return Promise.resolve('/tmp/startup-diagnostics-1700000000.json');
      }
      return Promise.resolve(null);
    });

    const { default: DiagnosticsPanel } = await import('../DiagnosticsPanel');
    const { getByText, container } = render(() => <DiagnosticsPanel />);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('startup_diagnostics');
    });

    fireEvent.click(getByText('Export'));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('diagnostics_export');
      expect(container.textContent).toContain('/tmp/startup-diagnostics-1700000000.json');
    });
  });
});
