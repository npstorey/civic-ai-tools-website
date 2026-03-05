'use client';

import { useEffect, useRef, useImperativeHandle, forwardRef, useState, useCallback } from 'react';
import './bpmn-diagram.css';

export interface BpmnViewerHandle {
  activateNode: (id: string) => void;
  completeNode: (id: string) => void;
  activateEdge: (id: string) => void;
  highlightEdge: (id: string, style: 'loop-back' | 'success') => void;
  showOverlay: (nodeId: string, html: string) => void;
  clearOverlays: () => void;
  resetAll: () => void;
  fitToView: () => void;
}

interface BpmnViewerProps {
  onReady?: () => void;
  isFullscreen?: boolean;
}

const LANE_COLORS: Record<string, string> = {
  Participant_Browser: 'rgba(16, 63, 239, 0.06)',      // nyc-blue-40
  Participant_AI: 'rgba(147, 51, 234, 0.06)',           // light purple (no NYC equivalent)
  Participant_MCP: 'rgba(0, 138, 2, 0.06)',             // nyc-success
  Participant_Socrata: 'rgba(255, 179, 32, 0.06)',      // nyc-caution
  Participant_Narration: 'rgba(117, 117, 117, 0.06)',   // text-muted
};

const ALL_ELEMENTS = [
  'event_start', 'event_end',
  'task_ai_reads', 'task_ai_plans', 'task_ai_constructs_call',
  'task_mcp_translates', 'task_socrata_executes',
  'task_results_return', 'gateway_enough_data', 'task_ai_synthesizes',
  'task_narration_translate',
];

const ALL_EDGES = [
  'flow_start_to_reads', 'flow_reads_to_plans', 'flow_plans_to_construct',
  'flow_construct_to_mcp', 'flow_construct_out', 'flow_mcp_to_socrata',
  'flow_socrata_to_return', 'flow_return_to_gateway',
  'flow_loop_back', 'flow_to_synthesis', 'flow_synthesis_to_end',
  'flow_tool_to_narration',
];

