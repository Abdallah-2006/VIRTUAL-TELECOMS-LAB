import type { CableColor } from '../types';

export interface SocketLayout { port: string; x: number; y: number; labelSide: 'left' | 'right' | 'above' | 'below' }
export interface ControlLayout { key: string; x: number; y: number; label: string; orientation?: 'horizontal' | 'vertical' }
export interface ModuleLayout {
  id: string; type: string; label: string; bay: string; row: 'top' | 'bottom';
  x: number; y: number; width: number; height: number;
  sockets: SocketLayout[]; controls?: ControlLayout[]; separators?: number[]; indicator?: { x: number; y: number; label: string };
}
export interface BayLayout { id: string; label: string; x: number; y: number; width: number; height: number; row: 'top' | 'bottom' }

const expandX = (x: number) => 10 + (x - 10) * 1.56;
export const PANEL = { width: 468, height: 240, left: 10, right: 416, top: 15, bottom: 223 } as const;
export const SCOPE_INPUTS = [
  { id: 'scope.CH1', channel: 'CH1', port: 'IN', x: 441.44, y: 64 },
  { id: 'scope.CH2', channel: 'CH2', port: 'IN', x: 441.44, y: 96 },
  { id: 'scope.CH3', channel: 'CH3', port: 'IN', x: 441.44, y: 128 },
  { id: 'scope.CH4', channel: 'CH4', port: 'IN', x: 441.44, y: 160 },
] as const;
const BASE_BAYS: BayLayout[] = [
  ...[10, 39, 68, 97, 125, 154, 183, 212, 241].map((x, i) => ({ id: `T${i + 1}`, label: ['ADDER', 'MULTIPLIER', 'TWIN PULSE', 'DUAL ANALOG SWITCH', 'NOISE / BUFFER', 'CHANNEL MODULE', 'PHASE SHIFTER', 'UTILITIES', 'TUNEABLE LPF'][i], x, y: 15, width: [39,68,97,125,154,183,212,241,270][i] - x, height: 106, row: 'top' as const })),
  ...[10, 39, 68, 97, 125, 154, 183, 212].map((x, i) => ({ id: `B${i + 1}`, label: ['VDC / SPEECH / EXOR', 'VCO', 'SEQUENCE / LINE CODE / DIVIDER', 'PCM ENCODER', 'MASTER SIGNALS', 'MULTIPLIER / SERIAL TO PARALLEL', 'PCM DECODER', 'EXPANSION'][i], x, y: 132, width: (i === 7 ? 270 : [39,68,97,125,154,183,212,270][i]) - x, height: 91, row: 'bottom' as const })),
];
export const BAYS: BayLayout[] = BASE_BAYS.map((bay) => ({ ...bay, x: expandX(bay.x), width: bay.width * 1.56 }));

