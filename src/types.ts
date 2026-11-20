export type SignalType = 'analog' | 'digital';
export type Waveform = 'sine' | 'cosine' | 'square' | 'triangle' | 'sawtooth' | 'dc';
export type SpectrumWindow = 'hann' | 'rectangular';
export type CableColor = 'red' | 'black' | 'yellow' | 'green' | 'blue' | 'white';
/** A user-dragged routing anchor in panel design units (0–280 × 0–240). Purely visual: never electrical. */
export interface CablePoint { x: number; y: number }

export interface PortDefinition {
  name: string;
  signalType: SignalType;
  description: string;
  optional?: boolean;
}

export type ParameterDefinition =
  | { key: string; label: string; kind: 'range' | 'number'; min: number; max: number; step: number; unit?: string; approximate?: boolean }
  | { key: string; label: string; kind: 'select'; options: { label: string; value: string }[]; approximate?: boolean };

export type ProcessorKey =
  | 'adderVariable' | 'adderFixed' | 'multiplier' | 'twinPulse' | 'dualSwitch'
  | 'noise' | 'buffer' | 'lowpass' | 'channelBpf' | 'phaseShifter'
  | 'comparator' | 'rectifier' | 'diodeEnvelope' | 'variableDc' | 'speech'
  | 'xor' | 'vco' | 'sequence' | 'divider' | 'pcmEncoder' | 'masterSignals'
  | 'serialToParallel' | 'pcmDecoder';

export interface ModuleDefinition {
  type: string;
  name: string;
  shortName: string;
  category: string;
  description: string;
  version: number;
  documentation: { equation: string; practicalUse: string; assumptions?: string };
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  parameters: ParameterDefinition[];
  defaults: Record<string, number | string>;
  processor: ProcessorKey;
  implemented: true;
}

export interface ModuleInstance {
  id: string;
  type: string;
  /** Fixed normalized module coordinates inside the photo-guided 280 × 240 outer viewBox; not claimed as millimetres. */
  x: number;
  y: number;
  parameters: Record<string, number | string>;
}

export interface Connection {
  id: string;
  sourceSocketId: string;
  targetSocketId: string;
  sourceModuleId: string;
  sourcePort: string;
  targetModuleId: string;
  targetPort: string;
  color: CableColor;
  /** Draggable visual routing anchors between the two sockets; empty means the default sag. */
  routing: CablePoint[];
  state: 'active';
}

export interface ScopeChannel {
  id: 'CH1' | 'CH2' | 'CH3' | 'CH4';
  enabled: boolean;
  sourceKey: string;
  voltsPerDiv: number;
  verticalPosition: number;
}

export interface Project {
  schemaVersion: 2;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: { sampleRate: number; sampleCount: number; simulationSpeed: number };
  modules: ModuleInstance[];
  connections: Connection[];
  instruments: {
    scopeChannels: ScopeChannel[];
    spectrumSource: string;
    spectrumWindow: SpectrumWindow;
    timePerDiv: number;
    triggerSource: 'CH1' | 'CH2' | 'CH3' | 'CH4';
    triggerLevel: number;
    triggerMode: 'auto' | 'normal' | 'single';
    running: boolean;
    /** Horizontal position: seconds the sweep is delayed after its start/trigger point (optional; 0 when absent). */
    timeOffset?: number;
  };
  experiment: { id: string | null; mode: 'free' | 'guided'; step: number };
  view: { zoom: number; panX: number; panY: number };
}

export interface SignalBuffer {
  samples: Float64Array;
  sampleRate: number;
  startTime: number;
  signalType: SignalType;
  metadata: { name: string; unit: string; sourceModuleId: string; frequency?: number; phase?: number };
}

export interface SimulationContext {
  sampleRate: number;
  sampleCount: number;
  startTime: number;
  moduleId: string;
  moduleType: string;
  externalInputs?: Record<string, { samples: Float64Array; sampleRate: number }>;
}

export type ModuleInputs = Record<string, SignalBuffer>;
export type ModuleOutputs = Record<string, SignalBuffer>;
export type ModuleProcessor = (
  inputs: ModuleInputs,
  parameters: Record<string, number | string>,
  context: SimulationContext,
) => ModuleOutputs;

export interface SimulationResult {
  outputs: Record<string, SignalBuffer>;
  errors: Record<string, string>;
  order: string[];
}

export const outputKey = (moduleId: string, port: string) => `${moduleId}:${port}`;
export const socketId = (moduleId: string, port: string) => `${moduleId}.${port}`;
