import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowUpFromLine, AudioLines, FilePlus2, FolderOpen, Mic, MicOff, Play, Redo2, Save, Square, Undo2, X } from 'lucide-react';
import type { CableColor, CablePoint, Project, SimulationResult } from '../types';
import { createProject, validateImportedProject } from '../project/projectFormat';
import { makeSignature } from '../project/signature';
import { deleteProject, listProjects, loadWorkspace, saveProject, saveWorkspace } from '../storage/projectStore';
import { moduleByType } from '../modules/registry';
import { validateConnection } from '../engine/graph';
import { outputKey, socketId } from '../types';
import { HardwareBoard } from '../hardware/HardwareBoard';
import { InstrumentDock } from '../instruments/InstrumentDock';
type NoticeTone = 'info' | 'success' | 'error';

interface SimulationSnapshot { result: SimulationResult; signature: string; completedAt: Date }
interface AudioCapture { stream: MediaStream; context: AudioContext; processor: ScriptProcessorNode; gain: GainNode; buffer: Float32Array; writeIndex: number; count: number; sampleRate: number }
const cloneProject = (project: Project): Project => JSON.parse(JSON.stringify(project)) as Project;
const createId = () => globalThis.crypto?.randomUUID?.() ?? `c-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function App() {
  const [project, setProject] = useState<Project>(() => createProject('ETT-101 · Free Lab'));
  const [history, setHistory] = useState<{ past: Project[]; future: Project[] }>({ past: [], future: [] });
  const historyRef = useRef(history);
  historyRef.current = history;
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [projectBrowserOpen, setProjectBrowserOpen] = useState(false);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [simulation, setSimulation] = useState<SimulationSnapshot | null>(null);
  const [simulationBusy, setSimulationBusy] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: NoticeTone } | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const latestRequestRef = useRef(0);
  const pendingSignatureRef = useRef('');
  const simulationBusyRef = useRef(false);
  const rerunQueuedRef = useRef(false);
  const startTimeRef = useRef(0);
  const sampleWindowDurationRef = useRef(0);
  const singleShotPendingRef = useRef(false);
  const projectRef = useRef(project);
  const audioCaptureRef = useRef<AudioCapture | null>(null);
  const [moduleErrors, setModuleErrors] = useState<Record<string, string>>({});
  projectRef.current = project;
  const signature = useMemo(() => makeSignature(project), [project]);
  const stale = !simulation || simulation.signature !== signature;
  const sampleCount = project.settings.sampleCount;
  const inputsRef = importInputRef;
  const microphoneInitializedRef = useRef(false);

  const showNotice = useCallback((text: string, tone: NoticeTone = 'info') => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    setNotice({ text, tone });
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice((current) => current?.text === text ? null : current);
      noticeTimerRef.current = null;
    }, 4200);
  }, []);

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
  }, []);

  const commit = useCallback((change: (draft: Project) => void) => {
    const current = projectRef.current;
    const next = cloneProject(current);
    change(next);
    next.updatedAt = new Date().toISOString();
    const nextHistory = { past: [...historyRef.current.past.slice(-99), current], future: [] as Project[] };
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    projectRef.current = next;
    setProject(next);
  }, []);

  const replaceProject = useCallback((next: Project) => {
    latestRequestRef.current += 1;
    simulationBusyRef.current = false;
    rerunQueuedRef.current = false;
    singleShotPendingRef.current = false;
    startTimeRef.current = 0;
    setSimulationBusy(false);
    setSimulation(null);
    projectRef.current = next;
    setProject(next);
    const clearedHistory = { past: [] as Project[], future: [] as Project[] };
    historyRef.current = clearedHistory;
    setHistory(clearedHistory);
    setSelectedModuleId(null);
    setSelectedConnectionId(null);
    setModuleErrors({});
  }, []);

  useEffect(() => {
    let active = true;
    void loadWorkspace().then((saved) => {
      if (!active) return;
      if (saved) {
        try { replaceProject(validateImportedProject(saved)); } catch { /* Ignore an obsolete or corrupt browser snapshot. */ }
      }
      setWorkspaceReady(true);
    }).catch(() => { if (active) setWorkspaceReady(true); });
    return () => { active = false; };
  }, [replaceProject]);

  useEffect(() => {
    if (!workspaceReady) return;
    void saveWorkspace(project).catch(() => {});
  }, [project, workspaceReady]);

  const runSimulation = useCallback(() => {
    if (!workerRef.current) return;
    if (simulationBusyRef.current) { rerunQueuedRef.current = true; return; }
    const snapshot = projectRef.current;
    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    pendingSignatureRef.current = makeSignature(snapshot);
    sampleWindowDurationRef.current = snapshot.settings.sampleRate > 0 ? snapshot.settings.sampleCount / snapshot.settings.sampleRate : 0;
    simulationBusyRef.current = true;
    setSimulationBusy(true);
    const capture = audioCaptureRef.current;
    let externalInputs: Record<string, { samples: Float64Array; sampleRate: number }> | undefined;
    if (capture?.count) {
      const needed = Math.ceil(snapshot.settings.sampleCount * capture.sampleRate / snapshot.settings.sampleRate);
      const sampleLength = Math.min(capture.count, needed);
      const samples = new Float64Array(sampleLength);
      const first = (capture.writeIndex - sampleLength + capture.buffer.length) % capture.buffer.length;
      for (let index = 0; index < sampleLength; index += 1) samples[index] = capture.buffer[(first + index) % capture.buffer.length];
      externalInputs = { 'bottom.speech': { samples, sampleRate: capture.sampleRate } };
    }
    workerRef.current.postMessage({ requestId, project: snapshot, externalInputs, startTime: startTimeRef.current });
  }, []);

  const finishSingleShot = useCallback(() => {
    if (!singleShotPendingRef.current) return;
    singleShotPendingRef.current = false;
    const current = projectRef.current;
    if (!current.instruments.running) return;
    const next = cloneProject(current);
    next.instruments.running = false;
    projectRef.current = next;
    setProject(next);
  }, []);

  const settleWorkerRequest = useCallback(() => {
    simulationBusyRef.current = false;
    setSimulationBusy(false);
    if (rerunQueuedRef.current) {
      rerunQueuedRef.current = false;
      window.setTimeout(runSimulation, 0);
    }
  }, [runSimulation]);

  useEffect(() => {
    const worker = new Worker(new URL('../engine/workers/simulation.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<{ requestId: number; ok: boolean; result?: SimulationResult; error?: string }>) => {
      if (event.data.requestId !== latestRequestRef.current) return;
      if (!event.data.ok || !event.data.result) {
        finishSingleShot();
        settleWorkerRequest();
        showNotice(event.data.error ?? 'DSP worker could not complete.', 'error');
        return;
      }
      const result = event.data.result;
      startTimeRef.current += sampleWindowDurationRef.current;
      setSimulation({ result, signature: pendingSignatureRef.current, completedAt: new Date() });
      setModuleErrors(result.errors);
      const errors = Object.keys(result.errors).filter((id) => id !== '_project').length;
      if (result.errors._project) showNotice(result.errors._project, 'error');
      else if (errors) showNotice(`Calculated connected hardware; ${errors} active module diagnostic${errors === 1 ? '' : 's'} shown at the relevant section.`, 'info');
      finishSingleShot();
      settleWorkerRequest();
    };
    worker.onerror = () => { finishSingleShot(); settleWorkerRequest(); showNotice('DSP worker failed. Reload the lab and try again.', 'error'); };
    return () => { worker.terminate(); workerRef.current = null; };
  }, [finishSingleShot, settleWorkerRequest, showNotice]);

  useEffect(() => {
    if (project.instruments.running || !stale) return;
    const timer = window.setTimeout(runSimulation, 140);
    return () => window.clearTimeout(timer);
  }, [signature, stale, project.instruments.running, runSimulation]);

  useEffect(() => {
    if (!project.instruments.running) return;
    let timer = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (!simulationBusyRef.current) runSimulation();
      const speed = Number.isFinite(projectRef.current.settings.simulationSpeed) ? Math.max(0.1, projectRef.current.settings.simulationSpeed) : 1;
      timer = window.setTimeout(tick, Math.max(40, Math.min(1000, 120 / speed)));
    };
    timer = window.setTimeout(tick, 80);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [project.instruments.running, runSimulation]);

  useEffect(() => {
    if (!microphoneInitializedRef.current) { microphoneInitializedRef.current = true; return; }
    const timer = window.setTimeout(runSimulation, microphoneEnabled ? 320 : 80);
    return () => window.clearTimeout(timer);
  }, [microphoneEnabled, runSimulation]);

  const connectModules = useCallback((sourceModuleId: string, sourcePort: string, targetModuleId: string, targetPort: string, color: CableColor, reconnectId?: string): string | null => {
    const current = projectRef.current;
    const candidate = { ...current, connections: current.connections.filter((edge) => edge.id !== reconnectId) };
    const validation = validateConnection(candidate, sourceModuleId, sourcePort, targetModuleId, targetPort);
    if (!validation.ok) { showNotice(validation.reason, 'error'); return null; }
    const id = reconnectId ?? createId();
    commit((draft) => {
      const previous = draft.connections.find((edge) => edge.id === reconnectId);
      const next: Project['connections'][number] = {
        id, sourceModuleId, sourcePort, targetModuleId, targetPort,
        sourceSocketId: socketId(sourceModuleId, sourcePort), targetSocketId: socketId(targetModuleId, targetPort),
        color, routing: previous?.routing ? previous.routing.map((point) => ({ ...point })) : [], state: 'active',
      };
      const index = draft.connections.findIndex((edge) => edge.id === reconnectId);
      if (index >= 0) draft.connections[index] = next; else draft.connections.push(next);
      for (const channel of draft.instruments.scopeChannels) {
        const scopeConnection = draft.connections.find((edge) => edge.targetModuleId === `scope.${channel.id}` && edge.targetPort === 'IN');
        const nextKey = scopeConnection ? outputKey(scopeConnection.sourceModuleId, scopeConnection.sourcePort) : '';
        if (nextKey && nextKey !== channel.sourceKey) channel.enabled = true;
        channel.sourceKey = nextKey;
      }
    });
    showNotice(reconnectId ? 'Patch lead rerouted; other branches remain connected.' : 'Patch lead connected; the source output can feed other sockets independently.', 'success');
    return id;
  }, [commit, showNotice]);

  const removeConnection = useCallback((id: string) => {
    commit((draft) => {
      draft.connections = draft.connections.filter((edge) => edge.id !== id);
      for (const channel of draft.instruments.scopeChannels) {
        const scopeConnection = draft.connections.find((edge) => edge.targetModuleId === `scope.${channel.id}` && edge.targetPort === 'IN');
        channel.sourceKey = scopeConnection ? outputKey(scopeConnection.sourceModuleId, scopeConnection.sourcePort) : '';
      }
    });
    setSelectedConnectionId(null);
    showNotice('Selected patch lead removed; other fan-out branches are unchanged.', 'info');
  }, [commit, showNotice]);
  const clearConnections = useCallback(() => {
    if (!projectRef.current.connections.length) return;
    commit((draft) => { draft.connections = []; draft.instruments.scopeChannels.forEach((channel) => { channel.sourceKey = ''; }); });
    setSelectedConnectionId(null);
    showNotice('All patch leads removed. Undo restores the previous circuit.', 'info');
  }, [commit, showNotice]);
  const changeCableColor = useCallback((id: string, color: CableColor) => commit((draft) => {
    const connection = draft.connections.find((edge) => edge.id === id);
    if (connection) connection.color = color;
  }), [commit]);
  const changeCableRoute = useCallback((id: string, routing: CablePoint[]) => commit((draft) => {
    const connection = draft.connections.find((edge) => edge.id === id);
    if (connection) connection.routing = routing.map((point) => ({ x: point.x, y: point.y }));
  }), [commit]);
  const resetCableRoute = useCallback((id: string) => commit((draft) => {
    const connection = draft.connections.find((edge) => edge.id === id);
    if (connection) connection.routing = [];
  }), [commit]);

  const updateParameter = useCallback((moduleId: string, key: string, value: number | string) => {
    const instance = projectRef.current.modules.find((module) => module.id === moduleId);
    const definition = instance ? moduleByType.get(instance.type) : undefined;
    const parameter = definition?.parameters.find((item) => item.key === key);
    if (!instance || !parameter) return;
    if (parameter.kind === 'select') {
      if (typeof value !== 'string' || !parameter.options.some((option) => option.value === value)) { showNotice(`Choose a documented ${parameter.label.toLowerCase()} setting.`, 'error'); return; }
    } else if (typeof value !== 'number' || !Number.isFinite(value) || value < parameter.min || value > parameter.max) {
      showNotice(`${parameter.label} must be between ${parameter.min} and ${parameter.max}${parameter.unit ? ` ${parameter.unit}` : ''}.`, 'error'); return;
    }
    commit((draft) => { const module = draft.modules.find((item) => item.id === moduleId); if (module) module.parameters[key] = value; });
  }, [commit, showNotice]);

  const patchInstrument = useCallback((patch: Partial<Project['instruments']>) => commit((draft) => {
    draft.instruments = { ...draft.instruments, ...patch };
  }), [commit]);

  const changeCapture = useCallback((sampleCount: number) => commit((draft) => {
    draft.settings = { ...draft.settings, sampleCount };
    draft.instruments = { ...draft.instruments, timeOffset: 0 };
  }), [commit]);

  const toggleScopeRunning = () => {
    const next = !projectRef.current.instruments.running;
    patchInstrument({ running: next });
  };

  const captureSingle = useCallback(() => {
    singleShotPendingRef.current = true;
    const current = projectRef.current;
    if (!current.instruments.running) {
      const next = cloneProject(current);
      next.instruments.running = true;
      projectRef.current = next;
      setProject(next);
    }
    if (!simulationBusyRef.current) runSimulation();
  }, [runSimulation]);

  const undo = useCallback(() => {
    const current = historyRef.current;
    if (!current.past.length) return;
    const previous = current.past[current.past.length - 1];
    const now = projectRef.current;
    const nextHistory = { past: current.past.slice(0, -1), future: [now, ...current.future] };
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    projectRef.current = previous; setProject(previous); setSelectedConnectionId(null); setSelectedModuleId(null);
  }, []);
  const redo = useCallback(() => {
    const current = historyRef.current;
    if (!current.future.length) return;
    const [next, ...future] = current.future;
    const now = projectRef.current;
    const nextHistory = { past: [...current.past, now], future };
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    projectRef.current = next; setProject(next); setSelectedConnectionId(null); setSelectedModuleId(null);
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"], [role="slider"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedConnectionId) { event.preventDefault(); removeConnection(selectedConnectionId); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo, selectedConnectionId, removeConnection]);

  const saveCurrent = async () => {
    try { await saveProject(projectRef.current); showNotice(`“${projectRef.current.name}” saved to this browser.`, 'success'); }
    catch (error) { showNotice(error instanceof Error ? error.message : 'Project could not be saved.', 'error'); }
  };
  const openBrowser = async () => {
    try { setProjectList(await listProjects()); setProjectBrowserOpen(true); }
    catch (error) { showNotice(error instanceof Error ? error.message : 'Could not read local projects.', 'error'); }
  };
  const openSavedProject = (saved: Project) => {
    try { replaceProject(validateImportedProject(saved)); setProjectBrowserOpen(false); showNotice(`Opened “${saved.name}” from local storage.`, 'success'); }
    catch (error) { showNotice(error instanceof Error ? error.message : 'Saved circuit has invalid hardware data.', 'error'); }
  };
  const createNewProject = () => {
    if (!window.confirm('Clear patch leads and return every module control and scope probe to defaults? Unsaved circuit edits will be replaced.')) return;
    replaceProject(createProject());
    showNotice('New blank ETT-101 experiment. The physical trainer remains fixed.', 'success');
  };
  const exportProject = () => {
    const blob = new Blob([JSON.stringify(projectRef.current, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `${projectRef.current.name.trim().replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'ett101-project'}.json`;
    link.click(); URL.revokeObjectURL(url); showNotice('Version-2 trainer settings and patch leads exported.', 'success');
  };
  const importProject = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error('Project JSON is larger than the 5 MB import limit.');
      const parsed: unknown = JSON.parse(await file.text());
      const imported = validateImportedProject(parsed);
      replaceProject(imported); showNotice(`Imported “${imported.name}” after physical panel, socket, parameter and cable validation.`, 'success');
    } catch (error) { showNotice(error instanceof Error ? error.message : 'Project JSON could not be imported.', 'error'); }
    if (inputsRef.current) inputsRef.current.value = '';
  };

  const enableMicrophone = async () => {
    if (!navigator.mediaDevices?.getUserMedia) { showNotice('This browser does not support microphone capture.', 'error'); return; }
    if (audioCaptureRef.current) { showNotice('Microphone input is already active.', 'info'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const context = new AudioContext();
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(2048, 1, 1);
      const gain = context.createGain(); gain.gain.value = 0;
      const buffer = new Float32Array(Math.round(context.sampleRate * 2));
      const capture: AudioCapture = { stream, context, processor, gain, buffer, writeIndex: 0, count: 0, sampleRate: context.sampleRate };
      processor.onaudioprocess = (event) => {
        const data = event.inputBuffer.getChannelData(0);
        for (let index = 0; index < data.length; index += 1) {
          capture.buffer[capture.writeIndex] = data[index];
          capture.writeIndex = (capture.writeIndex + 1) % capture.buffer.length;
          capture.count = Math.min(capture.count + 1, capture.buffer.length);
        }
      };
      source.connect(processor); processor.connect(gain); gain.connect(context.destination);
      audioCaptureRef.current = capture; setMicrophoneEnabled(true);
      showNotice('Microphone is active. Captured audio stays in memory and is not saved to project files.', 'success');
    } catch (error) { showNotice(error instanceof Error ? `Microphone access failed: ${error.message}` : 'Microphone permission was not granted.', 'error'); }
  };
  const disableMicrophone = useCallback(() => {
    const capture = audioCaptureRef.current;
    if (!capture) return;
    capture.processor.disconnect(); capture.gain.disconnect();
    capture.stream.getTracks().forEach((track) => track.stop());
    void capture.context.close(); audioCaptureRef.current = null; setMicrophoneEnabled(false);
    showNotice('Microphone disconnected; no audio is stored in the project.', 'info');
  }, [showNotice]);
  useEffect(() => () => {
    const capture = audioCaptureRef.current;
    if (capture) { capture.stream.getTracks().forEach((track) => track.stop()); void capture.context.close(); }
  }, []);

  return <div className="lab-shell hardware-app">
    <header className="topbar hardware-topbar">
      <div className="brand-lockup"><img src="/logo.svg" alt="" /><div><strong>VIRTUAL <span>TELECOMS</span> LAB</strong><small>EMONA ETT-101 · SIGNALS & COMMUNICATIONS</small></div></div>
      <div className="header-project"><span className="project-pulse" /><div><small>PROJECT / LOCAL CIRCUIT</small><strong>{project.name}</strong></div></div>
      <div className="topbar-spacer" />
      <div className="project-actions">
        <button className="toolbar-button" onClick={createNewProject}><FilePlus2 size={15} /><span>New</span></button>
        <button className="toolbar-button" onClick={openBrowser}><FolderOpen size={15} /><span>Open</span></button>
        <button className="toolbar-button" onClick={() => void saveCurrent()}><Save size={15} /><span>Save</span></button>
        <span className="action-divider" />
        <button className="toolbar-button" onClick={exportProject}><ArrowDownToLine size={15} /><span>Export</span></button>
        <button className="toolbar-button" onClick={() => importInputRef.current?.click()}><ArrowUpFromLine size={15} /><span>Import</span></button>
        <input ref={importInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importProject(event.target.files?.[0])} />
      </div>
      <div className="history-actions"><button className="icon-button" title="Undo (Ctrl+Z)" disabled={!history.past.length} onClick={undo}><Undo2 size={16} /></button><button className="icon-button" title="Redo (Ctrl+Shift+Z)" disabled={!history.future.length} onClick={redo}><Redo2 size={16} /></button></div>
      {microphoneEnabled ? <button className="mic-button active" onClick={disableMicrophone} title="Disconnect microphone; captured audio remains memory-only"><MicOff size={15} /> MIC ON</button> : <button className="mic-button" onClick={() => void enableMicrophone()} title="Request browser microphone access for the physical Speech input"><Mic size={15} /> MIC</button>}
      <button className={`run-button ${simulationBusy && !project.instruments.running ? 'running' : ''} ${project.instruments.running ? 'is-stop' : ''}`} disabled={simulationBusy && !project.instruments.running} onClick={project.instruments.running ? toggleScopeRunning : runSimulation}>{project.instruments.running ? <Square size={13} fill="currentColor" /> : simulationBusy ? <span className="run-spinner" /> : <Play size={14} fill="currentColor" />}<span>{project.instruments.running ? 'STOP' : simulationBusy ? 'SOLVING' : 'SOLVE'}</span></button>
    </header>

    <main className="lab-main hardware-main">
      <div className="workspace-heading"><div><span className="eyebrow">ETT-101 DIGITAL TWIN / PATCH & MEASURE</span><h1>Telecoms Trainer <span>·</span> <small>{project.connections.length} live patch leads</small></h1></div><div className="sync-pill"><span className={stale ? 'sync-dot idle' : 'sync-dot'} />{stale ? 'CALCULATING CIRCUIT' : 'SIGNALS IN SYNC'}</div></div>
      <HardwareBoard project={project} result={simulation?.result ?? null} moduleErrors={moduleErrors} selectedConnectionId={selectedConnectionId} selectedModuleId={selectedModuleId} onConnect={connectModules} onSelectConnection={setSelectedConnectionId} onDeleteConnection={removeConnection} onClearConnections={clearConnections} onConnectionColor={changeCableColor} onCableRoute={changeCableRoute} onResetCableRoute={resetCableRoute} onParameter={updateParameter} onSelectModule={setSelectedModuleId} onMessage={showNotice} />
      <div className="instrument-heading"><div><span className="eyebrow">SEPARATE LABORATORY INSTRUMENT</span><h2>FOUR-CHANNEL OSCILLOSCOPE <span>{simulationBusy ? '· COMPUTING' : simulation ? `· ${simulation.completedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : '· WAITING'}</span></h2></div><div className="instrument-run-state"><AudioLines size={14} /><span>{microphoneEnabled ? 'LIVE MIC AVAILABLE' : 'MIC DISCONNECTED'}</span></div></div>
      <InstrumentDock project={project} result={simulation?.result ?? null} onInstrumentChange={patchInstrument} stale={stale} running={project.instruments.running} onToggleRun={toggleScopeRunning} onSingleCapture={captureSingle} onCaptureChange={changeCapture} />
      <footer className="statusbar"><div className="status-left"><span className={`status-led ${simulationBusy ? 'amber' : ''}`} /><strong>{simulationBusy ? 'DSP ACTIVE' : simulation ? 'READY' : 'IDLE'}</strong><span className="status-sep" />{project.modules.length} PHYSICAL FUNCTIONS <span className="status-sep" />{project.connections.length} PATCH LEADS <span className="status-sep" />{project.settings.sampleRate.toLocaleString()} Sa/s <span className="status-sep" />{sampleCount.toLocaleString()} SAMPLES</div><div className="status-right"><span>LOCAL-FIRST</span><span className="status-sep" /><span>SCHEMA 2</span><span className="status-sep" /><span className="status-glyph"><Activity size={13} /> VTL / ETT-101</span></div></footer>
    </main>
    {notice && <div className={`app-toast ${notice.tone}`} role="status"><span className="toast-mark">{notice.tone === 'error' ? '!' : notice.tone === 'success' ? '✓' : 'i'}</span><span>{notice.text}</span><button onClick={() => { if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current); noticeTimerRef.current = null; setNotice(null); }} aria-label="Dismiss message"><X size={14} /></button></div>}
    {projectBrowserOpen && <ProjectBrowser projects={projectList} onClose={() => setProjectBrowserOpen(false)} onOpen={openSavedProject} onDelete={async (id) => { await deleteProject(id); setProjectList(await listProjects()); }} />}
    <button className="help-tab" title="About the ETT-101 digital twin" onClick={() => showNotice('This panel follows the supplied ETT-101 reference and manufacturer documentation. Unknown hardware characteristics are labeled as approximations in the module information and hardware reconstruction document.', 'info')}><AudioLines size={15} /> ABOUT</button>
  </div>;
}

