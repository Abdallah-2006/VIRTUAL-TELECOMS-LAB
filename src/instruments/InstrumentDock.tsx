import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AudioLines, ChartNoAxesCombined, ChevronDown, Play, Radio, ScanLine, Square } from 'lucide-react';
import type { Project, ScopeChannel, SignalBuffer, SimulationResult, SpectrumWindow } from '../types';
import type { SpectrumBin } from '../engine/fft';
import { calculateSpectrum } from '../engine/fft';
import { measureSignal } from '../engine/measurements';
import { moduleByType } from '../modules/registry';

interface Props {
  project: Project;
  result: SimulationResult | null;
  onInstrumentChange: (patch: Partial<Project['instruments']>) => void;
  stale: boolean;
  running: boolean;
  onToggleRun: () => void;
  onSingleCapture: () => void;
  onCaptureChange?: (sampleCount: number) => void;
}
const traceVars = ['var(--ch1)', 'var(--ch2)', 'var(--ch3)', 'var(--ch4)'];
const cssVar = (name: string, fallback: string) => (typeof document === 'undefined' ? fallback : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);
const resolveTraceColors = () => ['--ch1', '--ch2', '--ch3', '--ch4'].map((name, index) => cssVar(name, ['#d6bb51', '#5fc2ad', '#e37e68', '#829ae0'][index]));
const EMPTY_OUTPUTS: Record<string, SignalBuffer> = {};
const spanOptions = [5_000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000, 2_000_000, 4_000_000];
const timeOptions = [0.000001, 0.000002, 0.000005, 0.00001, 0.00002, 0.00005, 0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005];
const captureOptions = [16_384, 32_768, 65_536, 131_072, 262_144];
const voltsOptions = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20];
const channelOrder: ScopeChannel['id'][] = ['CH1', 'CH2', 'CH3', 'CH4'];

