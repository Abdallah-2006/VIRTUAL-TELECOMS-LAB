# ETT-101 Digital Twin — Outcome Checklist

This checklist follows the latest master brief. It records verified behavior rather than roadmap intent. The current tree is a substantial, runnable hardware/DSP foundation, but **the full digital twin is not complete**: guided experiments, continuous/triggered acquisition details, advanced settings, and exact source-photo fidelity are still open.

## 1. Hardware reconstruction and normalized map — Source map delivered; fine visual sign-off open

- [x] Analyze the supplied ETT-101 photo and cross-check the official manual, diagram and specifications. `docs/hardware-reconstruction.md` records the two-row order, boundaries, socket IDs/types/roles, controls, references and unresolved details.
- [x] Reproduce the standard ETT-101 as a component-rendered physical rectangular instrument rather than a business dashboard; keep the manufacturer-derived row order and the double-width Expansion bay.
- [x] Use the photo-guided normalized outer SVG `viewBox="0 0 280 240"`; preserve source-derived module and socket coordinates. These are design units, not a claim about verified physical millimetres.
- [x] Keep the individually rendered pale-metal faceplate, blue/dark enclosure edge, printed module boundaries, analog round terminals, digital square terminals, shared ground points and actual hardware sections as the primary work surface; avoid a flattened image and software-driven movement/rearrangement.
- [x] Include only modules on the documented standard ETT-101 and keep repeated modules physically separate. Do not add ETT-101C-only equipment or pretend the optional Expansion board is installed.
- [ ] Obtain a sharper/higher-resolution reference or user sign-off for small printed legends, exact enclosure/front-panel boundaries, tiny jack colors and other details the photo/manual cannot establish. The current reconstruction labels these uncertainties instead of guessing.

## 2. Hardware components, sockets and physical controls — Core panel verified; a few peripherals open

- [x] Build the panel in React, TypeScript, SVG and CSS with reusable row/module/socket/cable/control/instrument components. The fixed two-row faceplate—not React Flow, a freeform canvas, a module-card sidebar or rounded dashboard panels—is the main interface.
- [x] Individually render Variable Adder, both upper-row Multipliers, lower-row Multiplier, Tuneable LPF, Twin Pulse Generator, Dual Analog Switch/S&H, Noise Generator, Buffer, Channel BPF, Baseband LPF, Channel Adder, Phase Shifter, Variable DCV, Speech, EXOR, VCO, Sequence Generator/Line Code, Divider, PCM Encoder, Master Signals, Serial-to-Parallel and PCM Decoder; retain the Expansion bay as optional/empty.
- [x] Every graph socket has a stable unique hardware-module/port ID, direction, analog/digital type, source description and SVG anchor. Common grounds, DC power, the speech microphone connector and displayed but ambiguous ringed LO/TDM marks are kept distinct from signal-processing patch ports.
- [ ] Add a properly represented, usable non-patch Headphone Amplifier/stereo monitor jack and confirm its exact physical socket form. Do not turn its small printed headphone graphic into a fake DSP patch socket.
- [x] Physical Adder gains, pulse width/delay, buffer gain, phase adjustment, 0/180° phase switch, LPF cutoff/gain, VDC setting, VCO controls, Line Code selection and Divider/PCM modes update stored parameters and graph simulation; rotary controls use pointer-drag and selectors are interactive.
- [x] Desktop and 375×812 mobile screenshots verify an intact proportioned faceplate; narrow screens scroll horizontally rather than rearranging hardware.
- [ ] Verify fine panel artwork, every tiny printed control legend/coordinate and unknown per-port colors against a higher-resolution model-specific source before claiming a pixel-exact recreation.

## 3. Patch leads and circuit graph — Fan-out and current pointer path verified; advanced interaction QA open

