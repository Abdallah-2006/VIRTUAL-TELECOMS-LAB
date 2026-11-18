# Virtual Telecoms Lab — ETT-101 Digital Twin Plan

## Goal and scope

Turn the existing browser-first Virtual Telecoms Lab into a faithful, interactive digital twin of the standard EMONA Telecoms-Trainer 101 (ETT-101), using the supplied product photograph as the primary visual reference and the manufacturer’s panel diagram/specification/user-manual excerpts to resolve module order, labels, socket types and documented behavior. The newly attached master brief supersedes the earlier freeform-node/dashboard layout: the physical panel is the application’s primary interface, not a module-card catalog or a generic canvas.

The required first deliverable, `docs/hardware-reconstruction.md`, records the two-row module map, a normalized 280 × 240 outer frame guided by the supplied photo and the manufacturer-diagram-derived inner faceplate bands, every diagram-identified port with a stable proposed ID and analog/digital role, controls, source references and unresolved details. These are design units, not claimed physical millimeters. The standard ETT-101 is the target; no ETT-101C-only scope/analyzer or optional expansion board is invented. Ambiguous ringed `LO`/`TDM` markings are not silently made patchable. The conflicting published Tunable LPF ranges are retained as a revision-specific uncertainty.

The application must combine both parts of the request: (1) a close, component-built reproduction of the real two-row hardware and (2) a real communications laboratory in which all visible sockets and controls participate in the graph or are explicitly documented indicators/connectors. It is not complete when it is only a visual panel. No core module may remain a label-only placeholder; no waveform may be fabricated for display.

## Implementation approach

### Physical front panel

Implement the enclosure, front panel and patch layer with React, TypeScript, SVG and CSS. Use the normalized outer `viewBox="0 0 280 240"` to follow the supplied photo’s overall 400:343 ratio; preserve the manufacturer-drawing-derived faceplate ratios and derive all module, control, indicator, socket and cable anchor positions from the same normalized layout definition. The panel has two primary horizontal rows with the manufacturer’s module ordering and relative bay widths. The top row contains nine sections; the bottom row has seven standard-width sections and a double-width Expansion bay. Nested boundaries represent physically stacked subfunctions, including the two separate top-row Multipliers, the Noise Generator/Buffer column, the Channel Module’s filters and Adder, bottom-left Variable DCV/Speech/EXOR, Sequence Generator/Line Code/Divider, and Multiplier/Serial-to-Parallel.

The visual vocabulary follows the supplied image: one horizontally oriented industrial instrument, solid outer housing, light metal faceplate, dark printed labels and separators, small black/rimmed jacks, tactile knobs/switches and a separate high-contrast oscilloscope. Documented analog sockets are round and digital sockets square per the manual. Do not infer unverified per-socket color codes from the low-resolution photo; use the documented shape semantics until a clearer source resolves colors. The panel remains a collection of individually rendered components—never one flattened image or invisible hotspots. No sidebar full of module cards, React Flow canvas, free-form module movement or software-driven rearrangement of the physical hardware.

The app toolbar is compact and belongs to the instrument workflow. The four-channel scope and experiment/analysis controls are separate instruments around/below the main faceplate rather than dashboard cards. On narrow screens, the panel preserves its proportions and horizontal-scrolls; labels and sockets are never compressed into illegibility.

### Hardware model and interactive patching

`src/hardware/layout.ts` will hold the source-linked normalized front-panel geometry, stable physical module IDs, socket IDs/anchors, printed labels, direction/type metadata, controls and uncertainties. Each physical module family (Adder, Multiplier, VCO, PCM Encoder, etc.) receives its own reusable component and data-driven definition; repeated physical modules use separate instance IDs. A control descriptor defines its real range, units, default and callback into project parameters. Ringed indicators, ground terminals, headphone/power connectors and the expansion slot are separate component roles, not signal sockets.

An SVG patch-cable layer draws persistent cubic Bézier leads from actual socket centers. Mouse and touch patching begins at an output, follows the pointer, highlights compatible targets, and creates a stable connection on release. One output may fan out to many independent destinations, including multiple module inputs and multiple scope probes; adding a branch never replaces an existing lead, and removing one lead does not disturb others. A destination only accepts additional drivers where its documented electrical role supports that; ordinary module inputs accept a single source. Each connection has a unique ID, socket endpoints, color/state/path, selectable/delete/reconnect lifecycle, cable palette (red, black, yellow, green, blue, white), undo/redo and clear-all behavior. Invalid type/direction/cycle attempts are visible and explained. Panel resize/scale changes recompute anchors, so cables remain attached and do not intercept knob/switch interaction.

