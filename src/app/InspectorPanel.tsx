import { Activity, SlidersHorizontal, Cable, Settings2 } from 'lucide-react';
import type { ModuleInstance, Project, SimulationResult } from '../types';
import { moduleByType } from '../modules/registry';

interface Props {
  project: Project; selected: ModuleInstance | null; result: SimulationResult | null;
  onParameter: (key: string, value: number | string) => void;
  onProjectSetting: (key: 'sampleRate' | 'sampleCount', value: number) => void;
}

export function InspectorPanel({ project, selected, result, onParameter, onProjectSetting }: Props) {
  const definition = selected ? moduleByType.get(selected.type) : null;
  return (
    <aside className="inspector">
      <div className="side-heading"><div><span className="eyebrow">INSTRUMENTATION</span><h2>Properties</h2></div><SlidersHorizontal size={16} className="muted-icon" /></div>
      {selected && definition ? <>
        <div className="inspected-module"><span className="rack-code large">{definition.shortName}</span><div><h3>{definition.name}</h3><p>{definition.description}</p></div></div>
        <div className="module-doc-card"><span className="doc-label">MODEL · v{definition.version}</span><code>{definition.documentation.equation}</code><p>{definition.documentation.practicalUse}</p></div>
        <div className="property-section"><div className="section-label"><Settings2 size={13} /> PARAMETERS</div>
          {definition.parameters.map((parameter) => {
            const value = selected.parameters[parameter.key];
            return <label className="property-field" key={parameter.key}><span className="field-label">{parameter.label}</span>
              {parameter.kind === 'select' ? <select value={String(value)} onChange={(event) => onParameter(parameter.key, event.target.value)}>{parameter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <div className="number-input"><input type={parameter.kind === 'range' ? 'range' : 'number'} min={parameter.min} max={parameter.max} step={parameter.step} value={Number(value)} onChange={(event) => onParameter(parameter.key, Number(event.target.value))} /><output>{formatValue(Number(value), parameter.unit)}</output></div>}
            </label>;
          })}
        </div>
        <div className="property-section"><div className="section-label"><Cable size={13} /> TERMINALS</div>
          <div className="terminal-summary"><span>INPUTS</span><span>{definition.inputs.length ? definition.inputs.map((port) => <i key={port.name}>{port.name}</i>) : '—'}</span></div>
          <div className="terminal-summary"><span>OUTPUTS</span><span>{definition.outputs.map((port) => <i key={port.name}>{port.name}</i>)}</span></div>
          <div className="terminal-summary"><span>CONNECTED</span><span>{project.connections.filter((edge) => edge.sourceModuleId === selected.id || edge.targetModuleId === selected.id).length} LEADS</span></div>
        </div>
        <div className="property-section"><div className="section-label"><Activity size={13} /> OUTPUT STATUS</div>
          {result?.errors[selected.id] ? <div className="status-error">{result.errors[selected.id]}</div> : <div className="signal-status"><span className="live-dot" /> {result ? 'Calculated on last run' : 'Run simulation to calculate'}</div>}
        </div>
      </> : <>
        <div className="empty-inspector"><div className="empty-inspector-mark"><Settings2 size={22} /></div><strong>No module selected</strong><p>Select a block on the bench to inspect its parameters, ports and output state.</p></div>
        <div className="property-section settings-section"><div className="section-label"><Activity size={13} /> SIMULATION BASE</div>
          <label className="property-field"><span className="field-label">Sample rate</span><div className="settings-value"><input type="number" min={100} max={10000000} step={1000} value={project.settings.sampleRate} onChange={(event) => onProjectSetting('sampleRate', Number(event.target.value))} /><span>Sa/s</span></div></label>
          <label className="property-field"><span className="field-label">Samples / window</span><div className="settings-value"><select value={project.settings.sampleCount} onChange={(event) => onProjectSetting('sampleCount', Number(event.target.value))}>{[2048, 4096, 8192, 16384, 32768].map((count) => <option key={count} value={count}>{count.toLocaleString()}</option>)}</select><span>samples</span></div></label>
          <p className="hint-text">The default 500 kSa/s time base supports a 100 kHz carrier below Nyquist.</p>
        </div>
        {result?.errors._project && <div className="status-error global-error">{result.errors._project}</div>}
        <div className="coverage-card"><span>ENGINE COVERAGE</span><strong>4 <small>/ {moduleByType.size}</small></strong><p>Four modules currently produce numerical signals. Additional hardware blocks are marked as roadmap items.</p></div>
      </>}
    </aside>
  );
}

export function formatValue(value: number, unit?: string): string {
  let shown: string;
  if (unit === 'Hz' && value >= 1000) shown = `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} kHz`;
  else if (Math.abs(value) >= 1000) shown = value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  else shown = Number(value.toFixed(2)).toString();
  return `${shown}${unit && unit !== 'Hz' ? ` ${unit}` : ''}`;
}