const BASE_HARDWARE_MODULES: ModuleLayout[] = [
  { id: 'top.adder', type: 'adder.variable', label: 'ADDER', bay: 'T1', row: 'top', x: 10, y: 15, width: 29, height: 106, sockets: [{ port: 'A', x: 13.05, y: 74, labelSide: 'right' }, { port: 'B', x: 13.05, y: 96, labelSide: 'right' }, { port: 'GA+gB', x: 35.95, y: 85, labelSide: 'left' }], controls: [{ key: 'gainA', x: 20, y: 43, label: 'G' }, { key: 'gainB', x: 30, y: 43, label: 'g' }] },
  { id: 'top.multiplier.upper', type: 'multiplier.four', label: 'MULTIPLIER', bay: 'T2', row: 'top', x: 39, y: 15, width: 29, height: 53, sockets: [{ port: 'X_DC', x: 42.25, y: 30, labelSide: 'right' }, { port: 'X_AC', x: 42.25, y: 40, labelSide: 'right' }, { port: 'Y_DC', x: 42.25, y: 50, labelSide: 'right' }, { port: 'Y_AC', x: 42.25, y: 60, labelSide: 'right' }, { port: 'kXY', x: 64.95, y: 45, labelSide: 'left' }] },
  { id: 'top.multiplier.lower', type: 'multiplier.two', label: 'MULTIPLIER', bay: 'T2', row: 'top', x: 39, y: 68, width: 29, height: 53, sockets: [{ port: 'X_DC', x: 42.25, y: 82, labelSide: 'right' }, { port: 'Y_DC', x: 42.25, y: 101, labelSide: 'right' }, { port: 'kXY', x: 64.95, y: 91.5, labelSide: 'left' }] },
  { id: 'top.twinPulse', type: 'pulse.twin', label: 'TWIN PULSE GENERATOR', bay: 'T3', row: 'top', x: 68, y: 15, width: 29, height: 106, sockets: [{ port: 'CLK', x: 71.05, y: 87, labelSide: 'right' }, { port: 'Q1', x: 93.95, y: 80, labelSide: 'left' }, { port: 'Q2', x: 93.95, y: 101, labelSide: 'left' }], controls: [{ key: 'widthUs', x: 76, y: 43, label: 'WIDTH' }, { key: 'delayUs', x: 88, y: 43, label: 'DELAY' }] },
  { id: 'top.analogSwitch', type: 'switch.dual', label: 'DUAL ANALOG SWITCH / S&H', bay: 'T4', row: 'top', x: 97, y: 15, width: 28, height: 106, sockets: [{ port: 'IN1', x: 100.05, y: 33, labelSide: 'right' }, { port: 'CONTROL1', x: 100.05, y: 49, labelSide: 'right' }, { port: 'CONTROL2', x: 100.05, y: 64, labelSide: 'right' }, { port: 'IN2', x: 100.05, y: 77, labelSide: 'right' }, { port: 'OUT', x: 121.95, y: 53, labelSide: 'left' }, { port: 'S&H_IN', x: 100.05, y: 99, labelSide: 'right' }, { port: 'S&H_OUT', x: 121.95, y: 99, labelSide: 'left' }], separators: [85] },
  { id: 'top.noise', type: 'source.noise', label: 'NOISE GENERATOR', bay: 'T5', row: 'top', x: 125, y: 15, width: 29, height: 53, sockets: [{ port: '0dB', x: 150.95, y: 31, labelSide: 'left' }, { port: '-6dB', x: 150.95, y: 44, labelSide: 'left' }, { port: '-20dB', x: 150.95, y: 57, labelSide: 'left' }] },
  { id: 'top.buffer', type: 'utility.buffer', label: 'BUFFER', bay: 'T5', row: 'top', x: 125, y: 68, width: 29, height: 53, sockets: [{ port: 'IN', x: 128.05, y: 97, labelSide: 'right' }, { port: 'OUT', x: 150.95, y: 97, labelSide: 'left' }], controls: [{ key: 'gain', x: 139, y: 79, label: 'GAIN' }] },
  { id: 'top.channel.bpf', type: 'filter.channelBpf', label: 'CHANNEL BPF', bay: 'T6', row: 'top', x: 154, y: 15, width: 29, height: 35, sockets: [{ port: 'IN', x: 157.05, y: 40, labelSide: 'right' }, { port: 'OUT', x: 179.95, y: 40, labelSide: 'left' }] },
  { id: 'top.channel.baseband', type: 'filter.baseband', label: 'BASEBAND LPF', bay: 'T6', row: 'top', x: 154, y: 50, width: 29, height: 34, sockets: [{ port: 'IN', x: 157.05, y: 73, labelSide: 'right' }, { port: 'OUT', x: 179.95, y: 73, labelSide: 'left' }] },
  { id: 'top.channel.adder', type: 'adder.channel', label: 'CHANNEL ADDER', bay: 'T6', row: 'top', x: 154, y: 84, width: 29, height: 37, sockets: [{ port: 'NOISE', x: 157.05, y: 93, labelSide: 'right' }, { port: 'SIGNAL', x: 157.05, y: 108, labelSide: 'right' }, { port: 'CHANNEL_OUT', x: 179.95, y: 101, labelSide: 'left' }] },
  { id: 'top.phaseShifter', type: 'phase.shifter', label: 'PHASE SHIFTER', bay: 'T7', row: 'top', x: 183, y: 15, width: 29, height: 106, sockets: [{ port: 'IN', x: 186.05, y: 75, labelSide: 'right' }, { port: 'OUT', x: 208.95, y: 75, labelSide: 'left' }], controls: [{ key: 'phaseDegrees', x: 194, y: 47, label: 'PHASE' }, { key: 'invert', x: 202, y: 99, label: '0 / 180' }], indicator: { x: 197, y: 29, label: 'LO' } },
  { id: 'top.comparator', type: 'utility.comparator', label: 'COMPARATOR', bay: 'T8', row: 'top', x: 212, y: 15, width: 29, height: 26.5, sockets: [{ port: 'REF', x: 215.05, y: 29, labelSide: 'right' }, { port: 'IN', x: 215.05, y: 38, labelSide: 'right' }, { port: 'OUT', x: 237.95, y: 35, labelSide: 'left' }] },
  { id: 'top.rectifier', type: 'utility.rectifier', label: 'RECTIFIER', bay: 'T8', row: 'top', x: 212, y: 41.5, width: 29, height: 26.5, sockets: [{ port: 'IN', x: 215.05, y: 55, labelSide: 'right' }, { port: 'OUT', x: 237.95, y: 55, labelSide: 'left' }] },
  { id: 'top.utilities.diodeRc', type: 'filter.diodeRc', label: 'DIODE & RC LPF', bay: 'T8', row: 'top', x: 212, y: 68, width: 29, height: 26.5, sockets: [{ port: 'IN', x: 215.05, y: 81, labelSide: 'right' }, { port: 'OUT', x: 237.95, y: 81, labelSide: 'left' }] },
  { id: 'top.utilities.rc', type: 'filter.rc', label: 'RC LPF', bay: 'T8', row: 'top', x: 212, y: 94.5, width: 29, height: 26.5, sockets: [{ port: 'IN', x: 215.05, y: 108, labelSide: 'right' }, { port: 'OUT', x: 237.95, y: 108, labelSide: 'left' }] },
  { id: 'top.tunableLpf', type: 'filter.tunable', label: 'TUNEABLE LPF', bay: 'T9', row: 'top', x: 241, y: 15, width: 29, height: 106, sockets: [{ port: 'IN', x: 244.05, y: 78, labelSide: 'right' }, { port: 'OUT', x: 266.95, y: 78, labelSide: 'left' }, { port: 'fc_x100', x: 266.95, y: 105, labelSide: 'left' }], controls: [{ key: 'cutoffHz', x: 249, y: 43, label: 'fc' }, { key: 'gain', x: 261, y: 43, label: 'GAIN' }] },
  { id: 'bottom.variableDcv', type: 'source.variableDc', label: 'VARIABLE DCV', bay: 'B1', row: 'bottom', x: 10, y: 132, width: 29, height: 30, sockets: [{ port: '+5V', x: 13.05, y: 154, labelSide: 'right' }, { port: 'VDC', x: 35.95, y: 154, labelSide: 'left' }], controls: [{ key: 'voltage', x: 24, y: 145, label: 'VDC' }] },
  { id: 'bottom.speech', type: 'source.speech', label: 'SPEECH', bay: 'B1', row: 'bottom', x: 10, y: 162, width: 29, height: 28, sockets: [{ port: 'OUT', x: 35.95, y: 177, labelSide: 'left' }] },
  { id: 'bottom.exor', type: 'digital.xor', label: 'EXOR', bay: 'B1', row: 'bottom', x: 10, y: 190, width: 29, height: 33, sockets: [{ port: 'A', x: 13.05, y: 200, labelSide: 'right' }, { port: 'B', x: 13.05, y: 215, labelSide: 'right' }, { port: 'A_XOR_B', x: 35.95, y: 207, labelSide: 'left' }] },
  { id: 'bottom.vco', type: 'vco', label: 'VCO', bay: 'B2', row: 'bottom', x: 39, y: 132, width: 29, height: 91, sockets: [{ port: 'VCO_INPUT', x: 42.05, y: 183, labelSide: 'right' }, { port: 'SINE', x: 64.95, y: 182, labelSide: 'left' }, { port: 'DIGITAL', x: 64.95, y: 204, labelSide: 'left' }], controls: [{ key: 'frequencyControl', x: 46, y: 151, label: 'FREQ' }, { key: 'gain', x: 58, y: 151, label: 'GAIN' }, { key: 'range', x: 53, y: 215, label: 'HI / LO' }] },
  { id: 'bottom.sequence', type: 'sequence.lineCode', label: 'SEQUENCE GENERATOR', bay: 'B3', row: 'bottom', x: 68, y: 132, width: 29, height: 61, sockets: [{ port: 'CLK', x: 71.05, y: 154, labelSide: 'right' }, { port: 'SYNC', x: 93.95, y: 145, labelSide: 'left' }, { port: 'X', x: 93.95, y: 155, labelSide: 'left' }, { port: 'Y', x: 93.95, y: 165, labelSide: 'left' }, { port: 'LINE_CODE', x: 93.95, y: 180, labelSide: 'left' }], controls: [{ key: 'lineCode', x: 82, y: 179, label: 'CODE' }], separators: [171] },
  { id: 'bottom.divider', type: 'divider', label: 'DIVIDER', bay: 'B3', row: 'bottom', x: 68, y: 193, width: 29, height: 30, sockets: [{ port: 'IN', x: 71.05, y: 214, labelSide: 'right' }, { port: 'OUT', x: 93.95, y: 214, labelSide: 'left' }], controls: [{ key: 'ratio', x: 82, y: 203, label: '÷N' }] },
  { id: 'bottom.pcmEncoder', type: 'pcm.encoder', label: 'PCM ENCODER', bay: 'B4', row: 'bottom', x: 97, y: 132, width: 28, height: 91, sockets: [{ port: 'INPUT1', x: 100.05, y: 180, labelSide: 'right' }, { port: 'INPUT2', x: 100.05, y: 194, labelSide: 'right' }, { port: 'CLK', x: 100.05, y: 209, labelSide: 'right' }, { port: 'PCM_DATA', x: 121.95, y: 157, labelSide: 'left' }, { port: 'FS', x: 121.95, y: 170, labelSide: 'left' }], controls: [{ key: 'mode', x: 109, y: 148, label: 'PCM / TDM' }] },
  { id: 'bottom.masterSignals', type: 'source.masterSignals', label: 'MASTER SIGNALS', bay: 'B5', row: 'bottom', x: 125, y: 132, width: 29, height: 91, sockets: [{ port: '100kHz_SINE', x: 150.95, y: 145, labelSide: 'left' }, { port: '100kHz_COS', x: 150.95, y: 158, labelSide: 'left' }, { port: '100kHz_DIGITAL', x: 150.95, y: 171, labelSide: 'left' }, { port: '8kHz_DIGITAL', x: 150.95, y: 184, labelSide: 'left' }, { port: '2kHz_DIGITAL', x: 150.95, y: 197, labelSide: 'left' }, { port: '2kHz_SINE', x: 150.95, y: 210, labelSide: 'left' }] },
  { id: 'bottom.multiplier', type: 'multiplier.two', label: 'MULTIPLIER', bay: 'B6', row: 'bottom', x: 154, y: 132, width: 29, height: 45, sockets: [{ port: 'X_DC', x: 157.05, y: 147, labelSide: 'right' }, { port: 'Y_DC', x: 157.05, y: 163, labelSide: 'right' }, { port: 'kXY', x: 179.95, y: 155, labelSide: 'left' }] },
  { id: 'bottom.serialToParallel', type: 'serial.parallel', label: 'SERIAL TO PARALLEL', bay: 'B6', row: 'bottom', x: 154, y: 177, width: 29, height: 46, sockets: [{ port: 'SERIAL', x: 157.05, y: 193, labelSide: 'right' }, { port: 'CLK', x: 157.05, y: 209, labelSide: 'right' }, { port: 'X1', x: 179.95, y: 193, labelSide: 'left' }, { port: 'X2', x: 179.95, y: 209, labelSide: 'left' }] },
  { id: 'bottom.pcmDecoder', type: 'pcm.decoder', label: 'PCM DECODER', bay: 'B7', row: 'bottom', x: 183, y: 132, width: 29, height: 91, sockets: [{ port: 'FS', x: 186.05, y: 151, labelSide: 'right' }, { port: 'PCM_DATA', x: 186.05, y: 170, labelSide: 'right' }, { port: 'CLK', x: 186.05, y: 190, labelSide: 'right' }, { port: 'OUTPUT2', x: 208.95, y: 178, labelSide: 'left' }, { port: 'OUTPUT', x: 208.95, y: 199, labelSide: 'left' }], indicator: { x: 198, y: 148, label: 'TDM' } },
];
export const HARDWARE_MODULES: ModuleLayout[] = BASE_HARDWARE_MODULES.map((module) => ({
  ...module, x: expandX(module.x), width: module.width * 1.56,
  sockets: module.sockets.map((socket) => ({ ...socket, x: expandX(socket.x) })),
  controls: module.controls?.map((control) => ({ ...control, x: expandX(control.x) })),
  indicator: module.indicator ? { ...module.indicator, x: expandX(module.indicator.x) } : undefined,
}));

const BASE_GROUND_SOCKETS = [
  { id: 'panel.groundRail.GND_LEFT', x: 45, y: 126.5, label: 'GND' },
  { id: 'panel.groundRail.GND_RIGHT', x: 236, y: 126.5, label: 'GND' },
  { id: 'bottom.variableDcv.GND', x: 24, y: 160, label: 'GND' },
];
export const GROUND_SOCKETS = BASE_GROUND_SOCKETS.map((ground) => ({ ...ground, x: expandX(ground.x) }));

export const CABLE_COLORS: { value: CableColor; label: string; stroke: string }[] = [
  { value: 'red', label: 'Red', stroke: '#b3362d' }, { value: 'black', label: 'Black', stroke: '#202124' },
  { value: 'yellow', label: 'Yellow', stroke: '#c9a021' }, { value: 'green', label: 'Green', stroke: '#347c49' },
  { value: 'blue', label: 'Blue', stroke: '#2864a0' }, { value: 'white', label: 'White', stroke: '#f3f0df' },
];

export const INITIAL_PANEL_RECT = { x: 0, y: 0, width: PANEL.width, height: PANEL.height } as const;
