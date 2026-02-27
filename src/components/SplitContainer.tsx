import { For, createSignal } from 'solid-js';
import type { PaneNode } from '../lib/terminalState';
import PaneContainer from './PaneContainer';

interface SplitContainerProps {
  direction: 'horizontal' | 'vertical';
  sizes: number[];
  children: PaneNode[];
  activePaneId: string | null;
  onFocusPane: (paneId: string) => void;
}

function SplitContainer(props: SplitContainerProps) {
  const [localSizes, setLocalSizes] = createSignal<number[]>(props.sizes);

  function handleDividerMouseDown(dividerIndex: number, e: MouseEvent) {
    e.preventDefault();
    const startPos =
      props.direction === 'vertical' ? e.clientX : e.clientY;
    const startSizes = [...localSizes()];
    const container = (e.target as HTMLElement).parentElement;
    if (!container) return;

    const totalSize =
      props.direction === 'vertical'
        ? container.clientWidth
        : container.clientHeight;

    function onMouseMove(moveEvent: MouseEvent) {
      const currentPos =
        props.direction === 'vertical'
          ? moveEvent.clientX
          : moveEvent.clientY;
      const delta = ((currentPos - startPos) / totalSize) * 100;

      const newSizes = [...startSizes];
      const minSize = 10; // minimum 10% per pane

      newSizes[dividerIndex] = Math.max(
        minSize,
        startSizes[dividerIndex] + delta,
      );
      newSizes[dividerIndex + 1] = Math.max(
        minSize,
        startSizes[dividerIndex + 1] - delta,
      );

      // Normalize
      const total = newSizes.reduce((a, b) => a + b, 0);
      setLocalSizes(newSizes.map((s) => (s / total) * 100));
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor =
      props.direction === 'vertical' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }

  return (
    <div
      class={`h-full w-full flex ${
        props.direction === 'vertical' ? 'flex-row' : 'flex-col'
      }`}
    >
      <For each={props.children}>
        {(child, index) => (
          <>
            <div
              style={{
                [props.direction === 'vertical' ? 'width' : 'height']:
                  `${localSizes()[index()]}%`,
                'min-width': props.direction === 'vertical' ? '40px' : undefined,
                'min-height': props.direction === 'horizontal' ? '40px' : undefined,
              }}
              class="overflow-hidden"
            >
              <PaneContainer
                node={child}
                activePaneId={props.activePaneId}
                onFocusPane={props.onFocusPane}
              />
            </div>
            {index() < props.children.length - 1 && (
              <div
                class={`shrink-0 bg-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors ${
                  props.direction === 'vertical'
                    ? 'w-1 cursor-col-resize'
                    : 'h-1 cursor-row-resize'
                }`}
                onMouseDown={(e) => handleDividerMouseDown(index(), e)}
              />
            )}
          </>
        )}
      </For>
    </div>
  );
}

export default SplitContainer;