function useCanvas(draw: (context: CanvasRenderingContext2D, width: number, height: number) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const render = () => {
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(bounds.width * ratio);
      canvas.height = Math.round(bounds.height * ratio);
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw(context, bounds.width, bounds.height);
    };
    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
    // The explicit dependency list is the canvas redraw contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

function drawGrid(context: CanvasRenderingContext2D, width: number, height: number) {
  context.clearRect(0, 0, width, height);
  const major = cssVar('--scope-grid-major', '#5e5e5e'), minor = cssVar('--scope-grid', '#2e2e2e');
  context.fillStyle = cssVar('--scope-bg', '#000'); context.fillRect(0, 0, width, height);
  for (let column = 0; column <= 10; column += 1) {
    const x = (width * column) / 10;
    context.lineWidth = column === 5 ? 1.25 : 0.75;
    context.strokeStyle = column === 5 ? major : minor;
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
  }
  for (let row = 0; row <= 8; row += 1) {
    const y = (height * row) / 8;
    context.lineWidth = row === 4 ? 1.25 : 0.75;
    context.strokeStyle = row === 4 ? major : minor;
    context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
  }
  context.fillStyle = cssVar('--scope-dot', '#5e5e5e');
  for (let column = 1; column < 10; column += 1) for (let row = 1; row < 8; row += 1) {
    context.beginPath(); context.arc((width * column) / 10, (height * row) / 8, 0.7, 0, 2 * Math.PI); context.fill();
  }
}

function drawOscilloscope(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  channels: ScopeChannel[],
  signals: Record<string, SignalBuffer>,
  timePerDiv: number,
  triggerSource: ScopeChannel['id'],
  triggerLevel: number,
  triggerMode: Project['instruments']['triggerMode'],
  running: boolean,
  timeOffset: number,
) {
  drawGrid(context, width, height);
  const colors = resolveTraceColors();
  const source = channels.find((channel) => channel.id === triggerSource);
  const triggerSignal = source?.enabled ? signals[source.sourceKey] : undefined;
  const spanSeconds = timePerDiv * 10;
  // One common timebase for every channel. Edge trigger (rising slope) on the chosen channel: the sweep starts at the crossing,
  // as on a real scope. AUTO free-runs when there is no edge; NORMAL/SINGLE show nothing until an edge is found.
  let startIndex = 0;
  let triggered = false;
  if (triggerSignal && triggerSignal.samples.length > 2) {
    const needed = Math.min(Math.round(triggerSignal.sampleRate * spanSeconds), Math.floor(triggerSignal.samples.length / 2));
    const samples = triggerSignal.samples;
    for (let index = 1; index < samples.length - needed; index += 1) {
      if (samples[index - 1] < triggerLevel && samples[index] >= triggerLevel) { startIndex = index; triggered = true; break; }
    }
  }
  const showTraces = triggerMode === 'auto' || triggered || !triggerSignal;
  for (let channelIndex = 0; showTraces && channelIndex < channels.length; channelIndex += 1) {
    const channel = channels[channelIndex];
    const signal = channel.enabled ? signals[channel.sourceKey] : undefined;
    if (!signal?.samples.length) continue;
    const wanted = Math.max(2, Math.round(signal.sampleRate * spanSeconds));
    const first = Math.max(0, Math.min(startIndex + Math.round(signal.sampleRate * timeOffset), signal.samples.length - 2));
    const count = Math.min(wanted, signal.samples.length - first);
    if (count < 2) continue;
    // If the captured block is shorter than the screen span only that fraction of the screen is drawn (no stretching).
    const drawWidth = width * (count / wanted);
    const voltsPerDiv = Math.max(0.000001, channel.voltsPerDiv);
    const yOf = (volts: number) => height / 2 - (volts / voltsPerDiv + channel.verticalPosition) * (height / 8);
    context.save(); context.beginPath(); context.rect(0, 0, width, height); context.clip();
    context.strokeStyle = colors[channelIndex]; context.lineWidth = 1.65; context.beginPath();
    const pixels = Math.max(2, Math.ceil(drawWidth));
    const perPixel = count / pixels;
    if (perPixel <= 1.5) {
      for (let pixel = 0; pixel < pixels; pixel += 1) {
        const position = first + (pixel / Math.max(1, pixels - 1)) * (count - 1);
        const lower = Math.floor(position), upper = Math.min(signal.samples.length - 1, lower + 1);
        const value = signal.samples[lower] + (signal.samples[upper] - signal.samples[lower]) * (position - lower);
        const x = (pixel / Math.max(1, pixels - 1)) * drawWidth;
        if (pixel === 0) context.moveTo(x, yOf(value)); else context.lineTo(x, yOf(value));
      }
    } else {
      // Many samples per pixel: draw the min/max envelope so fast carriers are never aliased away.
      for (let pixel = 0; pixel < pixels; pixel += 1) {
        const i0 = first + Math.floor(pixel * perPixel), i1 = Math.min(first + count, first + Math.floor((pixel + 1) * perPixel) + 1);
        let low = Infinity, high = -Infinity;
        for (let i = i0; i < i1; i += 1) { const v = signal.samples[i]; if (v < low) low = v; if (v > high) high = v; }
        const x = (pixel / Math.max(1, pixels - 1)) * drawWidth;
        if (pixel === 0) context.moveTo(x, yOf(low)); else context.lineTo(x, yOf(low));
        context.lineTo(x, yOf(high));
      }
    }
    context.stroke(); context.restore();
  }
  if (!showTraces) {
    context.fillStyle = cssVar('--scope-hold', '#d2d2d2'); context.font = '600 10px monospace'; context.fillText('NO TRIG', 12, 19);
  }
  if (!running) {
    context.fillStyle = cssVar('--scope-bg', '#000'); context.fillRect(width - 63, 7, 54, 17);
    context.fillStyle = cssVar('--scope-hold', '#d2d2d2'); context.font = '600 10px monospace'; context.fillText('HOLD', width - 49, 19);
  }
}

function niceSpan(frequency: number, nyquist: number): number {
  const wanted = frequency * 1.6;
  return spanOptions.find((option) => option >= wanted && option <= nyquist) ?? Math.min(nyquist, spanOptions[spanOptions.length - 1]);
}

function useSpectrum({ channels, windowType, span }: { channels: { id: ScopeChannel['id']; index: number; signal: SignalBuffer }[]; windowType: SpectrumWindow; span: number | 'auto' }) {
  const spectra = useMemo(() => channels.map((channel) => {
    let bins: SpectrumBin[] = [];
    try { bins = calculateSpectrum(channel.signal, windowType); } catch { bins = []; }
    return { id: channel.id, index: channel.index, bins };
  }), [channels, windowType]);
  const nyquist = Math.min(channels.length ? Math.max(...channels.map((channel) => channel.signal.sampleRate / 2)) : 4_000_000, 4_000_000);
  const maximumFrequency = useMemo(() => {
    if (span !== 'auto') return Math.min(span, nyquist);
    let peak = 0;
    for (const spectrum of spectra) for (const bin of spectrum.bins) peak = Math.max(peak, bin.magnitude);
    let highest = 0;
    for (const spectrum of spectra) for (const bin of spectrum.bins) if (bin.magnitude >= peak * 0.02) highest = Math.max(highest, Math.abs(bin.frequency));
    return niceSpan(highest || 10_000, nyquist);
  }, [spectra, span, nyquist]);
  const visible = useMemo(() => spectra.map((spectrum) => ({ ...spectrum, bins: spectrum.bins.filter((bin) => Math.abs(bin.frequency) <= maximumFrequency) })), [spectra, maximumFrequency]);
  const peaks = useMemo(() => visible.flatMap((spectrum) => {
    const { bins } = spectrum;
    if (bins.length < 4) return [];
    const binWidth = Math.abs(bins[1].frequency - bins[0].frequency) || 1;
    const floor = Math.max(...bins.map((bin) => bin.magnitude)) * 0.02;
    return bins.slice(1, -1).map((bin, index) => ({ ...bin, index: index + 1 }))
      .filter((bin) => bin.magnitude > floor && bin.magnitude > bins[bin.index - 1].magnitude && bin.magnitude >= bins[bin.index + 1].magnitude)
      .map((bin) => {
        // Parabolic interpolation in log magnitude: removes bin-centre and scalloping error of the peak frequency/height.
        const la = Math.log(Math.max(bins[bin.index - 1].magnitude, 1e-300)), lb = Math.log(bin.magnitude), lc = Math.log(Math.max(bins[bin.index + 1].magnitude, 1e-300));
        const denominator = la - 2 * lb + lc;
        const delta = denominator < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (la - lc) / denominator)) : 0;
        const magnitude = Math.exp(lb - 0.25 * (la - lc) * delta);
        const frequency = bin.frequency + delta * binWidth;
        // The display is two-sided: a real tone of amplitude A shows A/2 at ±f, but a DC level shows its full value.
        const amplitude = Math.abs(frequency) < binWidth * 1.5 ? magnitude : 2 * magnitude;
        return { frequency, magnitude, amplitude, id: spectrum.id, color: '' };
      })
      .sort((a, b) => b.magnitude - a.magnitude).slice(0, 4);
  }).sort((a, b) => b.magnitude - a.magnitude), [visible]);
  const ref = useCanvas((context, width, height) => {
    drawGrid(context, width, height);
    const colors = resolveTraceColors();
    let maximum = 0.00001;
    for (const spectrum of visible) for (const bin of spectrum.bins) maximum = Math.max(maximum, bin.magnitude);
    maximum *= 1.1;
    const xOf = (frequency: number) => ((frequency + maximumFrequency) / (2 * maximumFrequency)) * width;
    const yOf = (magnitude: number) => height - (magnitude / maximum) * (height * 0.9) - height * 0.04;
    for (const spectrum of visible) {
      if (!spectrum.bins.length) continue;
      context.strokeStyle = colors[spectrum.index]; context.lineWidth = 1.5; context.beginPath();
      spectrum.bins.forEach((bin, index) => { if (index === 0) context.moveTo(xOf(bin.frequency), yOf(bin.magnitude)); else context.lineTo(xOf(bin.frequency), yOf(bin.magnitude)); });
      context.stroke();
    }
    for (const peak of peaks) {
      const channel = visible.find((spectrum) => spectrum.id === peak.id);
      context.fillStyle = colors[channel?.index ?? 0]; context.beginPath(); context.arc(xOf(peak.frequency), yOf(peak.magnitude), 3, 0, 2 * Math.PI); context.fill();
    }
  }, [visible, peaks, maximumFrequency]);
  const leadPeaks = visible.flatMap((spectrum) => { const own = peaks.filter((peak) => peak.id === spectrum.id); const lead = own.find((peak) => peak.frequency > 0) ?? own[0]; return lead ? [lead] : []; });
  return { ref, peaks, leadPeaks, maximumFrequency, spectra };
}

