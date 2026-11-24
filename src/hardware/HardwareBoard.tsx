import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Cable, CircleHelp, Link2, RotateCcw, Trash2, Undo2, X } from 'lucide-react';
import type { CablePoint, Connection, ModuleDefinition, ModuleInstance, Project, SimulationResult } from '../types';
import { moduleByType } from '../modules/registry';
import { validateConnection } from '../engine/graph';
import { outputKey, socketId } from '../types';
import { BAYS, CABLE_COLORS, GROUND_SOCKETS, HARDWARE_MODULES, SCOPE_INPUTS, type ControlLayout, type ModuleLayout } from './layout';
import { cablePath, clampToPanel, insertionPoints, MAX_ROUTING_POINTS } from './cableGeometry';
import { GroundTerminal, RotaryKnob, ToggleSwitch } from './controls';

interface PendingCable {
  sourceModuleId: string; sourcePort: string; pointerX: number; pointerY: number;
  color: Connection['color']; reconnectId?: string;
}
interface Props {
  project: Project;
  result: SimulationResult | null;
  moduleErrors: Record<string, string>;
  selectedConnectionId: string | null;
  selectedModuleId: string | null;
  onConnect: (sourceModuleId: string, sourcePort: string, targetModuleId: string, targetPort: string, color: Connection['color'], reconnectId?: string) => string | null;
  onSelectConnection: (id: string | null) => void;
  onDeleteConnection: (id: string) => void;
  onClearConnections: () => void;
  onConnectionColor: (id: string, color: Connection['color']) => void;
  onCableRoute: (id: string, routing: CablePoint[]) => void;
  onResetCableRoute: (id: string) => void;
  onParameter: (moduleId: string, key: string, value: number | string) => void;
  onSelectModule: (id: string | null) => void;
  onMessage: (text: string, tone?: 'info' | 'success' | 'error') => void;
}

interface SocketPoint { moduleId: string; port: string; direction: 'input' | 'output'; signalType: 'analog' | 'digital'; x: number; y: number }
type StartCable = (moduleId: string, port: string, event: ReactPointerEvent<SVGGElement>) => void;
type PanelPoint = (event: { clientX: number; clientY: number }) => CablePoint;

/** Breathing room between a jack's rim and its printed label, in panel design units. */
const SOCKET_LABEL_GAP = 3.2;

function socketLabel(side: ModuleLayout['sockets'][number]['labelSide'], x: number, y: number) {
  if (side === 'right') return { x: x + SOCKET_LABEL_GAP, y: y + 0.6, anchor: 'start' as const };
  if (side === 'left') return { x: x - SOCKET_LABEL_GAP, y: y + 0.6, anchor: 'end' as const };
  if (side === 'above') return { x, y: y - SOCKET_LABEL_GAP - 0.2, anchor: 'middle' as const };
  return { x, y: y + SOCKET_LABEL_GAP + 1.1, anchor: 'middle' as const };
}

function printedSocketLabel(port: string): string {
  const known: Record<string, string> = {
    A_XOR_B: 'A ⊕ B', X_DC: 'X DC', X_AC: 'X AC', Y_DC: 'Y DC', Y_AC: 'Y AC',
    PCM_DATA: 'PCM DATA', VCO_INPUT: 'VCO INPUT', '0dB': '0 dB', '-6dB': '-6 dB', '-20dB': '-20 dB', fc_x100: 'fc ×100',
    '100kHz_SINE': '100k SINE', '100kHz_COS': '100k COS', '100kHz_DIGITAL': '100k DIGITAL',
    '8kHz_DIGITAL': '8k DIGITAL', '2kHz_DIGITAL': '2k DIGITAL', '2kHz_SINE': '2k SINE',
  };
  return known[port] ?? port.replace(/_/g, ' ');
}

function panelTitleLines(label: string): string[] {
  const wrapped: Record<string, string[]> = {
    'TWIN PULSE GENERATOR': ['TWIN PULSE', 'GENERATOR'],
    'DUAL ANALOG SWITCH / S&H': ['DUAL ANALOG', 'SWITCH / S&H'],
    'NOISE GENERATOR': ['NOISE', 'GENERATOR'],
    'SEQUENCE GENERATOR': ['SEQUENCE', 'GENERATOR'],
  };
  return wrapped[label] ?? [label];
}