const ALL_MARKERS = ['bpmn-active', 'bpmn-completed', 'bpmn-active-flow', 'bpmn-loop-back', 'bpmn-success-flow'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyLaneColors(viewer: any) {
  try {
    const overlays = viewer.get('overlays');
    const elementRegistry = viewer.get('elementRegistry');
    for (const [laneId, color] of Object.entries(LANE_COLORS)) {
      const el = elementRegistry.get(laneId);
      if (!el) continue;
      overlays.add(laneId, 'lane-bg', {
        position: { top: 0, left: 0 },
        html: `<div style="width:${el.width}px;height:${el.height}px;background:${color};pointer-events:none;"></div>`,
      });
    }
  } catch {
    // Lane coloring is purely decorative — fail silently
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeLoopBackHeavier(viewer: any) {
  try {
    const canvas = viewer.get('canvas');
    canvas.addMarker('flow_loop_back', 'bpmn-loop-back-default');
  } catch { /* ignore */ }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fitToContainer(viewer: any, container: HTMLDivElement) {
  try {
    const canvas = viewer.get('canvas');
    const viewbox = canvas.viewbox();
    const inner = viewbox.inner;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw === 0 || ch === 0) return;

    const pad = 40;
    const scaleX = (cw - pad * 2) / inner.width;
    const scaleY = (ch - pad * 2) / inner.height;
    const zoom = Math.min(scaleX, scaleY);

    const dx = (cw - inner.width * zoom) / 2 - inner.x * zoom;
    const dy = (ch - inner.height * zoom) / 2 - inner.y * zoom;

    canvas.viewbox({
      x: -dx / zoom,
      y: -dy / zoom,
      width: cw / zoom,
      height: ch / zoom,
    });
  } catch {
    try { viewer.get('canvas').zoom('fit-viewport'); } catch { /* ignore */ }
  }
}

const BpmnViewerComponent = forwardRef<BpmnViewerHandle, BpmnViewerProps>(
  function BpmnViewerComponent({ onReady, isFullscreen }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const viewerRef = useRef<any>(null);
    const overlayIdsRef = useRef<string[]>([]);
    const [zoomLevel, setZoomLevel] = useState(1);

    const doFit = useCallback(() => {
      if (viewerRef.current && containerRef.current) {
        fitToContainer(viewerRef.current, containerRef.current);
        try {
          const vb = viewerRef.current.get('canvas').viewbox();
          setZoomLevel(vb.scale);
        } catch { /* ignore */ }
      }
    }, []);

    useImperativeHandle(ref, () => ({
      activateNode(id: string) {
        const canvas = viewerRef.current?.get('canvas');
        if (!canvas?.addMarker) return;
        try { canvas.removeMarker(id, 'bpmn-completed'); } catch { /* ignore */ }
        canvas.addMarker(id, 'bpmn-active');
      },
      completeNode(id: string) {
        const canvas = viewerRef.current?.get('canvas');
        if (!canvas?.addMarker) return;
        try { canvas.removeMarker(id, 'bpmn-active'); } catch { /* ignore */ }
        canvas.addMarker(id, 'bpmn-completed');
      },
      activateEdge(id: string) {
        const canvas = viewerRef.current?.get('canvas');
        canvas?.addMarker?.(id, 'bpmn-active-flow');
      },
      highlightEdge(id: string, style: 'loop-back' | 'success') {
        const canvas = viewerRef.current?.get('canvas');
        const cls = style === 'loop-back' ? 'bpmn-loop-back' : 'bpmn-success-flow';
        canvas?.addMarker?.(id, cls);
      },
      showOverlay(nodeId: string, html: string) {
        const overlays = viewerRef.current?.get('overlays');
        if (!overlays?.add) return;
        try {
          const overlayId = overlays.add(nodeId, 'animation', {
            position: { top: -12, right: -12 },
            html: `<div class="bpmn-overlay">${html}</div>`,
          });
          if (overlayId) overlayIdsRef.current.push(overlayId);
        } catch { /* ignore */ }
      },
      clearOverlays() {
        const overlays = viewerRef.current?.get('overlays');
        if (!overlays?.remove) return;
        for (const id of overlayIdsRef.current) {
          try { overlays.remove(id); } catch { /* ignore */ }
        }
        overlayIdsRef.current = [];
      },
      resetAll() {
        this.clearOverlays();
        const canvas = viewerRef.current?.get('canvas');
        if (!canvas?.removeMarker) return;
        for (const el of [...ALL_ELEMENTS, ...ALL_EDGES]) {
          for (const marker of ALL_MARKERS) {
            try { canvas.removeMarker(el, marker); } catch { /* ignore */ }
          }
        }
      },
      fitToView: doFit,
    }));

    useEffect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let viewer: any = null;
      let destroyed = false;

      async function init() {
        if (!containerRef.current) return;

        // NavigatedViewer includes ZoomScroll + MoveCanvas + KeyboardMove
        const { default: NavigatedViewer } = await import('bpmn-js/lib/NavigatedViewer');
        if (destroyed) return;

        viewer = new NavigatedViewer({ container: containerRef.current });
        viewerRef.current = viewer;

        try {
          const response = await fetch('/bpmn/mcp-query-flow.bpmn');
          const xml = await response.text();
          await viewer.importXML(xml);

          applyLaneColors(viewer);
          makeLoopBackHeavier(viewer);

          // Wait for layout, then fit
          requestAnimationFrame(() => {
            if (destroyed || !containerRef.current) return;
            fitToContainer(viewer, containerRef.current);
            try {
              const vb = viewer.get('canvas').viewbox();
              setZoomLevel(vb.scale);
            } catch { /* ignore */ }
            onReady?.();
          });
        } catch (err) {
          console.error('Failed to load BPMN diagram:', err);
        }
      }

      init();

      return () => {
        destroyed = true;
        if (viewer) {
          try { viewer.destroy(); } catch { /* ignore */ }
        }
      };
    }, [onReady]);

    // Re-fit on resize or fullscreen toggle
    useEffect(() => {
      // Delay slightly so container dimensions have settled
      const t = setTimeout(doFit, 100);
      return () => clearTimeout(t);
    }, [isFullscreen, doFit]);

    useEffect(() => {
      function handleResize() { doFit(); }
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }, [doFit]);

    // Track zoom level for display
    useEffect(() => {
      if (!viewerRef.current) return;
      try {
        const eventBus = viewerRef.current.get('eventBus');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (e: any) => { if (e.viewbox) setZoomLevel(e.viewbox.scale); };
        eventBus.on('canvas.viewbox.changed', handler);
        return () => { try { eventBus.off('canvas.viewbox.changed', handler); } catch { /* ignore */ } };
      } catch { /* ignore */ }
    }, []);

    const handleZoomIn = useCallback(() => {
      try {
        const canvas = viewerRef.current?.get('canvas');
        const current = canvas.viewbox().scale;
        canvas.zoom(current * 1.3, { x: containerRef.current!.clientWidth / 2, y: containerRef.current!.clientHeight / 2 });
      } catch { /* ignore */ }
    }, []);

    const handleZoomOut = useCallback(() => {
      try {
        const canvas = viewerRef.current?.get('canvas');
        const current = canvas.viewbox().scale;
        canvas.zoom(current / 1.3, { x: containerRef.current!.clientWidth / 2, y: containerRef.current!.clientHeight / 2 });
      } catch { /* ignore */ }
    }, []);

    return (
      <div className={`bpmn-container-wrapper${isFullscreen ? ' bpmn-fullscreen' : ''}`} style={{ position: 'relative', height: '100%' }}>
        <div
          ref={containerRef}
          className="bpmn-container"
          role="img"
          aria-label="BPMN diagram showing how an MCP query flows from the browser through the AI model, MCP server, and data source"
          style={{ width: '100%', height: '100%' }}
        />

        {/* Zoom controls — top right of diagram */}
        <div className="bpmn-zoom-controls">
          <button onClick={handleZoomIn} title="Zoom in" aria-label="Zoom in">+</button>
          <button onClick={handleZoomOut} title="Zoom out" aria-label="Zoom out">&minus;</button>
          <button onClick={doFit} title="Fit to viewport" aria-label="Fit to viewport">&#x2750;</button>
          <span className="bpmn-zoom-level">{Math.round(zoomLevel * 100)}%</span>
        </div>

        {/* Interaction hint */}
        {!isFullscreen && (
          <div className="bpmn-interaction-hint">
            Scroll to zoom &middot; Drag to pan
          </div>
        )}
      </div>
    );
  }
);

export default BpmnViewerComponent;