function frequencyLabel(frequency: number): string {
  return frequency >= 1_000_000 ? `${(frequency / 1_000_000).toFixed(1)} MHz` : frequency >= 1000 ? `${Number((frequency / 1000).toFixed(frequency >= 10_000 ? 0 : 1))} kHz` : `${Math.round(frequency)} Hz`;
}
function outputLabel(key: string, project: Project): string {
  const [id, port] = key.split(':');
  const instance = project.modules.find((module) => module.id === id);
  const definition = instance ? moduleByType.get(instance.type) : undefined;
  return `${definition?.shortName ?? 'OUT'} · ${port}`;
}

export function InstrumentDock({ project, result, onInstrumentChange, stale, running, onToggleRun, onSingleCapture, onCaptureChange }: Props) {
  const [heldResult, setHeldResult] = useState<SimulationResult | null>(result);
  useEffect(() => { if (result) setHeldResult(result); }, [result]);
  const displayResult = running ? result : heldResult;
  const outputs = displayResult?.outputs ?? EMPTY_OUTPUTS;
  const [spectrumSpan, setSpectrumSpan] = useState<number | 'auto'>('auto');
  const channels = project.instruments.scopeChannels;
  const channelSignals = channels.map((channel) => outputs[channel.sourceKey] ?? null);
  const enabledSignals = channels.flatMap((channel, index) => channel.enabled && channelSignals[index] ? [channelSignals[index]!] : []);
  const measured = enabledSignals[0] ? measureSignal(enabledSignals[0]) : null;
  const activeSpectrumChannels = useMemo(() => channels.flatMap((channel, index) => channel.enabled && channelSignals[index] ? [{ id: channel.id, index, signal: channelSignals[index]! }] : []), [channels, outputs]);
  const spectrum = useSpectrum({ channels: activeSpectrumChannels, windowType: project.instruments.spectrumWindow, span: spectrumSpan });
  const scopeRef = useCanvas((context, width, height) => drawOscilloscope(context, width, height, channels, outputs, project.instruments.timePerDiv, project.instruments.triggerSource, project.instruments.triggerLevel, project.instruments.triggerMode, running, project.instruments.timeOffset ?? 0), [channels, outputs, project.instruments.timePerDiv, project.instruments.triggerSource, project.instruments.triggerLevel, project.instruments.triggerMode, running, project.instruments.timeOffset]);
  const setChannel = (id: ScopeChannel['id'], patch: Partial<ScopeChannel>) => onInstrumentChange({ scopeChannels: channels.map((channel) => channel.id === id ? { ...channel, ...patch } : channel) });
  const frequencyTicks = [-1, -0.5, 0, 0.5, 1].map((fraction) => frequencyLabel(spectrum.maximumFrequency * fraction));
  const autoSetup = () => {
    const probed = channels.some((channel) => channel.sourceKey);
    const active = channels.filter((channel) => !probed || channel.sourceKey);
    const step = Math.min(2.5, 6 / Math.max(1, active.length));
    const measures = active.map((channel) => { const signal = outputs[channel.sourceKey]; return signal ? measureSignal(signal) : null; });
    const frequencies = measures.flatMap((item) => item?.frequency ? [item.frequency] : []);
    const timePerDiv = frequencies.length ? timeOptions.reduce((best, option) => Math.abs(Math.log(option) - Math.log(2.5 / (Math.min(...frequencies) * 10))) < Math.abs(Math.log(best) - Math.log(2.5 / (Math.min(...frequencies) * 10))) ? option : best) : project.instruments.timePerDiv;
    const nextChannels = channels.map((channel) => {
      const slot = active.findIndex((item) => item.id === channel.id);
      const measure = slot >= 0 ? measures[slot] : null;
      const volts = measure ? voltsOptions.find((option) => measure.peakToPeak / option <= 6) ?? voltsOptions[voltsOptions.length - 1] : channel.voltsPerDiv;
      return { ...channel, enabled: slot >= 0, voltsPerDiv: volts, verticalPosition: slot >= 0 ? ((active.length - 1) / 2 - slot) * step : 0 };
    });
    onInstrumentChange({ scopeChannels: nextChannels, timePerDiv, triggerSource: active[0]?.id ?? 'CH1', triggerLevel: 0, triggerMode: 'auto', timeOffset: 0 });
  };
  return <section className="instrument-dock">
    <div className="instrument-panel oscilloscope-panel">
      <div className="instrument-head"><div className="instrument-title"><span className="instrument-icon scope-icon"><Activity size={15} /></span><div><span className="eyebrow">TIME DOMAIN / FOUR INDEPENDENT PROBES</span><h3>Oscilloscope <span className="instrument-model">4 CH · TWIN-TIMEBASE</span></h3></div></div><div className="scope-global-controls">
        <label><span>TIME / DIV</span><select aria-label="Time per division" value={project.instruments.timePerDiv} onChange={(event) => onInstrumentChange({ timePerDiv: Number(event.target.value) })}>{timeOptions.map((value) => <option key={value} value={value}>{value < 0.001 ? `${Number((value * 1e6).toFixed(3))} µs` : `${Number((value * 1e3).toFixed(3))} ms`}</option>)}</select></label>
        <label><span>CAPTURE</span><select aria-label="Capture length" value={project.settings.sampleCount} onChange={(event) => onCaptureChange?.(Number(event.target.value))}>{captureOptions.map((value) => <option key={value} value={value}>{`${Number(((value / project.settings.sampleRate) * 1000).toFixed(2))} ms`}</option>)}</select></label>
        <label><span>H POS</span><input aria-label="Horizontal position" type="range" min="0" max={Math.max(0, project.settings.sampleCount / project.settings.sampleRate - project.instruments.timePerDiv * 10)} step={project.instruments.timePerDiv / 10} value={Math.min(project.instruments.timeOffset ?? 0, Math.max(0, project.settings.sampleCount / project.settings.sampleRate - project.instruments.timePerDiv * 10))} onChange={(event) => onInstrumentChange({ timeOffset: Number(event.target.value) })} /></label>
        <button className="scope-action" onClick={autoSetup}><ScanLine size={12} /> AUTO SETUP</button>
        <button className={`scope-action ${running ? 'is-running' : 'is-hold'}`} onClick={() => !running && project.instruments.triggerMode === 'single' ? onSingleCapture() : onToggleRun()}>{running ? <Square size={11} fill="currentColor" /> : project.instruments.triggerMode === 'single' ? <ScanLine size={11} /> : <Play size={11} fill="currentColor" />} {running ? 'STOP' : project.instruments.triggerMode === 'single' ? 'SINGLE' : 'RUN'}</button>
      </div></div>
      <div className="scope-channel-controls">{channels.map((channel, index) => <div className={`scope-channel-control channel-${index + 1} ${channel.enabled ? 'enabled' : 'disabled'}`} key={channel.id}>
        <button className="channel-enable" onClick={() => setChannel(channel.id, { enabled: !channel.enabled })} aria-pressed={channel.enabled}><i style={{ '--channel-color': traceVars[index] } as React.CSSProperties} />{channel.id}</button>
        <label><span>V/DIV</span><select aria-label={`${channel.id} volts per division`} value={channel.voltsPerDiv} onChange={(event) => setChannel(channel.id, { voltsPerDiv: Number(event.target.value) })}>{voltsOptions.map((value) => <option key={value} value={value}>{value} V</option>)}</select></label>
        <label><span>POS</span><input aria-label={`${channel.id} vertical position`} type="range" min="-4" max="4" step="0.25" value={channel.verticalPosition} onChange={(event) => setChannel(channel.id, { verticalPosition: Number(event.target.value) })} /></label>
      </div>)}</div>
      <div className="scope-display-wrap"><div className="scope-y-axis"><span>+4 div</span><span>0 V</span><span>−4 div</span></div><div className="scope-display"><canvas className="instrument-canvas" ref={scopeRef} />{!enabledSignals.length && <div className="plot-empty"><ScanLine size={18} /><span>{stale ? 'Recalculating hardware outputs' : 'Connect EMONA outputs to CH1–CH4'}</span></div>}<div className="scope-time-label">{(project.instruments.timePerDiv * 10 * 1000).toFixed(3)} ms screen · {((project.settings.sampleCount / project.settings.sampleRate) * 1000).toFixed(3)} ms capture · {project.settings.sampleRate.toLocaleString()} Sa/s</div></div></div>
      {/* <div className="scope-trigger-controls"><label><span>TRIGGER SOURCE</span><select value={project.instruments.triggerSource} onChange={(event) => onInstrumentChange({ triggerSource: event.target.value as Project['instruments']['triggerSource'] })}>{channelOrder.map((id) => <option key={id} value={id}>{id}</option>)}</select></label><label><span>LEVEL</span><input type="number" step="0.1" value={project.instruments.triggerLevel} onChange={(event) => onInstrumentChange({ triggerLevel: Number(event.target.value) })} />V</label><label><span>MODE</span><select value={project.instruments.triggerMode} onChange={(event) => onInstrumentChange({ triggerMode: event.target.value as Project['instruments']['triggerMode'] })}><option value="auto">Auto</option><option value="normal">Normal</option><option value="single">Single</option></select></label><div className="scope-measurements">{[
        ['FREQ', measured?.frequency ? `${(measured.frequency / 1000).toFixed(2)} kHz` : '—'],
        ['PEAK', measured ? `${measured.peak.toFixed(3)} V` : '—'],
        ['VPP', measured ? `${measured.peakToPeak.toFixed(3)} V` : '—'],
        ['RMS', measured ? `${measured.rms.toFixed(3)} V` : '—'],
        ['MEAN', measured ? `${measured.mean.toFixed(3)} V` : '—'],
      ].map(([label, value]) => <div className="measurement-cell" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      </div> */}
      <div className="scope-channel-legend">{channels.map((channel, index) => <span key={channel.id} className={channel.enabled ? '' : 'disabled'} style={{ '--channel-color': traceVars[index] } as React.CSSProperties}><i />{channel.id} · {channel.sourceKey ? outputLabel(channel.sourceKey, project) : 'NO PROBE'}</span>)}</div>
    </div>
    <div className="instrument-panel spectrum-panel">
      <div className="instrument-head"><div className="instrument-title"><span className="instrument-icon spectrum-icon"><ChartNoAxesCombined size={15} /></span><div><span className="eyebrow">FREQUENCY DOMAIN / ACTIVE SCOPE CHANNELS</span><h3>Spectrum Analyzer</h3></div></div><div className="instrument-selectors"><label className="window-selector"><ChevronDown size={12} /><select aria-label="Spectrum span" value={spectrumSpan} onChange={(event) => setSpectrumSpan(event.target.value === 'auto' ? 'auto' : Number(event.target.value))}><option value="auto">Span: auto</option>{spanOptions.map((value) => <option key={value} value={value}>{`± ${frequencyLabel(value)}`}</option>)}</select></label><label className="window-selector"><ChevronDown size={12} /><select aria-label="FFT window" value={project.instruments.spectrumWindow} onChange={(event) => onInstrumentChange({ spectrumWindow: event.target.value as Project['instruments']['spectrumWindow'] })}><option value="hann">Hann window</option><option value="rectangular">Rectangular</option></select></label></div></div>
      <div className="spectrum-display-wrap"><div className="spectrum-y-axis"><span>MAG</span><span>0</span></div><div className="spectrum-display"><canvas className="instrument-canvas" ref={spectrum.ref} />{!activeSpectrumChannels.length && <div className="plot-empty"><AudioLines size={18} /><span>{stale ? 'Recalculating outputs' : 'Enable a scope channel with a connected output'}</span></div>}<div className="spectrum-x-axis">{frequencyTicks.map((tick, index) => <span key={index}>{tick}</span>)}</div></div></div>
      <div className="measurement-strip peak-strip"><div className="measurement-cell"><span>CHANNELS</span><strong>{spectrum.spectra.map((item) => item.id).join(' · ') || '—'}</strong></div>{spectrum.leadPeaks.map((peak, index) => <div className="measurement-cell peak-cell" key={`${peak.id}-${peak.frequency}-${index}`}><span>{peak.id} PEAK</span><strong>{peak.frequency < 0 ? '−' : '+'}{Math.abs(peak.frequency) >= 1000 ? `${(Math.abs(peak.frequency) / 1000).toFixed(2)} kHz` : `${Math.abs(peak.frequency).toFixed(0)} Hz`} <small>{peak.amplitude.toFixed(3)} V</small></strong></div>)}{activeSpectrumChannels.length > 0 && spectrum.peaks.length === 0 && <div className="measurement-cell"><span>PEAKS</span><strong>Not resolved</strong></div>}<div className="instrument-indicator"><Radio size={13} /><span>{stale ? 'UPDATING' : running ? 'LIVE DATA' : 'HOLD'}</span></div></div>
    </div>
  </section>;
}