function HardwareSocket({
  layout, moduleId, moduleType, project, pending, reconnectId, onStart, onSelectModule,
}: {
  layout: ModuleLayout; moduleId: string; moduleType: string; project: Project; pending: PendingCable | null; reconnectId?: string;
  onStart: StartCable; onSelectModule: (id: string) => void;
}) {
  const definition = moduleByType.get(moduleType)!;
  return <>{layout.sockets.map((socket) => {
    const port = definition.outputs.find((item) => item.name === socket.port) ?? definition.inputs.find((item) => item.name === socket.port);
    if (!port) return null;
    const direction = definition.outputs.some((item) => item.name === socket.port) ? 'output' : 'input';
    const id = socketId(moduleId, socket.port);
    const cableCount = project.connections.filter((edge) => edge.sourceSocketId === id || edge.targetSocketId === id).length;
    const connectionColor = project.connections.find((edge) => edge.sourceSocketId === id || edge.targetSocketId === id)?.color ?? 'black';
    const probes = direction === 'output' ? project.instruments.scopeChannels.filter((channel) => channel.enabled && channel.sourceKey === outputKey(moduleId, socket.port)) : [];
    const label = socketLabel(socket.labelSide, socket.x, socket.y);
    const compatible = pending && direction === 'input'
      ? (() => {
          const source = project.modules.find((item) => item.id === pending.sourceModuleId);
          const target = project.modules.find((item) => item.id === moduleId);
          const sourcePort = source ? moduleByType.get(source.type)?.outputs.find((item) => item.name === pending.sourcePort) : undefined;
          if (!source || !target || !sourcePort) return false;
          const trial = { ...project, connections: project.connections.filter((edge) => edge.id !== (reconnectId ?? pending.reconnectId)) };
          return validateConnection(trial, source.id, pending.sourcePort, target.id, socket.port).ok;
        })()
      : false;
    const incompatible = Boolean(pending && direction === 'input' && !compatible);
    return <g key={socket.port} className={`hardware-socket ${port.signalType} ${direction} ${cableCount ? 'is-connected' : ''} ${probes.length ? 'has-probes' : ''} ${compatible ? 'is-compatible' : ''} ${incompatible ? 'is-incompatible' : ''} cable-${connectionColor}`}
      data-socket-id={id} data-module-id={moduleId} data-port={socket.port} data-direction={direction} data-signal-type={port.signalType} data-probe-channels={probes.map((channel) => channel.id).join(',')}
      onPointerDown={(event) => { event.stopPropagation(); onSelectModule(moduleId); if (direction === 'output') onStart(moduleId, socket.port, event); }}
      role="button" tabIndex={0} aria-label={`${direction} ${socket.port} ${port.signalType} socket${probes.length ? `; scope probes ${probes.map((channel) => channel.id).join(', ')}` : ''}`} onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onSelectModule(moduleId); }
      }}>
      <title>{`${moduleByType.get(moduleType)?.name ?? moduleType} · ${direction.toUpperCase()} ${socket.port} · ${port.signalType.toUpperCase()} · ${port.description} · ${cableCount} lead${cableCount === 1 ? '' : 's'}${probes.length ? ` · scope ${probes.map((channel) => channel.id).join(', ')}` : ''}`}</title>
      <circle className="socket-hit" cx={socket.x} cy={socket.y} r="4.6" />
      {port.signalType === 'analog' ? <g className="analog-jack" transform={`translate(${socket.x} ${socket.y})`}><circle className="socket-rim" r="2.6" /><circle className="socket-metal" r="1.75" /><circle className="socket-bore" r="0.9" /><circle className="socket-contact" r="0.34" /></g> : <g className="digital-jack" transform={`translate(${socket.x} ${socket.y})`}><rect className="socket-rim" x="-2.55" y="-2.55" width="5.1" height="5.1" /><rect className="socket-metal" x="-1.78" y="-1.78" width="3.56" height="3.56" /><circle className="socket-bore" r="0.83" /></g>}
      {cableCount > 0 && <circle className="socket-connected-ring" cx={socket.x} cy={socket.y} r="2.6" />}
      {probes.map((channel, index) => <circle key={channel.id} className={`scope-probe-ring scope-${channel.id.toLowerCase()}`} data-channel={channel.id} cx={socket.x} cy={socket.y} r={3.7 + index * 1.3} />)}
      <text className="socket-print" x={label.x} y={label.y} textAnchor={label.anchor}>{printedSocketLabel(socket.port)}</text>
    </g>;
  })}</>;
}