function ProjectBrowser({ projects, onClose, onOpen, onDelete }: { projects: Project[]; onClose: () => void; onOpen: (project: Project) => void; onDelete: (id: string) => Promise<void> }) {
  const [saved, setSaved] = useState(projects);
  const handleDelete = async (project: Project) => {
    if (!window.confirm(`Delete saved project “${project.name}” from this browser?`)) return;
    try { await onDelete(project.id); setSaved((current) => current.filter((item) => item.id !== project.id)); }
    catch { /* The next browser open reports storage errors. */ }
  };
  return <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="project-modal"><div className="modal-header"><div><span className="eyebrow">LOCAL INDEXEDDB / PHYSICAL PANEL PROJECTS</span><h2>Open circuit</h2></div><button className="icon-button" onClick={onClose}><X size={17} /></button></div>{saved.length ? <div className="saved-project-list">{saved.map((item) => <div className="saved-project" key={item.id}><div className="saved-project-mark"><AudioLines size={18} /></div><div className="saved-project-meta"><strong>{item.name}</strong><span>{item.connections.length} leads · {item.settings.sampleRate.toLocaleString()} Sa/s</span><small>Updated {new Date(item.updatedAt).toLocaleString()}</small></div><button className="open-project-button" onClick={() => onOpen(item)}>OPEN</button><button className="icon-button delete-project-button" title={`Delete ${item.name}`} onClick={() => void handleDelete(item)}><X size={14} /></button></div>)}</div> : <div className="no-saved-projects"><FolderOpen size={26} /><strong>No saved circuits yet</strong><span>Save a physical trainer patching configuration to keep its cables, controls and scope probes on this device.</span></div>}<div className="modal-footer"><span>PROJECTS STAY IN THIS BROWSER</span><button className="subtle-button" onClick={onClose}>CLOSE</button></div></div></div>;
}
