import { createSignal, onMount, For, Show } from "solid-js";
import { listProfiles, activateProfile, createProfile, type WorkspaceProfile } from "../lib/tauri";

function WorkspaceSwitcher() {
  const [profiles, setProfiles] = createSignal<WorkspaceProfile[]>([]);
  const [isOpen, setIsOpen] = createSignal(false);
  const [showCreate, setShowCreate] = createSignal(false);
  const [newProfileName, setNewProfileName] = createSignal("");
  const [newProfileDirs, setNewProfileDirs] = createSignal("");

  const loadProfiles = async () => {
    try {
      const list = await listProfiles();
      setProfiles(list);
    } catch (e) {
      console.error("Failed to load profiles:", e);
    }
  };

  onMount(loadProfiles);

  const activeProfile = () => profiles().find(p => p.is_active);

  const handleSwitch = async (id: string) => {
    try {
      await activateProfile(id);
      await loadProfiles();
      setIsOpen(false);
      // Reload page to re-initialize everything with new context
      window.location.reload();
    } catch (e) {
      console.error("Failed to switch profile:", e);
    }
  };

  const handleCreate = async (e: Event) => {
    e.preventDefault();
    try {
      await createProfile(newProfileName(), newProfileDirs());
      await loadProfiles();
      setShowCreate(false);
      setNewProfileName("");
      setNewProfileDirs("");
    } catch (e) {
      console.error("Failed to create profile:", e);
    }
  };

  return (
    <div class="relative">
      <button
        onClick={() => setIsOpen(!isOpen())}
        class="flex items-center space-x-2 px-2 py-1 rounded hover:bg-[var(--color-bg-panel)] border border-[var(--color-border)] transition-colors"
      >
        <span class="text-xs font-medium text-[var(--color-text-primary)]">
          {activeProfile()?.name || "Select Profile"}
        </span>
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m6 9 6 6 6-6"/>
        </svg>
      </button>

      <Show when={isOpen()}>
        <div class="absolute top-full left-0 mt-1 w-56 bg-[var(--color-bg-panel)] border border-[var(--color-border)] rounded shadow-lg z-50 overflow-hidden">
          <div class="p-2 border-b border-[var(--color-border)] flex justify-between items-center bg-[var(--color-bg-secondary)]">
            <span class="text-[10px] font-bold uppercase text-[var(--color-text-secondary)]">Workspaces</span>
            <button 
              onClick={() => setShowCreate(true)}
              class="text-[10px] text-[var(--color-accent)] hover:underline"
            >
              + New
            </button>
          </div>

          <div class="max-h-60 overflow-y-auto">
            <For each={profiles()}>
              {(p) => (
                <button
                  onClick={() => handleSwitch(p.id)}
                  class={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-[var(--color-accent)]/10 transition-colors ${p.is_active ? 'text-[var(--color-accent)] font-bold' : 'text-[var(--color-text-primary)]'}`}
                >
                  <span class="truncate">{p.name}</span>
                  <Show when={p.is_active}>
                    <div class="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
                  </Show>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Create Modal Overlay */}
      <Show when={showCreate()}>
        <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
          <div class="bg-[var(--color-bg-panel)] border border-[var(--color-border)] rounded-lg p-4 w-80 shadow-2xl">
            <h3 class="text-sm font-bold mb-4">Create New Workspace</h3>
            <form onSubmit={handleCreate} class="space-y-3">
              <div>
                <label class="block text-[10px] font-bold text-[var(--color-text-secondary)] uppercase mb-1">Name</label>
                <input
                  type="text"
                  required
                  value={newProfileName()}
                  onInput={(e) => setNewProfileName(e.currentTarget.value)}
                  placeholder="My Project"
                  class="w-full p-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded text-xs focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>
              <div>
                <label class="block text-[10px] font-bold text-[var(--color-text-secondary)] uppercase mb-1">Watched Directories</label>
                <textarea
                  required
                  value={newProfileDirs()}
                  onInput={(e) => setNewProfileDirs(e.currentTarget.value)}
                  placeholder="/path/to/project (one per line)"
                  class="w-full p-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded text-xs focus:outline-none focus:border-[var(--color-accent)] min-h-[80px]"
                />
              </div>
              <div class="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  class="px-3 py-1.5 text-xs rounded hover:bg-[var(--color-bg-secondary)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class="px-3 py-1.5 text-xs rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>
    </div>
  );
}

export default WorkspaceSwitcher;