function ScopeInputLayer({ project, pending }: { project: Project; pending: PendingCable | null }) {
  return <g className="scope-input-layer" aria-label="Oscilloscope physical inputs">
    <rect className="scope-input-rail" x="432.208" y="43" width="18.5" height="138" />
    {SCOPE_INPUTS.map((input) => {
      const connected = project.connections.some((edge) => edge.targetModuleId === input.id && edge.targetPort === input.port);
      return <g key={input.id} className={`scope-input ${connected ? 'is-connected' : ''} ${pending ? 'is-compatible' : ''}`} data-socket-id={socketId(input.id, input.port)} data-module-id={input.id} data-port={input.port} data-direction="input" data-signal-type="analog" role="button" tabIndex={0} aria-label={`${input.channel} oscilloscope input${connected ? ' connected' : ''}`}>
        <circle className="socket-hit" cx={input.x} cy={input.y} r="4.1" />
        <circle className="socket-rim" cx={input.x} cy={input.y} r="2.25" />
        <circle className="socket-metal" cx={input.x} cy={input.y} r="1.45" />
        <circle className="socket-bore" cx={input.x} cy={input.y} r="0.75" />
        {connected && <circle className="socket-connected-ring" cx={input.x} cy={input.y} r="2.75" />}
        <text className="scope-input-label" x="451.24" y={input.y + 1.1}>{input.channel}</text>
        <title>{`${input.channel} oscilloscope input · connect any EMONA output`}</title>
      </g>;
    })}
  </g>;
}

/**
 * Two paint passes keep the physical print legible while patch leads stay above the panel:
 * the base pass draws faces, controls and printed glyphs, the print pass draws silkscreen,
 * socket labels and the interactive jacks above the cable layer.
 */
function HardwareModule({ layer, layout, instance, definition, status, error, selected, project, pending, reconnectId, onStart, onParameter, onSelect }: {
  layer: 'base' | 'print';
  layout: ModuleLayout; instance: ModuleInstance; definition: ModuleDefinition; status: 'idle' | 'ready' | 'error'; error?: string; selected: boolean;
  project: Project; pending: PendingCable | null; reconnectId?: string;
  onStart: (moduleId: string, port: string, event: ReactPointerEvent<SVGGElement>) => void;
  onParameter: (moduleId: string, key: string, value: number | string) => void; onSelect: (id: string) => void;
}) {
  const tiny = layout.height <= 35;
  if (layer === 'print') return <g className={`module-print-layer ${selected ? 'selected' : ''}`} data-print-module-id={layout.id}>
    <text className="module-silkscreen" x={layout.x + layout.width / 2} y={layout.y + (layout.id === 'bottom.sequence' ? 3.5 : 5.3)} textAnchor="middle">{panelTitleLines(layout.label).map((line, index) => <tspan key={line} x={layout.x + layout.width / 2} dy={index === 0 ? 0 : 3.8}>{line}</tspan>)}</text>
    {layout.separators?.map((y) => <text key={y} className="submodule-label" x={layout.x + layout.width / 2} y={y + 3.3} textAnchor="middle">{y === 171 ? 'LINE CODE' : 'SAMPLE & HOLD'}</text>)}
    {!layout.separators?.length && layout.bay === 'T8' && <text className="submodule-label" x={layout.x + layout.width / 2} y={layout.y + layout.height - 1.2} textAnchor="middle">{layout.label === 'COMPARATOR' ? 'REF / IN' : ''}</text>}
    {layout.indicator && <g className="ambiguous-panel-mark" transform={`translate(${layout.indicator.x} ${layout.indicator.y})`} aria-label={`${layout.indicator.label}: printed mark; electrical role unconfirmed`}><circle className="ambiguous-mark-ring" r="1.8" /><circle className="ambiguous-mark-center" r="0.55" /><text x="2.8" y="0.7">{layout.indicator.label}</text></g>}
    <HardwareSocket layout={layout} moduleId={instance.id} moduleType={instance.type} project={project} pending={pending} reconnectId={reconnectId} onStart={onStart} onSelectModule={onSelect} />
  </g>;
  return <g className={`hardware-module ${selected ? 'selected' : ''} status-${status} ${tiny ? 'compact' : ''}`} data-module-id={layout.id}
    onClick={(event) => { event.stopPropagation(); onSelect(layout.id); }} role="group" aria-label={`${definition.name} physical panel module`}>
    <title>{`${definition.name}${error ? ` — ${error}` : ` · ${definition.documentation.equation}`}`}</title>
    <rect className="module-face" x={layout.x} y={layout.y} width={layout.width} height={layout.height} />
    <path className="module-print-rule" d={`M ${layout.x + 1.1} ${layout.y + 7.1} H ${layout.x + layout.width - 1.1}`} />
    {layout.controls?.map((control: ControlLayout) => {
      const parameter = definition.parameters.find((item) => item.key === control.key);
      if (!parameter) return null;
      const value = instance.parameters[control.key];
      if (parameter.kind === 'select') return <ToggleSwitch key={control.key} x={control.x} y={control.y} label={control.label} value={String(value ?? parameter.options[0]?.value)} options={parameter.options} onChange={(next) => onParameter(layout.id, control.key, next)} />;
      return <RotaryKnob key={control.key} x={control.x} y={control.y} label={control.label} value={typeof value === 'number' ? value : parameter.min} definition={parameter} onChange={(next) => onParameter(layout.id, control.key, next)} />;
    })}
    {layout.type === 'source.speech' && <g className="printed-mic" transform={`translate(${layout.x + 8} ${layout.y + 15})`}><rect x="-1.8" y="-4" width="3.6" height="6" /><path d="M-3 1 C-3 6 3 6 3 1 M0 4 V7 M-2 7 H2" /></g>}
    {/* {layout.type === 'utility.buffer' && <g className="printed-headphone" transform={`translate(${layout.x + 18} ${layout.y + 25})`}><path d="M-3 1 V-1 A3 3 0 0 1 3-1 V1 M-3 0 V3 H-1 V0 M3 0 V3 H1 V0" /></g>} */}
    {layout.type === 'source.variableDc' && <g className="printed-dcv" transform={`translate(${layout.x + 8} ${layout.y + 21})`}><text x="1" y="1">V</text></g>}
    {layout.separators?.map((y) => <path key={y} className="submodule-rule" d={`M ${layout.x} ${y} H ${layout.x + layout.width}`} />)}
  </g>;
}

