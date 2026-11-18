import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Minus, MousePointer2, Plus, Trash2, X } from 'lucide-react';
import type { ModuleInstance, Project } from '../types';
import { moduleByType } from '../modules/registry';

const NODE_WIDTH = 236;
const PORT_TOP = 52;
const PORT_STEP = 27;
const PORT_CENTER = 13;

type PendingPort = { moduleId: string; port: string };
type DragState = { kind: 'module'; moduleId: string; startX: number; startY: number; originX: number; originY: number } | { kind: 'pan'; startX: number; startY: number; originX: number; originY: number };
interface Props {
  project: Project; selectedModuleId: string | null; selectedConnectionId: string | null;
  moduleErrors: Record<string, string>; isStale: boolean;
  onAddModule: (type: string, x?: number, y?: number) => void;
  onMoveModule: (id: string, x: number, y: number) => void;
  onConnect: (sourceModuleId: string, sourcePort: string, targetModuleId: string, targetPort: string) => boolean;
  onSelectModule: (id: string | null) => void; onSelectConnection: (id: string | null) => void;
  onDeleteModule: (id: string) => void; onDeleteConnection: (id: string) => void; onViewChange: (zoom: number, panX: number, panY: number) => void;
}

export function Workspace(props: Props) {
  const { project } = props;
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [pending, setPending] = useState<PendingPort | null>(null);
  const [pointer, setPointer] = useState({ x: 480, y: 270 });
  const [dragPosition, setDragPosition] = useState<{ id: string; x: number; y: number } | null>(null);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const positionOf = (module: ModuleInstance) => dragPosition?.id === module.id ? dragPosition : module;
  const selectedConnection = project.connections.find((edge) => edge.id === props.selectedConnectionId) ?? null;

  const portPoint = (module: ModuleInstance, direction: 'input' | 'output', portName: string) => {
    const definition = moduleByType.get(module.type);
    const ports = direction === 'input' ? definition?.inputs : definition?.outputs;
    const index = ports?.findIndex((item) => item.name === portName) ?? -1;
    const position = positionOf(module);
    return { x: position.x + (direction === 'output' ? NODE_WIDTH : 0), y: position.y + PORT_TOP + (Math.max(0, index) * PORT_STEP) + PORT_CENTER };
  };
  const worldFromClient = (clientX: number, clientY: number) => {
    const bounds = viewportRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return { x: (clientX - bounds.left - project.view.panX) / project.view.zoom, y: (clientY - bounds.top - project.view.panY) / project.view.zoom };
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'Escape') { setPending(null); setConnectionNotice(null); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (props.selectedConnectionId) props.onDeleteConnection(props.selectedConnectionId);
        else if (props.selectedModuleId) props.onDeleteModule(props.selectedModuleId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [props.selectedConnectionId, props.selectedModuleId, props.onDeleteConnection, props.onDeleteModule]);

  const beginCable = (event: React.MouseEvent, moduleId: string, port: string) => {
    event.stopPropagation();
    setPending({ moduleId, port });
    setConnectionNotice('Select a compatible input terminal to complete the lead.');
    props.onSelectConnection(null);
  };
  const finishCable = (event: React.MouseEvent, moduleId: string, port: string) => {
    event.stopPropagation();
    if (!pending) return;
    const accepted = props.onConnect(pending.moduleId, pending.port, moduleId, port);
    if (accepted) { setPending(null); setConnectionNotice('Patch lead connected to the simulation graph.'); }
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const location = worldFromClient(event.clientX, event.clientY);
    setPointer(location);
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === 'module') {
      setDragPosition({ id: drag.moduleId, x: drag.originX + (event.clientX - drag.startX) / project.view.zoom, y: drag.originY + (event.clientY - drag.startY) / project.view.zoom });
    } else {
      props.onViewChange(project.view.zoom, drag.originX + event.clientX - drag.startX, drag.originY + event.clientY - drag.startY);
    }
  };
  const endDrag = () => {
    const drag = dragRef.current;
    if (drag?.kind === 'module' && dragPosition?.id === drag.moduleId) props.onMoveModule(drag.moduleId, dragPosition.x, dragPosition.y);
    dragRef.current = null;
    setDragPosition(null);
  };
  const startModuleDrag = (event: React.PointerEvent, module: ModuleInstance) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    props.onSelectModule(module.id);
    props.onSelectConnection(null);
    dragRef.current = { kind: 'module', moduleId: module.id, startX: event.clientX, startY: event.clientY, originX: module.x, originY: module.y };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const zoomAtCenter = (delta: number) => {
    const bounds = viewportRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const centerX = bounds.width / 2;
    const centerY = bounds.height / 2;
    const zoom = Math.max(0.45, Math.min(2.2, project.view.zoom + delta));
    const worldX = (centerX - project.view.panX) / project.view.zoom;
    const worldY = (centerY - project.view.panY) / project.view.zoom;
    props.onViewChange(zoom, centerX - worldX * zoom, centerY - worldY * zoom);
  };

  const cablePaths = useMemo(() => project.connections.map((edge) => {
    const fromModule = project.modules.find((item) => item.id === edge.sourceModuleId);
    const toModule = project.modules.find((item) => item.id === edge.targetModuleId);
    if (!fromModule || !toModule) return null;
    const start = portPoint(fromModule, 'output', edge.sourcePort);
    const end = portPoint(toModule, 'input', edge.targetPort);
    const tension = Math.max(46, Math.abs(end.x - start.x) * 0.42);
    return { edge, d: `M ${start.x} ${start.y} C ${start.x + tension} ${start.y}, ${end.x - tension} ${end.y}, ${end.x} ${end.y}` };
  }), [project.connections, project.modules, dragPosition]);
  const pendingModule = pending ? project.modules.find((item) => item.id === pending.moduleId) : null;
  const pendingStart = pending && pendingModule ? portPoint(pendingModule, 'output', pending.port) : null;

  return (
    <div className="bench-wrap">
      <div ref={viewportRef} className={`bench-viewport ${pending ? 'patching' : ''}`} onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('.module-node, .cable-path, .bench-controls, .bench-hint')) return;
        dragRef.current = { kind: 'pan', startX: event.clientX, startY: event.clientY, originX: project.view.panX, originY: project.view.panY };
        props.onSelectModule(null); props.onSelectConnection(null);
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={handlePointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onWheel={(event) => {
        event.preventDefault();
        const bounds = viewportRef.current?.getBoundingClientRect(); if (!bounds) return;
        const localX = event.clientX - bounds.left; const localY = event.clientY - bounds.top;
        const next = Math.max(0.45, Math.min(2.2, project.view.zoom * (event.deltaY < 0 ? 1.08 : 0.92)));
        const worldX = (localX - project.view.panX) / project.view.zoom; const worldY = (localY - project.view.panY) / project.view.zoom;
        props.onViewChange(next, localX - worldX * next, localY - worldY * next);
      }} onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-telecom-module')) event.preventDefault(); }} onDrop={(event) => {
        event.preventDefault();
        const type = event.dataTransfer.getData('application/x-telecom-module');
        if (type) { const point = worldFromClient(event.clientX, event.clientY); props.onAddModule(type, point.x - NODE_WIDTH / 2, point.y - 40); }
      }}>
        <div className="bench-grid" />
        <div className="bench-controls">
          <div className="bench-coordinates"><Crosshair size={13} /><span>VIRTUAL PATCH BENCH</span><i />{project.modules.length} BLOCK{project.modules.length === 1 ? '' : 'S'}<i />{project.connections.length} LEAD{project.connections.length === 1 ? '' : 'S'}</div>
          <div className="bench-zoom"><button className="icon-button" title="Zoom out" onClick={() => zoomAtCenter(-0.1)}><Minus size={15} /></button><span>{Math.round(project.view.zoom * 100)}%</span><button className="icon-button" title="Zoom in" onClick={() => zoomAtCenter(0.1)}><Plus size={15} /></button><span className="tool-separator" /><button className="icon-button" title="Reset view" onClick={() => props.onViewChange(1, 0, 0)}><MousePointer2 size={15} /></button></div>
        </div>
        <div className="bench-hint"><span className="hint-key">DRAG</span> modules from rack <span className="hint-sep">·</span> <span className="hint-key">PATCH</span> output → input <span className="hint-sep">·</span> scroll to zoom <span className="hint-sep">·</span> drag empty bench to pan</div>
        <div className="world" style={{ width: 4200, height: 2600, transform: `translate(${project.view.panX}px, ${project.view.panY}px) scale(${project.view.zoom})` }}>
          <svg className="cables-layer" width="4200" height="2600" aria-label="Patch cables">
            {cablePaths.map((item) => item && <g key={item.edge.id} onClick={(event) => { event.stopPropagation(); props.onSelectConnection(item.edge.id); props.onSelectModule(null); }} className="cable-group">
              <path d={item.d} className="cable-hitbox" />
              <path d={item.d} className={`cable-path ${props.selectedConnectionId === item.edge.id ? 'selected' : ''}`} />
            </g>)}
            {pendingStart && <path d={`M ${pendingStart.x} ${pendingStart.y} C ${pendingStart.x + 60} ${pendingStart.y}, ${pointer.x - 40} ${pointer.y}, ${pointer.x} ${pointer.y}`} className="cable-path cable-preview" />}
          </svg>
          {project.modules.map((module) => {
            const definition = moduleByType.get(module.type)!;
            const position = positionOf(module);
            const rowCount = Math.max(definition.inputs.length, definition.outputs.length, 1);
            const isSelected = props.selectedModuleId === module.id;
            const error = props.moduleErrors[module.id];
            const inputConnected = (portName: string) => project.connections.some((edge) => edge.targetModuleId === module.id && edge.targetPort === portName);
            const outputConnected = (portName: string) => project.connections.some((edge) => edge.sourceModuleId === module.id && edge.sourcePort === portName);
            const readouts = definition.parameters.slice(0, 3).map((parameter) => {
              const value = module.parameters[parameter.key];
              if (parameter.kind === 'select') return String(value).toUpperCase();
              const numeric = Number(value);
              if (parameter.unit === 'Hz') return numeric >= 1000 ? `${(numeric / 1000).toFixed(numeric % 1000 === 0 ? 0 : 1)} kHz` : `${numeric} Hz`;
              return `${numeric.toFixed(2)}${parameter.unit ?? ''}`;
            });
            return <div key={module.id} className={`module-node ${isSelected ? 'selected' : ''} ${error ? 'has-error' : ''}`} style={{ left: position.x, top: position.y, width: NODE_WIDTH }} onClick={(event) => { event.stopPropagation(); props.onSelectModule(module.id); props.onSelectConnection(null); }}>
              <div className="module-face" onPointerDown={(event) => startModuleDrag(event, module)}>
                <div className="node-brand"><span className="node-code">{definition.shortName}</span><span className={`node-led ${error ? 'led-error' : props.isStale ? '' : 'led-on'}`} /><span className="node-title">{definition.name}</span><span className="node-grab">⠿</span></div>
                <div className="node-subtitle">{definition.category.toUpperCase()} <span>·</span> ANALOG PATH</div>
                <div className="node-portfield" style={{ height: rowCount * PORT_STEP + 2 }}>
                  {definition.inputs.map((port, index) => <div className="node-port-row input" key={`in-${port.name}`} style={{ top: index * PORT_STEP }}><span className="node-port-label">{port.name}<small>{port.signalType === 'analog' ? 'AN' : 'DG'}</small></span><button id={`port-${module.id}-in-${port.name}`} aria-label={`Input ${port.name} (${port.signalType})`} data-connection-state={inputConnected(port.name) ? 'connected' : 'free'} className={`port-terminal input-terminal ${inputConnected(port.name) ? 'is-connected' : ''} ${pending ? 'terminal-waiting' : ''}`} title={`${port.name} input · ${port.signalType} · ${inputConnected(port.name) ? 'connected' : 'free'}`} onClick={(event) => finishCable(event, module.id, port.name)} onPointerDown={(event) => event.stopPropagation()} /></div>)}
                  {definition.outputs.map((port, index) => <div className="node-port-row output" key={`out-${port.name}`} style={{ top: index * PORT_STEP }}><button id={`port-${module.id}-out-${port.name}`} aria-label={`Output ${port.name} (${port.signalType})`} data-connection-state={outputConnected(port.name) ? 'connected' : 'free'} className={`port-terminal output-terminal ${outputConnected(port.name) ? 'is-connected' : ''} ${pending?.moduleId === module.id && pending.port === port.name ? 'terminal-active' : ''}`} title={`${port.name} output · ${port.signalType} · ${outputConnected(port.name) ? 'connected' : 'free'} · click to start a patch lead`} onClick={(event) => beginCable(event, module.id, port.name)} onPointerDown={(event) => event.stopPropagation()} /><span className="node-port-label">{port.name}<small>{port.signalType === 'analog' ? 'AN' : 'DG'}</small></span></div>)}
                </div>
                <div className="node-readout"><div>{readouts.map((value, index) => <span key={`${value}-${index}`}>{value}</span>)}</div><span className="node-readout-status">{error ? 'CHECK INPUT' : props.isStale ? 'IDLE' : 'READY'}</span></div>
                {error && <div className="node-error" title={error}>{error}</div>}
              </div>
            </div>;
          })}
          {project.modules.length === 0 && <div className="bench-empty"><div className="empty-orbit"><Crosshair size={28} /></div><span className="eyebrow">BENCH IS CLEAR</span><h3>Build a signal path</h3><p>Add a signal generator, then patch its output to another module. Every trace is computed from the connected circuit.</p><div className="empty-actions"><span>01</span> Add a module from the rack <ChevronArrow /><span>02</span> Patch its terminal <ChevronArrow /><span>03</span> Run the solver</div></div>}
        </div>
        {connectionNotice && <div className={`bench-toast ${pending ? 'toast-active' : ''}`}><span className={pending ? 'pending-pulse' : 'toast-check'} />{connectionNotice}<button title="Dismiss" onClick={() => { setConnectionNotice(null); setPending(null); }}><X size={13} /></button></div>}
        {selectedConnection && <button className="delete-cable-float" onClick={() => props.onDeleteConnection(selectedConnection.id)}><Trash2 size={13} /> Remove selected lead <kbd>DEL</kbd></button>}
        {pending && <div className="patch-mode-label">PATCH MODE <kbd>ESC</kbd> to cancel</div>}
      </div>
    </div>
  );
}

function ChevronArrow() { return <span className="mini-arrow">→</span>; }
