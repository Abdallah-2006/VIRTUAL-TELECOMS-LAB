import type { ModuleDefinition, ParameterDefinition, PortDefinition } from '../types';

const analog = (name: string, description: string, optional = false): PortDefinition => ({ name, signalType: 'analog', description, optional });
const digital = (name: string, description: string, optional = false): PortDefinition => ({ name, signalType: 'digital', description, optional });
const range = (key: string, label: string, min: number, max: number, step: number, unit?: string, approximate = false): ParameterDefinition => ({ key, label, kind: 'range', min, max, step, unit, approximate });
const select = (key: string, label: string, options: [string, string][], approximate = false): ParameterDefinition => ({ key, label, kind: 'select', options: options.map(([label, value]) => ({ label, value })), approximate });

export const moduleDefinitions: ModuleDefinition[] = [
  {
    type: 'adder.variable', name: 'Variable Adder', shortName: 'ADD', category: 'Top-row Adder',
    description: 'Physical two-input ETT-101 Adder with independent inverting G and g gains.', version: 2,
    documentation: { equation: 'y[n] = −G·A[n] − g·B[n]', practicalUse: 'Combine two signals, set their relative contributions, or use one input as a variable-gain amplifier.', assumptions: 'Both gain ranges are 0–2; the manufacturer manual describes each as inverting.' },
    inputs: [analog('A', 'Adder input A'), analog('B', 'Adder input B')], outputs: [analog('GA+gB', 'Inverting weighted sum')],
    parameters: [range('gainA', 'G', 0, 2, 0.01, '×'), range('gainB', 'g', 0, 2, 0.01, '×')],
    defaults: { gainA: 1, gainB: 1 }, processor: 'adderVariable', implemented: true,
  },
  {
    type: 'adder.channel', name: 'Channel Adder', shortName: 'CH ADD', category: 'Channel Module',
    description: 'Fixed-unity Adder embedded in the Channel Module.', version: 2,
    documentation: { equation: 'y[n] = NOISE[n] + SIGNAL[n]', practicalUse: 'Add a noise source to the transmitted channel signal.' },
    inputs: [analog('NOISE', 'Noise input'), analog('SIGNAL', 'Signal input')], outputs: [analog('CHANNEL_OUT', 'Composite channel output')],
    parameters: [], defaults: {}, processor: 'adderFixed', implemented: true,
  },
  {
    type: 'multiplier.four', name: 'Multiplier · X/Y AC + DC', shortName: 'MUL', category: 'Top-row Multiplier',
    description: 'Upper physical Multiplier. AC and DC sockets are separate on each multiplier axis.', version: 2,
    documentation: { equation: 'y[n] = (X_DC[n] + X_AC[n])·(Y_DC[n] + Y_AC[n])', practicalUse: 'Multiply real message and carrier signals to produce DSB-SC sidebands.', assumptions: 'Unconnected AC/DC alternatives contribute zero; at least one X and one Y input must be patched.' },
    inputs: [analog('X_DC', 'X-axis DC input', true), analog('X_AC', 'X-axis AC input', true), analog('Y_DC', 'Y-axis DC input', true), analog('Y_AC', 'Y-axis AC input', true)],
    outputs: [analog('kXY', 'Product output')], parameters: [], defaults: {}, processor: 'multiplier', implemented: true,
  },
  {
    type: 'multiplier.two', name: 'Multiplier', shortName: 'MUL', category: 'Multiplier',
    description: 'Physical two-input ETT-101 Multiplier.', version: 2,
    documentation: { equation: 'y[n] = X_DC[n]·Y_DC[n]', practicalUse: 'Multiply a connected message and carrier; the ideal DSB-SC carrier term is suppressed.' },
    inputs: [analog('X_DC', 'X-axis input'), analog('Y_DC', 'Y-axis input')], outputs: [analog('kXY', 'Product output')],
    parameters: [], defaults: {}, processor: 'multiplier', implemented: true,
  },
  {
    type: 'pulse.twin', name: 'Twin Pulse Generator', shortName: 'TPG', category: 'Top-row Timing',
    description: 'Generates two clock-synchronized digital pulses with adjustable width and delay.', version: 2,
    documentation: { equation: 'Q1,Q2 = pulseTrain(CLK↑, width, delay)', practicalUse: 'Provide timing and two related pulse trains for sampling and digital circuits.', assumptions: 'Q2 delay is measured from Q1; pulse behavior is edge-triggered at the sampled clock.' },
    inputs: [digital('CLK', 'Clock input')], outputs: [digital('Q1', 'Pulse output 1'), digital('Q2', 'Delayed pulse output 2')],
    parameters: [range('widthUs', 'WIDTH', 5, 40, 1, 'µs'), range('delayUs', 'DELAY', 50, 300, 1, 'µs')],
    defaults: { widthUs: 20, delayUs: 100 }, processor: 'twinPulse', implemented: true,
  },
  {
    type: 'switch.dual', name: 'Dual Analog Switch + S&H', shortName: 'SW', category: 'Top-row Switching',
    description: 'Two-control analog selector and the neighboring sample-and-hold function.', version: 2,
    documentation: { equation: 'OUT = selected(IN1, IN2, CONTROL1, CONTROL2); S&H_OUT holds the last sampled S&H_IN', practicalUse: 'Route analog signals under digital control or sample-and-hold a signal.', assumptions: 'Control truth table is an explicit software approximation pending a complete switching truth table; S&H acquires on CONTROL1 rising edges.' },
    inputs: [analog('IN1', 'Analog switch input 1', true), digital('CONTROL1', 'Digital switch/sample control 1', true), digital('CONTROL2', 'Digital switch control 2', true), analog('IN2', 'Analog switch input 2', true), analog('S&H_IN', 'Sample-and-hold input', true)],
    outputs: [analog('OUT', 'Selected analog output'), analog('S&H_OUT', 'Sample-and-hold output')],
    parameters: [], defaults: {}, processor: 'dualSwitch', implemented: true,
  },
  {
    type: 'source.noise', name: 'Noise Generator', shortName: 'NOISE', category: 'Top-row Channel and Noise',
    description: 'Seeded broadband noise source with the physical 0, −6 and −20 dB output taps.', version: 2,
    documentation: { equation: 'x[n] = scale · seededWhiteNoise[n]', practicalUse: 'Inject repeatable broadband noise into the Channel Module or other analog input.', assumptions: 'A deterministic seed ensures repeatable experiments; source specification is 10 Hz to below 240 kHz, approximated by band-limited white noise.' },
    inputs: [], outputs: [analog('0dB', 'Nominal noise output'), analog('-6dB', '−6 dB attenuated output'), analog('-20dB', '−20 dB attenuated output')],
    parameters: [], defaults: {}, processor: 'noise', implemented: true,
  },
  {
    type: 'utility.buffer', name: 'Buffer / Amplifier', shortName: 'BUF', category: 'Top-row Buffer',
    description: 'Variable-gain analog amplifier with local headphone-monitor connector.', version: 2,
    documentation: { equation: 'y[n] = GAIN·x[n]', practicalUse: 'Increase a small signal or attenuate a larger signal before measuring or transmitting.', assumptions: 'The manual documents gain 0–10 and bandwidth DC–approximately 700 kHz.' },
    inputs: [analog('IN', 'Buffer input')], outputs: [analog('OUT', 'Amplified output')],
    parameters: [range('gain', 'GAIN', 0, 10, 0.01, '×')], defaults: { gain: 1 }, processor: 'buffer', implemented: true,
  },
  {
    type: 'filter.channelBpf', name: 'Channel BPF', shortName: 'BPF', category: 'Channel Module',
    description: 'Band-pass section in the Channel Module.', version: 2,
    documentation: { equation: 'y[n] = BPF100kHz,24kHz(x[n])', practicalUse: 'Model the nominal channel passband around 100 kHz.', assumptions: 'Butterworth approximation to the documented 100 kHz center, 24 kHz passband; exact measured response is not supplied.' },
    inputs: [analog('IN', 'Channel BPF input')], outputs: [analog('OUT', 'Channel BPF output')], parameters: [], defaults: {}, processor: 'channelBpf', implemented: true,
  },
  {
    type: 'filter.baseband', name: 'Baseband LPF', shortName: 'BB LPF', category: 'Channel Module',
    description: 'Fixed baseband low-pass section in the Channel Module.', version: 2,
    documentation: { equation: 'y[n] = LPF1.6kHz(x[n])', practicalUse: 'Reject high-frequency channel content and recover the baseband component.', assumptions: 'Second-order Butterworth approximation to the documented 1.6 kHz cutoff.' },
    inputs: [analog('IN', 'Baseband LPF input')], outputs: [analog('OUT', 'Baseband LPF output')], parameters: [], defaults: {}, processor: 'lowpass', implemented: true,
  },
  {
    type: 'phase.shifter', name: 'Phase Shifter', shortName: 'PHASE', category: 'Top-row Signal Processing',
    description: 'Adjustable analog phase shifter with 0°/180° switch and LO status indicator.', version: 2,
    documentation: { equation: 'y(t) ≈ cos(θ)x(t) + sin(θ)·Hilbert{x(t)}', practicalUse: 'Create a phase-adjusted carrier/local oscillator for coherent demodulation and SSB experiments.', assumptions: 'Finite FIR Hilbert approximation; documented low/high operating-band behavior is simplified. LO mark is treated as an indicator, not a port.' },
    inputs: [analog('IN', 'Phase shifter input')], outputs: [analog('OUT', 'Phase-adjusted output')],
    parameters: [range('phaseDegrees', 'PHASE', 0, 180, 1, '°'), select('invert', 'PHASE SELECT', [['0°', 'normal'], ['180°', 'invert']])],
    defaults: { phaseDegrees: 90, invert: 'normal' }, processor: 'phaseShifter', implemented: true,
  },
  {
    type: 'utility.comparator', name: 'Comparator', shortName: 'COMP', category: 'Top-row Utilities',
    description: 'Compares an analog input against a reference and produces a digital-level output.', version: 2,
    documentation: { equation: 'OUT[n] = IN[n] ≥ REF[n] ? 1 : 0', practicalUse: 'Convert an analog threshold crossing into a digital pulse/logic signal.', assumptions: 'Logic samples are represented as 0/5 V in this simulator.' },
    inputs: [analog('REF', 'Reference input'), analog('IN', 'Signal input')], outputs: [digital('OUT', 'Comparator logic output')], parameters: [], defaults: {}, processor: 'comparator', implemented: true,
  },
  {
    type: 'utility.rectifier', name: 'Rectifier', shortName: 'RECT', category: 'Top-row Utilities',
    description: 'Rectifies a connected analog signal.', version: 2,
    documentation: { equation: 'y[n] = |x[n]|', practicalUse: 'Expose the envelope of an amplitude-modulated signal for a detector experiment.', assumptions: 'Ideal full-wave model; the source does not specify diode drops or exact topology.' },
    inputs: [analog('IN', 'Rectifier input')], outputs: [analog('OUT', 'Rectified output')], parameters: [], defaults: {}, processor: 'rectifier', implemented: true,
  },
  {
    type: 'filter.diodeRc', name: 'Diode & RC LPF', shortName: 'DIODE RC', category: 'Top-row Utilities',
    description: 'Diode/envelope and RC smoothing section.', version: 2,
    documentation: { equation: 'y[n] = RC_smooth(max(x[n], 0))', practicalUse: 'Demonstrate a practical envelope-detector path for AM.', assumptions: 'Ideal diode and first-order RC response; component values are approximated.' },
    inputs: [analog('IN', 'Diode/RC input')], outputs: [analog('OUT', 'Smoothed envelope')], parameters: [], defaults: {}, processor: 'diodeEnvelope', implemented: true,
  },
  {
    type: 'filter.rc', name: 'RC LPF', shortName: 'RC', category: 'Top-row Utilities',
    description: 'Fixed first-order RC low-pass section.', version: 2,
    documentation: { equation: 'y[n] = (1−α)y[n−1] + αx[n]', practicalUse: 'Remove high-frequency components and smooth a detected envelope.', assumptions: 'Cutoff is an educational approximation because the base-panel component value is not documented.' },
    inputs: [analog('IN', 'RC filter input')], outputs: [analog('OUT', 'RC filter output')], parameters: [], defaults: {}, processor: 'lowpass', implemented: true,
  },
  {
    type: 'filter.tunable', name: 'Tuneable LPF', shortName: 'LPF', category: 'Top-row Filters',
    description: 'Adjustable ETT-101 low-pass filter, gain and ×100 cutoff-monitor output.', version: 2,
    documentation: { equation: 'OUT = GAIN·LPF8(x, fc); fc_x100 = 100·fc', practicalUse: 'Remove a carrier or high-frequency noise and observe the measured cutoff reference.', assumptions: 'Stable eighth-order Butterworth approximation, not a measured elliptic transfer. Manual and specification sheets disagree on fc/gain ranges; current control is explicitly approximate.' },
    inputs: [analog('IN', 'Filter input')], outputs: [analog('OUT', 'Low-pass output'), digital('fc_x100', 'Square-wave cutoff monitor at 100 × fc')],
    parameters: [range('cutoffHz', 'fc', 300, 16000, 10, 'Hz', true), range('gain', 'GAIN', 0, 2, 0.01, '×')],
    defaults: { cutoffHz: 6000, gain: 1 }, processor: 'lowpass', implemented: true,
  },
  {
    type: 'source.variableDc', name: 'Variable DCV', shortName: 'VDC', category: 'Bottom-left Sources',
    description: 'Adjustable analog DC level and fixed +5 V digital-level output.', version: 2,
    documentation: { equation: 'VDC(t)=v; +5V(t)=5 V', practicalUse: 'Provide a DC bias or digital logic-high reference to a circuit.', assumptions: 'The VDC range is ±2.5 V; +5 V is represented as a 5 V constant signal.' },
    inputs: [], outputs: [analog('VDC', 'Adjustable DC analog output'), digital('+5V', 'Fixed +5 V logic-level output')],
    parameters: [range('voltage', 'VDC', -2.5, 2.5, 0.01, 'V')], defaults: { voltage: 0 }, processor: 'variableDc', implemented: true,
  },
  {
    type: 'source.speech', name: 'Speech', shortName: 'MIC', category: 'Bottom-left Sources',
    description: 'Live audio input from the device microphone, filtered to the documented voice band.', version: 2,
    documentation: { equation: 'OUT[n] = resampledLiveMicrophone[n]', practicalUse: 'Use spoken audio as a real analog message input for modulation experiments.', assumptions: 'Requires an explicit browser microphone permission. No synthetic speech is substituted when unavailable.' },
    inputs: [], outputs: [analog('OUT', 'Live microphone analog output')], parameters: [], defaults: {}, processor: 'speech', implemented: true,
  },
  {
    type: 'digital.xor', name: 'EXOR', shortName: 'EXOR', category: 'Bottom-left Digital',
    description: 'Exclusive-OR of two digital input signals.', version: 2,
    documentation: { equation: 'OUT = A ⊕ B', practicalUse: 'Build digital logic and phase-shift keying demonstrations.', assumptions: 'Inputs use 0 V low and 5 V high.' },
    inputs: [digital('A', 'Digital input A'), digital('B', 'Digital input B')], outputs: [digital('A_XOR_B', 'Exclusive-OR output')], parameters: [], defaults: {}, processor: 'xor', implemented: true,
  },
  {
    type: 'vco', name: 'Voltage-Controlled Oscillator', shortName: 'VCO', category: 'Bottom-row Sources',
    description: 'Analog control input drives analog sine and digital clock outputs.', version: 2,
    documentation: { equation: 'f(t)=f₀(range,FREQ)+k_v·VCO_INPUT(t)', practicalUse: 'Generate adjustable carriers and FM by connecting the message to the frequency-control input.', assumptions: 'Linear frequency-control characteristic within the selected 1–17 kHz LO or 60–140 kHz HI band.' },
    inputs: [analog('VCO_INPUT', 'Frequency-control input', true)], outputs: [analog('SINE', 'Oscillator sine output'), digital('DIGITAL', 'Oscillator square/logic output')],
    parameters: [range('frequencyControl', 'FREQ', 0, 1, 0.001), range('gain', 'GAIN', 0, 2, 0.01, '×'), select('range', 'RANGE', [['LO', 'low'], ['HI', 'high']])],
    defaults: { frequencyControl: 0.5, gain: 1, range: 'low' }, processor: 'vco', implemented: true,
  },
  {
    type: 'sequence.lineCode', name: 'Sequence Generator / Line Code', shortName: 'SEQ', category: 'Bottom-row Digital',
    description: 'Clocked X/Y pseudo-random sequences, sync output and physical line-code output.', version: 2,
    documentation: { equation: 'X = PRBS31; Y = PRBS255; LINE_CODE = encode(X, mode)', practicalUse: 'Provide clocked digital test patterns and line-code waveforms.', assumptions: 'Maximal-length LFSRs and the documented standard code families are modeled; exact tap/state-reset details are configurable approximations.' },
    inputs: [digital('CLK', 'Digital clock input')], outputs: [digital('SYNC', 'Sequence synchronization output'), digital('X', '31-bit sequence'), digital('Y', '255-bit sequence'), analog('LINE_CODE', 'Bipolar line-code output')],
    parameters: [select('lineCode', 'LINE CODE', [['NRZ-L', 'nrz-l'], ['Bi-Φ', 'biphase'], ['RZ-AMI', 'rz-ami'], ['NRZ-M', 'nrz-m']])],
    defaults: { lineCode: 'nrz-l' }, processor: 'sequence', implemented: true,
  },
  {
    type: 'divider', name: 'Divider', shortName: '÷N', category: 'Bottom-row Digital',
    description: 'Clock-edge frequency divider with the documented ÷1/÷2/÷4/÷8 selections.', version: 2,
    documentation: { equation: 'f_out = f_in / N', practicalUse: 'Derive slower sample/bit clocks from a digital master reference.', assumptions: 'For N>1 a 50% duty-cycle edge divider is used.' },
    inputs: [digital('IN', 'Digital clock input')], outputs: [digital('OUT', 'Divided clock output')],
    parameters: [select('ratio', 'DIVIDE', [['÷1', '1'], ['÷2', '2'], ['÷4', '4'], ['÷8', '8']])], defaults: { ratio: '2' }, processor: 'divider', implemented: true,
  },
  {
    type: 'pcm.encoder', name: 'PCM Encoder', shortName: 'PCM ENC', category: 'Bottom-row Sampling and PCM',
    description: 'Samples and quantizes connected analog inputs into an actual serial digital PCM stream.', version: 2,
    documentation: { equation: 'q[n]=round((x[n]-xmin)/(xmax-xmin)·(2^8−1))', practicalUse: 'Explore clocked sampling, quantization and serial PCM framing.', assumptions: 'Eight-bit uniform quantization; PCM/TDM selector is saved and controls the framing mode.' },
    inputs: [analog('INPUT1', 'Analog input 1'), analog('INPUT2', 'Analog input 2', true), digital('CLK', 'Bit clock input')], outputs: [digital('PCM_DATA', 'Serial PCM data'), digital('FS', 'Frame synchronization')],
    parameters: [select('mode', 'MODE', [['PCM', 'pcm'], ['TDM', 'tdm']])], defaults: { mode: 'pcm' }, processor: 'pcmEncoder', implemented: true,
  },
  {
    type: 'source.masterSignals', name: 'Master Signals', shortName: 'MASTER', category: 'Bottom-row References',
    description: 'Six fixed analog and digital calibration/test references.', version: 2,
    documentation: { equation: '100 kHz sine/cosine; digital 100 kHz, 8.333 kHz, 2.083 kHz; 2.083 kHz sine', practicalUse: 'Provide stable message, carrier and timing references used by the physical trainer experiments.', assumptions: 'Printed labels are rounded; the manufacturer specifications give 8.333 kHz and 2.083 kHz where applicable.' },
    inputs: [], outputs: [analog('100kHz_SINE', '100 kHz sine reference'), analog('100kHz_COS', '100 kHz cosine reference'), digital('100kHz_DIGITAL', '100 kHz digital reference'), digital('8kHz_DIGITAL', '8.333 kHz digital reference'), digital('2kHz_DIGITAL', '2.083 kHz digital reference'), analog('2kHz_SINE', '2.083 kHz sine message reference')],
    parameters: [], defaults: {}, processor: 'masterSignals', implemented: true,
  },
  {
    type: 'serial.parallel', name: 'Serial-to-Parallel', shortName: 'S/P', category: 'Bottom-row Sampling and PCM',
    description: 'Samples serial bits on clock edges and presents two bipolar parallel data outputs.', version: 2,
    documentation: { equation: 'X1,X2 = bipolarDecode(SERIAL, CLK)', practicalUse: 'Inspect and reconstruct parallel data from a clocked serial stream.', assumptions: 'Bits are paired in order and represented as bipolar analog levels on the two outputs.' },
    inputs: [digital('SERIAL', 'Serial data input'), digital('CLK', 'Clock input')], outputs: [analog('X1', 'Parallel channel 1 bipolar output'), analog('X2', 'Parallel channel 2 bipolar output')],
    parameters: [], defaults: {}, processor: 'serialToParallel', implemented: true,
  },
  {
    type: 'pcm.decoder', name: 'PCM Decoder', shortName: 'PCM DEC', category: 'Bottom-row Sampling and PCM',
    description: 'Decodes serial PCM bits and reconstructs analog output signals.', version: 2,
    documentation: { equation: 'OUT[n] = dequantize(PCM_DATA, FS, CLK)', practicalUse: 'Demonstrate quantized reconstruction and compare the recovered waveform against its source.', assumptions: 'Eight-bit uniform PCM decoder; TDM ring mark remains an indicator pending physical confirmation.' },
    inputs: [digital('FS', 'Frame-sync input'), digital('PCM_DATA', 'Serial PCM data input'), digital('CLK', 'Bit clock input')], outputs: [analog('OUTPUT2', 'Reconstructed output 2'), analog('OUTPUT', 'Reconstructed analog output')],
    parameters: [], defaults: {}, processor: 'pcmDecoder', implemented: true,
  },
];

export const moduleByType = new Map(moduleDefinitions.map((definition) => [definition.type, definition]));
export const categories = [...new Set(moduleDefinitions.map((definition) => definition.category))];