function HardwareRow({ layer, row, ...props }: { layer: 'base' | 'print'; row: 'top' | 'bottom'; project: Project; result: SimulationResult | null; moduleErrors: Record<string, string>; selectedModuleId: string | null; pending: PendingCable | null; reconnectId?: string; onStart: StartCable; onParameter: Props['onParameter']; onSelectModule: (id: string) => void }) {
  const modulesById = new Map(props.project.modules.map((module) => [module.id, module]));
  return <g className={`hardware-row row-${row} layer-${layer}`} aria-label={`${row} physical hardware row`}>
    {HARDWARE_MODULES.filter((layout) => layout.row === row).map((layout) => {
      const instance = modulesById.get(layout.id)!;
      const definition = moduleByType.get(instance.type)!;
      const hasSignal = definition.outputs.some((port) => Boolean(props.result?.outputs[`${instance.id}:${port.name}`]));
      const error = props.moduleErrors[instance.id];
      return <HardwareModule key={layout.id} layer={layer} layout={layout} instance={instance} definition={definition} status={error ? 'error' : hasSignal ? 'ready' : 'idle'} error={error} selected={props.selectedModuleId === instance.id} project={props.project} pending={props.pending} reconnectId={props.reconnectId} onStart={props.onStart} onParameter={props.onParameter} onSelect={props.onSelectModule} />;
    })}
  </g>;
}

function ModuleReadout({ instance, error, onDismiss }: { instance: ModuleInstance | undefined; error?: string; onDismiss: () => void }) {
  if (!instance) return <div className="module-readout empty"><CircleHelp size={14} /><span>Select a printed module to inspect its equation, connection role and documented assumptions.</span></div>;
  const definition = moduleByType.get(instance.type);
  if (!definition) return null;
  return <div className="module-readout"><div className="readout-title"><span className="eyebrow">MODULE FUNCTION / v{definition.version}</span><strong>{definition.name}</strong></div><p><b>{definition.documentation.equation}</b> <span>{definition.documentation.practicalUse}</span></p>{definition.documentation.assumptions && <small>{definition.documentation.assumptions}</small>}{error && <div className="module-diagnostic">{error}</div>}<button aria-label="Close module information" onClick={onDismiss}><X size={13} /></button></div>;
}