- [x] Selecting a real output socket starts a lead; releasing over a compatible input creates a stable connection and updates the graph. A live Preview pointer-event test connected the same Noise Generator output to two separate Multiplier inputs and confirmed that both leads remained live.
- [x] Output fan-out supports multiple independent module destinations, with analog/digital shape/role, compatibility cues, unique source/target socket IDs, cable identity, color and a Bézier SVG path centered on its anchors.
- [x] A destination input is single-driver; reject bad direction/type, duplicate inputs and cycles with a useful reason. Graph ordering drives simulation and each edge is removed independently.
- [x] Provide red, black, yellow, green, blue and white patch leads, selection, deletion, color change, clear-all, undo/redo and connection highlighting.
- [x] Keep probe selection independent from circuit connections. Output sockets expose channel-colored rings/tags for enabled CH1–CH4 probes, so a source can also be observed without consuming or removing a module cable.
- [ ] Finish manual end-user mouse/touch/reconnect/resizing interaction QA. The live test dispatched the actual SVG PointerEvent handlers; broader physical-device/touch and resize coverage remains open.

## 4. ETT-101 sampled DSP and sources — Core processors real; hardware-response accuracy and coverage open

- [x] Use typed numerical sample buffers and a TypeScript DSP graph independent from React; source outputs are simulated values, not waveform pictures or static demo arrays.
- [x] Process active dependencies in directed order, distribute the same actual output buffer to all branches/probes, reject invalid inputs/cycles, and avoid fabricating an output when required input signals are missing.
- [x] Implement sampled Adder, three physical Multiplier instances, Buffer, fixed source references/Master Signals, seeded Noise taps, Phase Shifter, baseband/RC filters, Variable DCV, VCO, Twin Pulse, Dual Analog Switch/S&H, Divider, EXOR, Comparator, Rectifier/Diode-RC, Channel BPF/Adder, Sequence/Line Code, PCM and Serial-to-Parallel paths. Current tests cover Adder, Multiplier, Buffer, phase, filter attenuation, VCO, noise taps, PCM, socket graph and cycles.
- [x] DSB-SC is built from actual 2.083 kHz and 100 kHz source ports patched to a physical Multiplier; a numerical regression checks both sidebands and the suppressed carrier.
- [ ] Validate all processor responses and ranges against applicable hardware revision data. Current filter/noise/phase behavior is documented; in particular, the Tunable LPF manual/specification ranges conflict and its implemented Butterworth approximation does not establish the original elliptic response. Channel BPF/noise response and several switch/clock details remain approximations.
- [ ] Add independent regression tests for Tuneable LPF response/range, Channel BPF, Twin Pulse timing, analog-switch truth table/S&H hold behavior, Divider, Sequence/Line Code, PCM project-level round-trip and confirmed hardware-specific limits.
- [x] Keep uncertain module behavior explicitly labeled and sourced; do not present undocumented settings as manufacturer-confirmed.

## 5. Four-channel scope and spectrum — Four probes plus advancing Run/Stop/Single delivered; stateful acquisition accuracy open

- [x] Provide four separate channels CH1–CH4; each selects an output independently with its own enable, volts/division and vertical position. Probe choices do not replace graph wiring.
- [x] Show selected output labels, scope grid, real waveform samples, frequency/period/peak/peak-to-peak/RMS/mean measurements and FFT of actual output buffers; use Canvas rather than one DOM node per sample.
- [x] Provide time/div, trigger source, level and mode controls, Auto Setup, continuously advancing worker-based Run/Stop and a real Single one-window capture that returns to HOLD; browser testing verifies the frame advances continuously and remains held after Single.
- [x] Use matching CH1–CH4 trace colors on the corresponding faceplate source sockets to display independent probe assignment.
- [ ] Validate normal-mode edge-lock and signal/filter-state continuity across adjacent windows; the modeled streaming source windows advance, but stateful filters/processors currently reinitialize each block.
- [x] Keep the oscilloscope visibly separate and secondary to the physical trainer faceplate.

## 6. Editable communications experiments and learning workflow — Not yet implemented