### Signal/DSP engine

Keep the TypeScript DSP core independent from React. Signals are sampled typed buffers with sample rate, signal type, optional clock/sync metadata and timestamp. The graph derives only from cable connections, runs in dependency order, detects cycles and invalid parameters/clock or buffer alignment, distributes the same calculated output buffer/reference to every fan-out branch, and re-evaluates correctly on control or topology changes. A fixed-rate project time model and documented block/state continuity govern filters, pulses, counters, sampling and PCM; an unconnected output never becomes an unrelated scope waveform. Numerical graph and FFT work execute in Vite module workers when appropriate.

Processors correspond to confirmed ETT-101 hardware: two independent Adders (one variable inverting-Gain unit and one fixed-gain Adder inside Channel Module); three independent multiplier cores; Buffer/gain; Twin Pulse Generator; Dual Analog Switch and sample/hold; seeded configurable Noise Generator; Channel BPF and Baseband LPF; Phase Shifter; comparator, rectifier, Diode & RC LPF and RC LPF; Tunable LPF; Variable DCV; onboard Speech output; EXOR; VCO; Sequence Generator; Line Code Encoder; Divider; PCM Encoder/Decoder; Master Signals; and Serial-to-Parallel. Use documented parameter values/IO roles where available. If source revisions conflict or the exact response is undocumented, encode a clearly labeled approximation/configuration with provenance rather than claiming an exact hardware transfer function. A generic, non-hardware Signal Generator is not placed on the physical panel; hardware Master Signals, VCO, Twin Pulse, Noise, Variable DC and Sequence Generator provide the source functions.

### Instruments and experiments

Create a visually separate four-channel oscilloscope with independent CH1–CH4 probes that connect to output sockets without altering the signal graph. Each channel has enable, probe, volts/div, vertical position and its own trace. Include time/div, trigger source/level/mode, continuously advancing worker-driven Run/Stop, one-shot Single acquisition and Auto Setup. Show real frequency, peak-to-peak, RMS and mean measurements. FFT views use actual socket buffers and provide frequency-spectrum analysis. With no probe signal, show an explicit no-signal state. Cable removal, source/control change and topology edits update the next processed frame and measurements. Stateful filters currently reset per frame and need subsequent continuity work.

Experiments are built from the same actual panel modules and patch graph. Provide the requested flows: AM DSB-TC with message/carrier/modulation-index control and over-modulation demonstration; DSB-SC through a real multiplier with suppressed carrier and sidebands; coherent demodulation through local oscillator, multiplier and low-pass filter where oscillator phase affects recovery; AM envelope detection; SSB; FM with deviation control; sampling/aliasing; PCM encode/decode; ASK/FSK/BPSK/QPSK; and noise/filtering. Each includes a concise explanation, required circuit/modules, manual patching, actual signal outputs and relevant measurements/spectrum. No experiment is a prerecorded waveform or a shortcut operation that bypasses its named modules.

### Projects, settings and runtime

Keep the core app browser-first and local-first; basic use needs no backend or Python. IndexedDB stores the portable project configuration: control values/knobs, switch states, every patch cable and color, four scope probe connections/settings, selected experiment/guidance state and simulation/display settings. JSON import/export round-trips that state with schema validation and no code execution. Reopening restores the same cable topology and control state. Settings expose sample rate/display/simulation preferences as appropriate.

Retain the existing React/TypeScript/Vite toolchain, route manifest, strict diagnostics, Canvas scope rendering, worker entry points, IndexedDB repository and tests where they fit. Add domain folders for hardware components/layout, patching, expanded DSP modules, four-channel instruments, experiment graphs/guidance, project migration and storage. Avoid unnecessary dependencies; keep a modern-browser target and no required server.

## Project structure

