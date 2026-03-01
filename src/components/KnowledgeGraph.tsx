import { onMount, onCleanup, createSignal, Show } from 'solid-js';
import * as d3 from 'd3';
import { getAllEntities, getAllLinks, entityLinkConfirm, entityLinkDelete, type EntitySearchResult, type EntityLinkRow } from '../lib/entityLinks';

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  title: string;
  type: string;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  id: string;
  relationship: string;
  auto_generated: boolean;
  confidence: number;
}

function KnowledgeGraph(props: { onClose: () => void }) {
  let svgRef: SVGSVGElement | undefined;
  const [loading, setLoading] = createSignal(true);
  const [selectedLink, setSelectedLink] = createSignal<GraphLink | null>(null);

  onMount(async () => {
    try {
      const [entities, links] = await Promise.all([
        getAllEntities(),
        getAllLinks()
      ]);

      if (!svgRef) return;

      const width = window.innerWidth;
      const height = window.innerHeight;

      const nodes: GraphNode[] = entities.map(e => ({
        id: e.id,
        title: e.title,
        type: e.entity_type
      }));

      const nodeMap = new Map(nodes.map(n => [n.id, n]));

      const graphLinks: GraphLink[] = links
        .filter(l => nodeMap.has(l.source_entity_id) && nodeMap.has(l.target_entity_id))
        .map(l => ({
          id: l.id,
          source: nodeMap.get(l.source_entity_id)!,
          target: nodeMap.get(l.target_entity_id)!,
          relationship: l.relationship_type,
          auto_generated: l.auto_generated,
          confidence: l.confidence
        }));

      const svg = d3.select(svgRef)
        .attr("viewBox", [0, 0, width, height] as any)
        .attr("width", width)
        .attr("height", height);

      const container = svg.append("g");

      // Zoom support
      svg.call(d3.zoom()
        .extent([[0, 0], [width, height]])
        .scaleExtent([0.1, 8])
        .on("zoom", (event) => {
          container.attr("transform", event.transform);
        }) as any);

      const simulation = d3.forceSimulation<GraphNode>(nodes)
        .force("link", d3.forceLink<GraphNode, GraphLink>(graphLinks).id(d => d.id).distance(100))
        .force("charge", d3.forceManyBody().strength(-300))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(50));

      const link = container.append("g")
        .selectAll("line")
        .data(graphLinks)
        .join("line")
        .attr("stroke", d => d.auto_generated ? "var(--color-accent)" : "var(--color-border)")
        .attr("stroke-opacity", d => d.auto_generated ? 0.8 : 0.6)
        .attr("stroke-width", d => d.auto_generated ? 1.5 : 1)
        .attr("stroke-dasharray", d => d.auto_generated ? "4,2" : "0")
        .attr("cursor", d => d.auto_generated ? "pointer" : "default")
        .on("click", (event, d) => {
          if (d.auto_generated) {
            setSelectedLink(d);
          }
        });

      const node = container.append("g")
        .selectAll(".node")
        .data(nodes)
        .join("g")
        .attr("class", "node")
        .call(d3.drag<any, GraphNode>()
          .on("start", dragstarted)
          .on("drag", dragged)
          .on("end", dragended) as any);

      // Node colors based on type
      const colorScale = d3.scaleOrdinal<string>()
        .domain(["note", "task", "function", "class", "struct", "file"])
        .range(["#6366f1", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#64748b"]);

      node.append("circle")
        .attr("r", 8)
        .attr("fill", d => colorScale(d.type) || "#999")
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.5);

      node.append("text")
        .attr("x", 12)
        .attr("y", 4)
        .text(d => d.title)
        .attr("fill", "var(--color-text-primary)")
        .attr("font-size", "10px")
        .attr("pointer-events", "none")
        .style("text-shadow", "0 1px 2px rgba(0,0,0,0.8)");

      simulation.on("tick", () => {
        link
          .attr("x1", d => (d.source as any).x)
          .attr("y1", d => (d.source as any).y)
          .attr("x2", d => (d.target as any).x)
          .attr("y2", d => (d.target as any).y);

        node
          .attr("transform", d => `translate(${d.x},${d.y})`);
      });

      function dragstarted(event: any) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
      }

      function dragged(event: any) {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
      }

      function dragended(event: any) {
        if (!event.active) simulation.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
      }

      setLoading(false);
    } catch (e) {
      console.error("Failed to load graph data:", e);
      setLoading(false);
    }
  });

  const handleConfirmLink = async () => {
    const link = selectedLink();
    if (!link) return;
    try {
      await entityLinkConfirm(link.id);
      setSelectedLink(null);
      window.location.reload();
    } catch (e) {
      console.error("Failed to confirm link:", e);
    }
  };

  const handleDismissLink = async () => {
    const link = selectedLink();
    if (!link) return;
    try {
      await entityLinkDelete(link.id);
      setSelectedLink(null);
      window.location.reload();
    } catch (e) {
      console.error("Failed to dismiss link:", e);
    }
  };

  return (
    <div class="fixed inset-0 bg-[var(--color-bg-primary)] z-[200] flex flex-col">
      <div class="h-12 flex items-center px-4 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0 justify-between">
        <div class="flex items-center space-x-4">
          <span class="font-bold text-sm uppercase tracking-widest">Knowledge Graph</span>
          <div class="flex items-center space-x-3 text-[10px]">
            <div class="flex items-center space-x-1">
              <div class="w-2 h-2 rounded-full bg-[#6366f1]" /> <span>Note</span>
            </div>
            <div class="flex items-center space-x-1">
              <div class="w-2 h-2 rounded-full bg-[#f59e0b]" /> <span>Task</span>
            </div>
            <div class="flex items-center space-x-1">
              <div class="w-2 h-2 rounded-full bg-[#10b981]" /> <span>Code</span>
            </div>
            <div class="h-3 w-px bg-[var(--color-border)] mx-1" />
            <div class="flex items-center space-x-1">
              <div class="w-3 h-[1px] bg-[var(--color-border)]" /> <span>Confirmed</span>
            </div>
            <div class="flex items-center space-x-1">
              <div class="w-3 h-[1px] border-t border-dashed border-[var(--color-accent)]" /> <span>Suggested</span>
            </div>
          </div>
        </div>
        <button 
          onClick={props.onClose}
          class="p-2 hover:bg-[var(--color-bg-panel)] rounded transition-colors text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="flex-1 relative overflow-hidden bg-black/20">
        <Show when={loading()}>
          <div class="absolute inset-0 flex items-center justify-center">
            <div class="flex flex-col items-center space-y-2">
              <div class="w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
              <span class="text-xs text-[var(--color-text-secondary)]">Simulating Knowledge...</span>
            </div>
          </div>
        </Show>
        <svg ref={svgRef} class="w-full h-full cursor-move" />

        {/* Link Suggestion Dialog */}
        <Show when={selectedLink()}>
          {(link) => (
            <div class="absolute bottom-6 left-1/2 -translate-x-1/2 w-80 bg-[var(--color-bg-panel)] border border-[var(--color-accent)]/50 rounded-lg shadow-2xl p-4 z-[210]">
              <div class="flex items-center justify-between mb-2">
                <span class="text-[10px] font-bold text-[var(--color-accent)] uppercase">Link Suggestion</span>
                <span class="text-[10px] text-[var(--color-text-secondary)]">Confidence: {(link().confidence * 100).toFixed(0)}%</span>
              </div>
              <div class="mb-4 space-y-2">
                <div class="flex items-center gap-2">
                  <div class="flex-1 text-xs truncate font-medium text-[var(--color-text-primary)]">{(link().source as any).title}</div>
                  <div class="text-[10px] text-[var(--color-text-secondary)]">→ {link().relationship} →</div>
                  <div class="flex-1 text-xs truncate font-medium text-[var(--color-text-primary)]">{(link().target as any).title}</div>
                </div>
              </div>
              <div class="flex gap-2">
                <button 
                  onClick={handleConfirmLink}
                  class="flex-1 px-3 py-1.5 bg-[var(--color-success)] text-white text-[10px] font-bold rounded hover:opacity-90 transition-opacity"
                >
                  Confirm
                </button>
                <button 
                  onClick={handleDismissLink}
                  class="flex-1 px-3 py-1.5 bg-[var(--color-bg-secondary)] text-[var(--color-error)] text-[10px] font-bold rounded border border-[var(--color-border)] hover:bg-red-950/20 transition-colors"
                >
                  Dismiss
                </button>
                <button 
                  onClick={() => setSelectedLink(null)}
                  class="px-2 py-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}

export default KnowledgeGraph;
