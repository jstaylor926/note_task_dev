import { createStore, produce } from 'solid-js/store';

export type PaneNode =
  | { type: 'pane'; id: string; sessionId: string }
  | {
      type: 'split';
      id: string;
      direction: 'horizontal' | 'vertical';
      children: PaneNode[];
      sizes: number[];
    };

export interface TerminalTab {
  id: string;
  title: string;
  layout: PaneNode;
}

interface TerminalState {
  tabs: TerminalTab[];
  activeTabIndex: number;
  activePaneId: string | null;
}

let nextId = 0;
function genId(prefix: string): string {
  return `${prefix}-${++nextId}`;
}

export function resetIdCounter() {
  nextId = 0;
}

export function createTerminalStore() {
  const [state, setState] = createStore<TerminalState>({
    tabs: [],
    activeTabIndex: 0,
    activePaneId: null,
  });

  function createPane(): PaneNode {
    const id = genId('pane');
    return { type: 'pane', id, sessionId: genId('session') };
  }

  function addTab() {
    const pane = createPane();
    const tab: TerminalTab = {
      id: genId('tab'),
      title: `Terminal ${state.tabs.length + 1}`,
      layout: pane,
    };
    setState(
      produce((s) => {
        s.tabs.push(tab);
        s.activeTabIndex = s.tabs.length - 1;
        s.activePaneId = pane.id;
      }),
    );
  }

  function removeTab(tabId: string) {
    setState(
      produce((s) => {
        const idx = s.tabs.findIndex((t) => t.id === tabId);
        if (idx === -1) return;
        s.tabs.splice(idx, 1);
        if (s.tabs.length === 0) {
          s.activeTabIndex = 0;
          s.activePaneId = null;
        } else if (s.activeTabIndex >= s.tabs.length) {
          s.activeTabIndex = s.tabs.length - 1;
          s.activePaneId = getFirstPaneId(s.tabs[s.activeTabIndex].layout);
        } else {
          s.activePaneId = getFirstPaneId(s.tabs[s.activeTabIndex].layout);
        }
      }),
    );
  }

  function setActiveTab(index: number) {
    setState(
      produce((s) => {
        if (index >= 0 && index < s.tabs.length) {
          s.activeTabIndex = index;
          s.activePaneId = getFirstPaneId(s.tabs[index].layout);
        }
      }),
    );
  }

  function setActivePaneId(paneId: string) {
    setState('activePaneId', paneId);
  }

  function splitPane(
    tabId: string,
    paneId: string,
    direction: 'horizontal' | 'vertical',
  ) {
    setState(
      produce((s) => {
        const tab = s.tabs.find((t) => t.id === tabId);
        if (!tab) return;
        const newPane = createPane();
        tab.layout = splitNode(tab.layout, paneId, direction, newPane);
        s.activePaneId = newPane.id;
      }),
    );
  }

  function closePane(tabId: string, paneId: string) {
    setState(
      produce((s) => {
        const tabIdx = s.tabs.findIndex((t) => t.id === tabId);
        if (tabIdx === -1) return;
        const tab = s.tabs[tabIdx];

        // If the layout is just a single pane, remove the tab
        if (tab.layout.type === 'pane' && tab.layout.id === paneId) {
          s.tabs.splice(tabIdx, 1);
          if (s.tabs.length === 0) {
            s.activeTabIndex = 0;
            s.activePaneId = null;
          } else if (s.activeTabIndex >= s.tabs.length) {
            s.activeTabIndex = s.tabs.length - 1;
            s.activePaneId = getFirstPaneId(s.tabs[s.activeTabIndex].layout);
          }
          return;
        }

        // Remove pane from split, collapsing parent if only one child remains
        tab.layout = removeNode(tab.layout, paneId);
        s.activePaneId = getFirstPaneId(tab.layout);
      }),
    );
  }

  return {
    state,
    addTab,
    removeTab,
    setActiveTab,
    setActivePaneId,
    splitPane,
    closePane,
  };
}

function getFirstPaneId(node: PaneNode): string | null {
  if (node.type === 'pane') return node.id;
  if (node.children.length > 0) return getFirstPaneId(node.children[0]);
  return null;
}

function splitNode(
  node: PaneNode,
  targetId: string,
  direction: 'horizontal' | 'vertical',
  newPane: PaneNode,
): PaneNode {
  if (node.type === 'pane') {
    if (node.id === targetId) {
      return {
        type: 'split',
        id: genId('split'),
        direction,
        children: [node, newPane],
        sizes: [50, 50],
      };
    }
    return node;
  }

  // Recurse into split children
  return {
    ...node,
    children: node.children.map((child) =>
      splitNode(child, targetId, direction, newPane),
    ),
  };
}

function removeNode(node: PaneNode, targetId: string): PaneNode {
  if (node.type === 'pane') return node;

  const filtered = node.children.filter((child) => {
    if (child.type === 'pane') return child.id !== targetId;
    return true;
  });

  // Recurse into remaining split children
  const recursed = filtered.map((child) => removeNode(child, targetId));

  // If only one child remains, collapse the split
  if (recursed.length === 1) return recursed[0];

  // Redistribute sizes
  const equalSize = 100 / recursed.length;
  return {
    ...node,
    children: recursed,
    sizes: recursed.map(() => equalSize),
  };
}