function PatchCableLayer({ project, pending, positions, selectedId, preview, onSelect }: {
  project: Project; pending: PendingCable | null; positions: Map<string, SocketPoint>; selectedId: string | null;
  preview: { id: string; routing: CablePoint[] } | null; onSelect: (id: string) => void;
}) {
  const colors = new Map(CABLE_COLORS.map((color) => [color.value, color.stroke]));
  return <g className="patch-cable-layer" aria-label="Patch cable layer">
    {project.connections.map((connection) => {
      const source = positions.get(connection.sourceSocketId), target = positions.get(connection.targetSocketId);
      if (!source || !target) return null;
      const routing = preview?.id === connection.id ? preview.routing : connection.routing ?? [];
      const d = cablePath(source, target, routing);
      const selected = selectedId === connection.id;
      return <g key={connection.id} className={`patch-cable ${selected ? 'selected' : ''} cable-${connection.color}`} data-connection-id={connection.id} data-route-count={routing.length} data-source-socket={connection.sourceSocketId} data-target-socket={connection.targetSocketId} onClick={(event) => { event.stopPropagation(); onSelect(connection.id); }} role="button" tabIndex={0} aria-pressed={selected} aria-label={`${connection.color} patch lead from ${connection.sourceModuleId} ${connection.sourcePort} to ${connection.targetModuleId} ${connection.targetPort}`} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onSelect(connection.id); } }}>
        <title>{`${connection.color} cable · ${connection.sourceModuleId} ${connection.sourcePort} → ${connection.targetModuleId} ${connection.targetPort}${routing.length ? ` · ${routing.length} routing bend${routing.length === 1 ? '' : 's'}` : ''}`}</title>
        <path className="cable-shadow" d={d} />
        <path className="cable-hit-area" d={d} />
        {selected && <path className="cable-selected-trace" d={d} />}
        <path className="cable-visible" d={d} stroke={colors.get(connection.color)} />
        <circle className="cable-plug" cx={source.x} cy={source.y} r="1.7" /><circle className="cable-plug" cx={target.x} cy={target.y} r="1.7" />
      </g>;
    })}
    {pending && <path className="pending-cable" d={cablePath({ x: positions.get(socketId(pending.sourceModuleId, pending.sourcePort))?.x ?? 0, y: positions.get(socketId(pending.sourceModuleId, pending.sourcePort))?.y ?? 0 }, { x: pending.pointerX, y: pending.pointerY })} stroke={colors.get(pending.color)} />}
  </g>;
}

function CableEditLayer({ connection, positions, preview, onSelect, onRoute, onRoutePoint }: {
  connection: Connection; positions: Map<string, SocketPoint>; preview: { id: string; routing: CablePoint[] } | null;
  onSelect: (id: string | null) => void;
  onRoute: (id: string, routing: CablePoint[]) => void;
  onRoutePoint: (id: string, mode: 'move' | 'insert', index: number, point: CablePoint, event: ReactPointerEvent<SVGGElement>) => void;
}) {
  const source = positions.get(connection.sourceSocketId), target = positions.get(connection.targetSocketId);
  if (!source || !target) return null;
  const routing = preview?.id === connection.id ? preview.routing : connection.routing ?? [];
  return <g className="cable-edit-layer" data-editing-connection={connection.id}>
    {routing.map((point, index) => <g key={`bend-${index}`} className="cable-handle" data-route-index={index} transform={`translate(${point.x} ${point.y})`} role="button" tabIndex={0}
      aria-label={`Routing bend ${index + 1}. Drag to reshape the lead; press Delete to remove it.`}
      onPointerDown={(event) => onRoutePoint(connection.id, 'move', index, point, event)}
      onDoubleClick={(event) => { event.stopPropagation(); onRoute(connection.id, routing.filter((_, item) => item !== index)); }}
      onKeyDown={(event) => {
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); onRoute(connection.id, routing.filter((_, item) => item !== index)); }
      }}>
      <title>Drag to route this lead · double-click (or Delete) removes this bend</title>
      <circle className="handle-hit" r="3.1" />
      <circle className="handle-dot" r="1.5" />
    </g>)}
    {insertionPoints(source, target, routing).map((point, index) => <g key={`insert-${index}`} className="cable-insert-handle" data-insert-index={index} transform={`translate(${point.x} ${point.y})`}
      role="button" tabIndex={0} aria-label="Drag to add a routing bend to this lead"
      onPointerDown={(event) => onRoutePoint(connection.id, 'insert', index, point, event)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onSelect(connection.id); } }}>
      <title>Drag this hollow point to add a bend · solid points reshape the lead</title>
      <circle className="handle-hit" r="2.7" />
      <circle className="insert-dot" r="1.05" />
      <path className="insert-plus" d="M-1.4 0 H1.4 M0 -1.4 V1.4" />
    </g>)}
  </g>;
}

export function ControlPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`instrument-control-panel ${className}`}>{children}</div>;
}