```text
telelab/
├── docs/
│   └── hardware-reconstruction.md  # Source-cited physical map, socket/control inventory and uncertainties
├── public/
│   └── manus-routes.json            # Declared browser route
├── src/
│   ├── app/                         # Compact lab toolbar, project and experiment orchestration
│   ├── hardware/                    # Panel layout, measured coordinates, hardware registry and panel components
│   ├── patching/                    # Socket input, SVG leads, compatibility and cable management
│   ├── engine/                      # Typed signals, graph, processors, scheduling, measurements and FFT
│   │   └── workers/                 # DSP/FFT worker entry points and protocols
│   ├── instruments/                 # Four independent scope channels, FFT/spectrum and controls
│   ├── experiments/                 # Editable module/connection templates and guided explanations
│   ├── project/                     # Versioned project schema, validation and migrations
│   ├── storage/                     # IndexedDB and safe JSON import/export
│   └── styles/                      # Faceplate/enclosure, socket, cable, instrument and responsive styles
├── tests/                           # Hardware map, patch graph, DSP, instruments and persistence tests
├── plan.md
├── TODO.md
├── README.md
└── package.json
```

## Constraints and source discipline

The existing first-milestone signal graph and tests are assets to reuse, but its freeform module layout, one-wire input restriction and two-channel scope do not satisfy this new brief. Migrate rather than keeping incompatible duplicate interfaces. The master prompt’s supplied photograph remains the primary visual reference; the manufacturer User Manual and Specifications V1.1 cited in the reconstruction file are used for port conventions and technical details. The official drawing/specification discrepancies and unresolved ringed indicators remain visible in documentation and are not converted into unverified facts. Do not add ETT-101C-only parts or optional expansion hardware to the base panel.

## Design direction

Use the user’s actual ETT-101 photo and the source-cited manufacturer panel drawing; do not invent a new dashboard aesthetic.

- **Design Movement:** a measured digital facsimile of a late-1990s/early-2000s educational telecommunications trainer.
- **Core Principles:** physical order is invariant; every patch terminal has a real electrical role; every control changes simulation; measurement traces reflect the connected signal.
- **Color Philosophy:** cool blue/charcoal outer housing encloses a pale metallic faceplate; charcoal silkscreen gives real-instrument contrast. Individual socket colors remain source-driven; analog/digital meaning is already encoded by circle/square shape in the official convention. Scope screens use near-black backgrounds and bright readable traces.
- **Layout Paradigm:** one large two-row instrument faceplate is the primary workspace; patch cables span the actual panel sockets. Scope and compact project/experiment controls sit around it without restructuring the hardware or obscuring its labels.
- **Signature Elements:** stepped module separators aligned to the source drawing; individualized 2 mm socket components and gently curved patch leads; engraved technical labels with tactile knobs and status LEDs.
- **Interaction Philosophy:** direct-manipulation patching follows the real bench workflow. Outputs fan out; leads have independent identities and lifecycles; invalid electrical choices are visible instead of silently altered.
- **Animation:** restrained 120–180 ms knob/switch/selection feedback; preview cable follows the pointer; no decorative looping. Scope animation advances only from simulation frames and stops when the run is stopped.
- **Typography System:** compact, highly legible condensed sans for printed module legends; clear sans for toolbar/guidance; tabular monospace for frequency, voltage and measurements. Maintain readable minimum size under scaling.
- **Brand Essence:** a precise, hands-on communications lab for students and instructors; **faithful, tactile, explanatory**.
- **Brand Voice:** concise bench language: “Patch an output to an input to build the circuit.” and “No probe signal — connect a live output to this channel.”
- **Wordmark & Logo:** retain Virtual Telecoms Lab identity outside the hardware legends; identify the model in plain text without using the original stylized logo artwork as a page background.
- **Signature Brand Color:** deep instrument teal for selected/highlighted graph state only, subordinate to the hardware reference palette.

## Delivery sequence

1. Complete and use the source-cited panel reconstruction (delivered as the first artifact).
2. Replace the freeform dashboard with the measured component-built two-row panel and individually identified sockets/controls.
3. Complete multi-fan-out patching and hardware compatibility against the physical port inventory.
4. Extend the engine so each confirmed visible module has real, documented processing.
5. Add the independent four-channel scope, FFT and measurements.
6. Build the requested experiments from real modules/cables, then add save/load, settings and responsive behavior.
7. Validate strict types, math/graph behavior, required multi-connection case, persistence and the actual running panel; document any source-specific uncertainty.

Do not call the project complete until every final acceptance criterion in the master prompt is implemented and verified; keeping a runnable intermediate is not a substitute for the completed digital twin.
