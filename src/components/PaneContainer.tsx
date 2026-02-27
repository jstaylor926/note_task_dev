import { Match, Switch } from 'solid-js';
import type { PaneNode } from '../lib/terminalState';
import XtermInstance from './XtermInstance';
import SplitContainer from './SplitContainer';

interface PaneContainerProps {
  node: PaneNode;
  activePaneId: string | null;
  onFocusPane: (paneId: string) => void;
}

function PaneContainer(props: PaneContainerProps) {
  return (
    <Switch>
      <Match when={props.node.type === 'pane' && props.node}>
        {(node) => {
          const pane = node() as PaneNode & { type: 'pane' };
          return (
            <div
              class={`h-full w-full relative ${
                props.activePaneId === pane.id
                  ? 'ring-1 ring-[var(--color-accent)] ring-inset'
                  : ''
              }`}
            >
              <XtermInstance
                sessionId={pane.sessionId}
                onFocus={() => props.onFocusPane(pane.id)}
              />
            </div>
          );
        }}
      </Match>
      <Match when={props.node.type === 'split' && props.node}>
        {(node) => {
          const split = node() as PaneNode & { type: 'split' };
          return (
            <SplitContainer
              direction={split.direction}
              sizes={split.sizes}
              activePaneId={props.activePaneId}
              onFocusPane={props.onFocusPane}
            >
              {split.children}
            </SplitContainer>
          );
        }}
      </Match>
    </Switch>
  );
}

export default PaneContainer;