export function HardwareBoard({
  project, result, moduleErrors, selectedConnectionId, selectedModuleId,
  onConnect, onSelectConnection, onDeleteConnection, onClearConnections, onConnectionColor, onCableRoute, onResetCableRoute, onParameter, onSelectModule, onMessage,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [pending, setPending] = useState<PendingCable | null>(null);
  const [cableColor, setCableColor] = useState<Connection['color']>('red');
  const [showConnections, setShowConnections] = useState(false);
  const [reconnectArmed, setReconnectArmed] = useState(false);
  const [routePreview, setRoutePreview] = useState<{ id: string; routing: CablePoint[] } | null>(null);
  const routeDrag = useRef<{ id: string; index: number; routing: CablePoint[]; pointerId: number } | null>(null);
  const socketPositions = useMemo(() => {
    const positions = new Map<string, SocketPoint>();
    for (const layout of HARDWARE_MODULES) {
      const definition = moduleByType.get(layout.type);
      if (!definition) continue;
      for (const socket of layout.sockets) {
        const direction = definition.outputs.some((port) => port.name === socket.port) ? 'output' : 'input';
        const port = definition.outputs.find((item) => item.name === socket.port) ?? definition.inputs.find((item) => item.name === socket.port);
        if (port) positions.set(socketId(layout.id, socket.port), { moduleId: layout.id, port: socket.port, direction, signalType: port.signalType, x: socket.x, y: socket.y });
      }
    }
    for (const input of SCOPE_INPUTS) positions.set(socketId(input.id, input.port), { moduleId: input.id, port: input.port, direction: 'input', signalType: 'analog', x: input.x, y: input.y });
    return positions;
  }, []);
  const pointFromEvent: PanelPoint = (event) => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return { x: 0, y: 0 };
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  };
  const startCable = (moduleId: string, port: string, event: ReactPointerEvent<SVGGElement>) => {
    const point = pointFromEvent(event);
    const selected = reconnectArmed ? project.connections.find((connection) => connection.id === selectedConnectionId) : undefined;
    const color = selected?.color ?? cableColor;
    setPending({ sourceModuleId: moduleId, sourcePort: port, pointerX: point.x, pointerY: point.y, color, reconnectId: selected?.id });
    setReconnectArmed(false);
    onSelectConnection(null);
    onSelectModule(moduleId);
  };
  const finishCable = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!pending) return;
    const target = (event.target as Element | null)?.closest?.('[data-socket-id]') as SVGElement | null;
    const targetDirection = target?.dataset.direction;
    const targetModuleId = target?.dataset.moduleId;
    const targetPort = target?.dataset.port;
    if (target && targetDirection === 'input' && targetModuleId && targetPort) {
      const id = onConnect(pending.sourceModuleId, pending.sourcePort, targetModuleId, targetPort, pending.color, pending.reconnectId);
      if (id) onSelectConnection(id);
    } else if (target && targetDirection === 'output') {
      onMessage('Patch leads must run from an output socket to an input socket.', 'error');
    }
    setPending(null);
  };

  /** Start (or continue) dragging a bend. Window listeners keep the drag alive even if the point is re-keyed. */
  const beginRouteDrag = (id: string, mode: 'move' | 'insert', index: number, point: CablePoint, event: ReactPointerEvent<SVGGElement>) => {
    event.stopPropagation(); event.preventDefault();
    const connection = project.connections.find((edge) => edge.id === id);
    if (!connection) return;
    const routing = (connection.routing ?? []).map((item) => ({ ...item }));
    if (mode === 'insert') {
      if (routing.length >= MAX_ROUTING_POINTS) return;
      routing.splice(Math.min(index, routing.length), 0, clampToPanel(point));
    }
    routeDrag.current = { id, index: Math.min(index, routing.length - 1), routing, pointerId: event.pointerId };
    setRoutePreview({ id, routing });
    onSelectConnection(id);
  };

  useEffect(() => {
    if (!routePreview) return;
    const onMove = (event: PointerEvent) => {
      const drag = routeDrag.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const next = drag.routing.map((point, index) => index === drag.index ? clampToPanel(pointFromEvent(event)) : point);
      drag.routing = next;
      setRoutePreview({ id: drag.id, routing: next });
    };
    const onUp = (event: PointerEvent) => {
      const drag = routeDrag.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      routeDrag.current = null;
      setRoutePreview(null);
      onCableRoute(drag.id, drag.routing);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); };
    // pointFromEvent reads the stable SVG bounds; only the active drag needs listeners.
  }, [routePreview !== null, onCableRoute]);

  useEffect(() => {
    if (!pending) return;
    const onMove = (event: PointerEvent) => {
      const point = pointFromEvent(event);
      setPending((current) => current ? { ...current, pointerX: point.x, pointerY: point.y } : current);
    };
    const onUp = () => setPending(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [pending !== null]);
  useEffect(() => {
    if (!selectedConnectionId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"], [role="slider"]')) return;
      if (event.key === 'Escape') { setPending(null); onSelectConnection(null); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedConnectionId, onSelectConnection]);

  const selectedCable = project.connections.find((connection) => connection.id === selectedConnectionId);
  const selectedModule = selectedModuleId ? project.modules.find((module) => module.id === selectedModuleId) : undefined;
  const selectedError = selectedModule ? moduleErrors[selectedModule.id] : undefined;
  const reconnectId = reconnectArmed ? selectedConnectionId ?? undefined : undefined;
  const selectedRouting = selectedCable ? (routePreview?.id === selectedCable.id ? routePreview.routing : selectedCable.routing ?? []) : [];

  return <section className="physical-trainer" aria-label="ETT-101 digital twin">
    <div className="instrument-body">
      <svg ref={svgRef} className={`emona-front-panel ${selectedCable ? 'cable-editing' : ''}`} viewBox="0 0 468 240" preserveAspectRatio="xMidYMid meet" aria-label="Source-measured two-row ETT-101 front panel with oscilloscope inputs" onPointerMove={(event) => { if (pending) { const point = pointFromEvent(event); setPending((current) => current ? { ...current, pointerX: point.x, pointerY: point.y } : current); } }} onPointerUp={finishCable} onPointerDown={(event) => {
        const target = event.target as Element | null;
        if (!target) return;
        if (target === event.currentTarget && pending) { setPending(null); return; }
        if (selectedConnectionId && !target.closest('.patch-cable, .cable-handle, .cable-insert-handle, .cable-color-swatch, .selected-cable-strip')) onSelectConnection(null);
      }}>
        <defs>
          <linearGradient id="panelMetal" x1="0" y1="0" x2="0.9" y2="1"><stop offset="0" stopColor="#eef0e9" /><stop offset="0.42" stopColor="#d4d8cf" /><stop offset="1" stopColor="#bcc3bd" /></linearGradient>
          <linearGradient id="panelBezel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#425f68" /><stop offset="1" stopColor="#1f343b" /></linearGradient>
          <filter id="panelShadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="2" stdDeviation="1.5" floodColor="#0b1315" floodOpacity="0.5" /></filter>
        </defs>
        <rect className="panel-body-shadow" x="-2.48" y="2" width="430.56" height="236" />
        <rect className="panel-metal" x="2.2" y="5" width="421.2" height="222" />
        <rect className="panel-inset" x="6.1" y="7.5" width="413.4" height="217" />
        {[[8.128,8.8],[417.472,8.8],[8.128,223.2],[417.472,223.2]].map(([x,y], index) => <g className="chassis-screw" key={index} transform={`translate(${x} ${y})`}><circle r="1.5" /><path d="M-0.8 0 H0.8" /></g>)}
        {BAYS.map((bay) => <g className={`panel-bay bay-${bay.row}`} key={bay.id}><rect x={bay.x} y={bay.y} width={bay.width} height={bay.height} /><text className="bay-label" x={bay.x + bay.width / 2} y={bay.y + 2.5} textAnchor="middle">{bay.label}</text></g>)}
        <rect className="expansion-inset" x="328.24" y="141" width="79.56" height="73" />
        <text className="expansion-mark" x="367.62" y="153.5" textAnchor="middle">EXPANSION</text>
        <rect className="expansion-slot" x="337.6" y="158" width="60.84" height="10" />
        <line className="ground-rail" x1="11.56" y1="126.5" x2="414.04" y2="126.5" />
        {GROUND_SOCKETS.map((ground) => <GroundTerminal key={ground.id} {...ground} onClick={() => onMessage(`${ground.id}: common ground reference; it is not a signal-processing port.`, 'info')} />)}
        <ScopeInputLayer project={project} pending={pending} />
        <HardwareRow layer="base" row="top" project={project} result={result} moduleErrors={moduleErrors} selectedModuleId={selectedModuleId} pending={pending} reconnectId={reconnectId} onStart={startCable} onParameter={onParameter} onSelectModule={onSelectModule} />
        <HardwareRow layer="base" row="bottom" project={project} result={result} moduleErrors={moduleErrors} selectedModuleId={selectedModuleId} pending={pending} reconnectId={reconnectId} onStart={startCable} onParameter={onParameter} onSelectModule={onSelectModule} />
        <PatchCableLayer project={project} pending={pending} positions={socketPositions} selectedId={selectedConnectionId} preview={routePreview} onSelect={(id) => { onSelectConnection(id); onSelectModule(null); }} />
        <HardwareRow layer="print" row="top" project={project} result={result} moduleErrors={moduleErrors} selectedModuleId={selectedModuleId} pending={pending} reconnectId={reconnectId} onStart={startCable} onParameter={onParameter} onSelectModule={onSelectModule} />
        <HardwareRow layer="print" row="bottom" project={project} result={result} moduleErrors={moduleErrors} selectedModuleId={selectedModuleId} pending={pending} reconnectId={reconnectId} onStart={startCable} onParameter={onParameter} onSelectModule={onSelectModule} />
        {selectedCable && <CableEditLayer connection={selectedCable} positions={socketPositions} preview={routePreview} onSelect={onSelectConnection} onRoute={onCableRoute} onRoutePoint={beginRouteDrag} />}
      </svg>
      <div className="body-edge bottom-edge" aria-hidden="true" />
    </div>
    <ControlPanel className="patch-control-strip">
      <div className="patch-toolbar-title"><Cable size={15} /><div><strong>PATCH LEADS</strong><small>{project.connections.length} CONNECTED · OUTPUTS SUPPORT FAN-OUT</small></div></div>
      <div className="cable-color-picker" aria-label="Choose cable color">{CABLE_COLORS.map((color) => <button key={color.value} type="button" className={`cable-color-swatch ${color.value} ${cableColor === color.value ? 'chosen' : ''}`} style={{ '--wire-color': color.stroke } as CSSProperties} onClick={() => setCableColor(color.value)} title={`New lead color: ${color.label}`} aria-label={`Choose ${color.label} cable`} />)}</div>
      <button className="bench-tool-button" type="button" disabled={!selectedCable} onClick={() => { setReconnectArmed(true); onMessage('Repatch armed. Start from a new output socket, then release on an input.', 'info'); }}><Link2 size={14} /> RECONNECT</button>
      <button className="bench-tool-button" type="button" disabled={!selectedCable} onClick={() => selectedCable && onDeleteConnection(selectedCable.id)}><Trash2 size={14} /> REMOVE</button>
      <button className="bench-tool-button" type="button" disabled={!project.connections.length} onClick={onClearConnections}><X size={14} /> CLEAR ALL</button>
      <button className="bench-tool-button connection-list-button" type="button" aria-expanded={showConnections} onClick={() => setShowConnections((value) => !value)}><Undo2 size={14} /> LEAD LIST</button>
      <div className="patch-instructions">{pending ? `PATCH FROM ${pending.sourceModuleId} · ${pending.sourcePort} — choose a compatible input` : selectedCable ? 'DRAG A SOLID POINT TO ROUTE · HOLLOW POINTS ADD BENDS · ESC EXITS CABLE EDITING' : 'OUTPUT → INPUT · Click/drag from any output; each lead is independent.'}</div>
    </ControlPanel>
    {selectedCable && <ControlPanel className="selected-cable-strip" aria-label="Selected patch lead editor">
      <strong>LEAD SELECTED</strong>
      <span className="selected-lead-route">{selectedCable.sourceModuleId} / {selectedCable.sourcePort} <i>→</i> {selectedCable.targetModuleId} / {selectedCable.targetPort}</span>
      <div className="selected-wire-colors" aria-label="Change selected cable color">{CABLE_COLORS.map((color) => <button key={color.value} className={`cable-color-swatch ${color.value} ${selectedCable.color === color.value ? 'chosen' : ''}`} style={{ '--wire-color': color.stroke } as CSSProperties} onClick={() => onConnectionColor(selectedCable.id, color.value)} title={`Change selected lead to ${color.label}`} aria-label={`Set selected cable to ${color.label}`} />)}</div>
      <span className="selected-route-count">{selectedRouting.length ? `${selectedRouting.length} BEND${selectedRouting.length === 1 ? '' : 'S'}` : 'DEFAULT SAG'}</span>
      <button className="bench-tool-button" type="button" disabled={!selectedRouting.length} onClick={() => onResetCableRoute(selectedCable.id)}><RotateCcw size={13} /> RESET ROUTE</button>
      <button className="bench-tool-button" type="button" onClick={() => onSelectConnection(null)}><X size={13} /> DONE</button>
    </ControlPanel>}
    {showConnections && <div className="connection-list" aria-label="Patch connection list">{project.connections.length ? project.connections.map((connection) => <button key={connection.id} className={`connection-row ${selectedConnectionId === connection.id ? 'selected' : ''}`} onClick={() => onSelectConnection(connection.id)}><span className={`connection-wire ${connection.color}`} /><span>{connection.sourceModuleId} · {connection.sourcePort}</span><span className="connection-arrow">→</span><span>{connection.targetModuleId} · {connection.targetPort}</span><button aria-label="Remove lead" onClick={(event) => { event.stopPropagation(); onDeleteConnection(connection.id); }}><Trash2 size={12} /></button></button>) : <p>No patch leads. Select an output socket and connect it to an input.</p>}</div>}
    <ModuleReadout instance={selectedModule} error={selectedError} onDismiss={() => onSelectModule(null)} />
  </section>;
}