- [ ] Implement an editable experiment library built from the real module/cable graph, not pre-recorded signals, hidden shortcut processors or a label-only walkthrough. Guidance must let users physically patch the circuit and explain expected traces/spectra.
- [ ] AM DSB-TC uses `s(t)=A_c[1+μm_n(t)]cos(2πf_ct)` and allows message/carrier frequencies, message amplitude and modulation index to change; demonstrate under-, 100%- and over-modulation.
- [ ] DSB-SC connects Master Signals to the Multiplier and displays actual upper/lower sidebands without an ideal carrier component.
- [ ] Coherent DSB-SC demodulation requires the received waveform, local oscillator, Multiplier and LPF; changing LO phase changes the recovered signal. Also implement AM envelope detection, SSB generation/spectrum, and FM with controllable deviation.
- [ ] Implement sampling/aliasing, PCM encoding/decoding, ASK/FSK/BPSK/QPSK, and noise/channel/filter experiments using their actual module paths.
- [ ] Add concise objectives, module/circuit lists, connection directions, expected waveforms/spectra, mathematical explanation, measurements, steps and troubleshooting to each guided experiment.

## 7. Projects and persistence — Save/reload/Open round-trip verified; advanced Settings remain open

- [x] Versioned projects capture fixed hardware state, parameters/switches, cables/colors, four scope probes and relevant instrument/settings data. New projects start with the hardware present but no pre-wired experiment.
- [x] Expose local Save/Open and safe JSON Export/Import; validate project schema, module parameters, stable socket IDs and connections without executing imported data as code. Project format and round-trip validation have unit coverage.
- [x] Store saved project records through IndexedDB CRUD and handle saved-project listing/deletion.
- [x] Browser end-to-end Save → reload → Open restored a real one-cable circuit and its `Single` trigger mode from IndexedDB after the reload; the temporary test record was removed afterwards.
- [ ] Add working Settings for sample rate, display preferences and simulation speed, and guided Experiments/Signal Analysis access that stays within the instrument workflow rather than introducing a dashboard.

## 8. Browser-first quality, performance and tests — TypeScript/build/21 tests/Preview verified; remaining QA open

- [x] Use React, TypeScript, Vite, SVG, CSS, DSP workers, Canvas, IndexedDB and browser microphone capture only after user consent; no backend or Python runtime is required for basic use.
- [ ] Profile and optimize larger continuous buffers, microphone/resampling and filter-state continuation for the streaming scope loop. Avoid redundant graph work and excessive allocations while maintaining UI responsiveness.
- [x] Automated tests cover the active DSP families, numerical product/sideband behavior, fan-out, graph validation/order/cycles, independent CH1/CH2 probes, projects/import validation and fixed socket geometry.
- [x] Mandatory fan-out regression: one VCO output feeds two Multiplier input ports and independently selected CH1/CH2; assert all four address the identical computed source buffer, remove a module branch, and confirm the other branch and both probes continue working.
- [x] Final strict TypeScript check, production build, 21 tests and Preview root/route health pass; live desktop/mobile Preview screens render the fixed panel and its instrument. Browser-facing Preview host is explicitly scoped in Vite’s allowed-host list.
- [ ] Complete browser end-to-end tests for touch/reconnect, physical-control-to-output paths and user-performable experiments.

## 9. Non-negotiable completion gate — Still open

- [x] No generic electronics dashboard, React Flow hardware UI, module-card replacement, flattened-image panel, guessed module order, extra unverified module, or movable/rearranged physical hardware.
- [x] No one-socket-one-wire restriction; adding a branch preserves prior output connections, and single-driver destination validation is documented.
- [x] No fake scope waveform, decorative tunable knob with no graph effect, or undocumented behavior silently claimed exact. Remaining approximations and source gaps are disclosed above and in the reconstruction document.
- [ ] Do not declare final digital-twin completion until the remaining model-specific photo details, stateful processor accuracy/continuity, experiment library and advanced Settings are verified end-to-end.

Browser-local persistence verification: Save → full page reload → Open restored the one-lead project and `Single` trigger mode. The temporary browser test record was deleted.
