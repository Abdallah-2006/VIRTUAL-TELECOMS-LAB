import { useEffect, useRef, useState } from 'react';
import type { ParameterDefinition } from '../types';

interface RotaryKnobProps {
  x: number; y: number; label: string; value: number; definition: Extract<ParameterDefinition, { kind: 'range' | 'number' }>;
  onChange: (value: number) => void;
}
export function RotaryKnob({ x, y, label, value, definition, onChange }: RotaryKnobProps) {
  const [local, setLocal] = useState(value);
  const drag = useRef<{ pointerId: number; clientY: number; value: number } | null>(null);
  useEffect(() => { if (!drag.current) setLocal(value); }, [value]);
  const format = (number: number) => `${Number(number.toFixed(2))}${definition.unit ? ` ${definition.unit}` : ''}`;
  const fraction = (local - definition.min) / Math.max(0.000001, definition.max - definition.min);
  const angle = -130 + Math.max(0, Math.min(1, fraction)) * 260;
  const clampStep = (number: number) => {
    const stepped = Math.round((number - definition.min) / definition.step) * definition.step + definition.min;
    return Math.max(definition.min, Math.min(definition.max, Number(stepped.toFixed(6))));
  };
  return <g className="hardware-control rotary-knob" transform={`translate(${x} ${y})`} onPointerDown={(event) => {
    event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, clientY: event.clientY, value: local };
  }} onPointerMove={(event) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const next = clampStep(drag.current.value + (drag.current.clientY - event.clientY) * (definition.max - definition.min) / 120);
    setLocal(next);
  }} onPointerUp={(event) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    event.stopPropagation(); drag.current = null; onChange(local);
  }} onPointerCancel={() => { drag.current = null; setLocal(value); }} onKeyDown={(event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault(); const next = clampStep(local + (event.key === 'ArrowUp' ? 1 : -1) * definition.step); setLocal(next); onChange(next);
  }} role="slider" aria-label={label} aria-valuemin={definition.min} aria-valuemax={definition.max} aria-valuenow={local} tabIndex={0}>
    <title>{`${label}: ${format(local)}. Drag vertically to adjust.`}</title>
    <circle className="knob-well" r="5.1" />
    <circle className="knob-face" r="4.25" />
    <path className="knob-pointer" d="M0 -3.5 L0 -0.6" transform={`rotate(${angle})`} />
    <text className="control-label" textAnchor="middle" y="9">{label}</text>
    <text className="control-value" textAnchor="middle" y="11.6">{format(local)}</text>
  </g>;
}

interface ToggleSwitchProps { x: number; y: number; label: string; value: string; options: { label: string; value: string }[]; onChange: (value: string) => void }
export function ToggleSwitch({ x, y, label, value, options, onChange }: ToggleSwitchProps) {
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const option = options[selectedIndex];
  const chooseNext = () => onChange(options[(selectedIndex + 1) % options.length]?.value ?? value);
  return <g className="hardware-control toggle-switch" transform={`translate(${x} ${y})`} onClick={(event) => { event.stopPropagation(); chooseNext(); }} role="button" tabIndex={0} aria-label={`${label}: ${option?.label ?? value}`} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); chooseNext(); } }}>
    <title>{`${label}: ${option?.label ?? value}. Click to cycle.`}</title>
    <rect className="toggle-base" x="-5.3" y="-2.5" width="10.6" height="5" />
    <line className="toggle-rail" x1="-3.6" y1="0" x2="3.6" y2="0" />
    <circle className="toggle-lever" cx={-3.24 + (options.length > 1 ? 6.48 * selectedIndex / (options.length - 1) : 0)} cy="0" r="1.8" />
    <text className="control-label" textAnchor="middle" y="7">{label}</text>
    <text className="control-value" textAnchor="middle" y="9.5">{option?.label ?? value}</text>
  </g>;
}

interface PushButtonProps { x: number; y: number; label: string; title?: string; active?: boolean; onClick: () => void }
export function PushButton({ x, y, label, title, active = false, onClick }: PushButtonProps) {
  return <g className={`hardware-control push-button ${active ? 'is-active' : ''}`} transform={`translate(${x} ${y})`} onClick={(event) => { event.stopPropagation(); onClick(); }} role="button" tabIndex={0} aria-label={title ?? label} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onClick(); } }}>
    <title>{title ?? label}</title><circle className="push-button-bezel" r="3.2" /><circle className="push-button-face" r="2.25" /><text className="control-label" textAnchor="middle" y="6.5">{label}</text>
  </g>;
}

export function LedIndicator({ x, y, label, state = 'off' }: { x: number; y: number; label: string; state?: 'off' | 'ready' | 'error' }) {
  return <g className={`hardware-led led-${state}`} transform={`translate(${x} ${y})`}><title>{`${label}: ${state === 'ready' ? 'signal present' : state === 'error' ? 'module diagnostic' : 'idle'}`}</title><circle className="led-bezel" r="2" /><circle className="led-light" r="1.05" /><text className="led-label" x="2.8" y="0.7">{label}</text></g>;
}

export function GroundTerminal({ x, y, label, id, onClick }: { x: number; y: number; label: string; id: string; onClick: () => void }) {
  return <g className="ground-terminal" transform={`translate(${x} ${y})`} data-ground-id={id} onClick={(event) => { event.stopPropagation(); onClick(); }} role="button" tabIndex={0} aria-label={`${label} ground reference`} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick(); } }}>
    <title>{`${id}: common ground reference. It is not a signal-processing port.`}</title><circle r="2.2" /><circle className="ground-center" r="0.65" /><text x="3" y="0.7">{label}</text>
  </g>;
}

export function SignalGenerator({ x, y, kind, label }: { x: number; y: number; kind: 'sine' | 'digital'; label: string }) {
  const path = kind === 'sine' ? 'M0 3 C1 0 2 0 3 3 S5 6 6 3' : 'M0 5 L0 1 L2 1 L2 5 L4 5 L4 1 L6 1';
  return <g className="signal-glyph" transform={`translate(${x} ${y})`}><title>{label}</title><path d={path} /><text x="7.5" y="3.5">{label}</text></g>;
}
