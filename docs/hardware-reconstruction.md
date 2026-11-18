# EMONA Telecoms-Trainer 101 — Hardware Reconstruction

**Prepared by Manus AI · 16 November 2026**

This reconstruction combines the user-supplied front photograph with the manufacturer’s front-panel drawing, user-manual conventions and ETT-101 specifications. The earlier inline photograph identifies the light-metal, blue-edged instrument appearance. Its displayed 400 × 343 px view does not reliably resolve every small legend or per-socket color. The manufacturer’s panel diagram resolves the module arrangement and printed terminal names; the notes below distinguish confirmed markings from items that still need confirmation. [1] [2]

## A. Overall panel and measured coordinate frame

The reference is the standard ETT-101 front panel, not the ETT-101C’s PC-enabled instrument variant. The official sources inspected do **not** establish a verified physical width and height for this front-panel version. The outer SVG frame `viewBox="0 0 280 240"` follows the supplied photograph’s 400:343 overall product ratio; within it, the pale metal faceplate and module divisions follow the manufacturer drawing. These are normalized implementation coordinates, not millimetre measurements. [1] [2] [3]

The manufacturer’s front-panel drawing has a header, two horizontal module rows, an inter-row ground/patch rail and a lower margin. The following normalized coordinate bands are measured from that drawing and scaled into the faceplate region within the 280 × 240 outer frame. They are a layout reconstruction, not physical millimetres or published individual-module manufacturing dimensions:

- Outer normalized coordinate range: `x=0…280`, `y=0…240`.
- Module field left/right bounds: approximately `x=10…270` normalized units.
- Top row: approximately `y=15…121` normalized units.
- Inter-row ground/patch rail: approximately `y=121…132` normalized units.
- Bottom row: approximately `y=132…223` normalized units.
- Header and lower frame occupy the remaining top/bottom margins.

The nine top-row section boundaries are approximately `x=[10, 39, 68, 97, 125, 154, 183, 212, 241, 270]` normalized units. The bottom row uses the first eight boundaries, with the final Expansion bay spanning two standard section widths: `x=[10, 39, 68, 97, 125, 154, 183, 212, 270]`. These ratios are derived from the manufacturer’s drawing; they do not imply that every bay is exactly 29 mm wide. The top and bottom sections are not a free-placement grid: their order, composite regions and relative widths are part of the physical trainer. [1] [2]

The user photo shows a pale metallic faceplate, a blue/dark outer enclosure edge, dark printed legends and a physical bench-instrument finish. The panel is built from individual SVG/React elements, not a flattened product image. Exact socket colors are not stated in the monochrome manufacturer diagram and cannot be assigned confidently from the small inline photo. Use the documented socket-shape convention and do not invent a per-port color code. [1]

## B. Top row, left to right

Each standard top-row bay is about 29 normalized units wide in the drawing-based viewBox. A bay can contain more than one physically distinct function. In particular, the two stacked top-row multipliers remain separate hardware instances, and the Noise Generator and Buffer are vertically divided functions in one column. [1]

| Bay | Panel label and position | Physical sub-sections and visible controls |
|---|---|---|
| T1 | **ADDER**, first bay at left | One variable-gain two-input adder. Two rotary controls are marked `G` and `g`. |
| T2 | **MULTIPLIER**, second bay | Two separate multiplier sections stacked vertically. The upper section has `X DC`, `X AC`, `Y DC`, `Y AC` alternatives and `kXY`; the lower section has `X DC`, `Y DC` and `kXY`. These are not one merged multiplier. |
| T3 | **TWIN PULSE GENERATOR** | `WIDTH` and `DELAY` rotary controls; digital `CLK`, `Q1` and `Q2` terminals. |
| T4 | **DUAL ANALOG SWITCH** | Two analog inputs `IN 1`/`IN 2`, two digital control terminals `CONTROL 1`/`CONTROL 2`, and analog `OUT`; a separate sample-and-hold sub-block has `S&H IN` and `S&H OUT`. |
| T5 | **NOISE GENERATOR / BUFFER**, vertically stacked | The Noise Generator exposes analog `0 dB`, `-6 dB` and `-20 dB` output taps. The Buffer below has analog `IN` and `OUT`, a `GAIN` knob and a headphone monitor connector. |
| T6 | **CHANNEL MODULE** | Upper `CHANNEL BPF` input/output pair; middle `BASEBAND LPF` input/output pair; lower fixed-gain Adder section with `NOISE`, `SIGNAL` and `CHANNEL OUT`. The lower Adder is a physically distinct sub-block inside the Channel Module region. |
| T7 | **PHASE SHIFTER** | Analog `IN` and `OUT`, `PHASE` rotary control and a 0°/180° switch. A small ringed mark labeled `LO` is shown above; the published specification describes low/high operating bands and automatic boundary detection, but does not identify this mark’s electrical direction. It is treated as an indicator, not a patch socket, until confirmed. |
| T8 | **UTILITIES** | Four vertically stacked functions: Comparator (`REF`, `IN`, digital `OUT`); Rectifier (`IN`, `OUT`); Diode & RC LPF (`IN`, `OUT`); RC LPF (`IN`, `OUT`). |
| T9 | **TUNEABLE LPF** | Analog `IN`/`OUT`, `fc` and `GAIN` rotary controls, plus a square digital `fc × 100` frequency-monitor output. |

The official specification identifies two independent Adders overall. The first is the variable-gain T1 Adder. The second is the fixed-unity-gain Adder shown inside the Channel Module. It also confirms three independent multiplier cores overall: two in T2 and one in the bottom-row multiplier bay. [1] [2]

## C. Bottom row, left to right

The bottom row has seven standard-width bays followed by a double-width Expansion bay. Some functions share a printed physical region but remain separate signal blocks and get separate stable component/port IDs in the software model. [1]

| Bay | Panel label and position | Physical sub-sections and visible controls |
|---|---|---|
| B1 | **VARIABLE DCV / SPEECH / EXOR**, first bay at left | Variable DCV: `+5V`, `VDC`, `GND` and one `VDC` level knob. Speech: an onboard microphone and analog output terminal. EXOR: digital inputs `A`/`B` and digital output `A ⊕ B`. |
| B2 | **VCO** | Analog `VCO INPUT`, analog `SINE` output, square digital `DIGITAL` output, `GAIN`/`FREQ` controls and `HI`/`LO` switch. |
| B3 | **SEQUENCE GENERATOR / LINE CODE / DIVIDER** | Sequence Generator: digital `CLK` input and `SYNC`, `X`, `Y` outputs. The adjacent Line Code section has a `LINE CODE` output and four printed line-code choices. Divider below has digital `IN`/`OUT` and a ratio selector. |
| B4 | **PCM ENCODER** | Analog `INPUT 1`/`INPUT 2`; digital `CLK` input; digital `PCM DATA` and `FS` outputs; PCM/TDM selector. |
| B5 | **MASTER SIGNALS** | Six fixed outputs: 100 kHz sine, 100 kHz cosine, 100 kHz digital, 8 kHz digital, 2 kHz digital and 2 kHz sine. The printed faceplate rounds some labels; the specifications give the corresponding rates as 100 kHz, 8.333 kHz and 2.083 kHz where applicable. |
| B6 | **MULTIPLIER / SERIAL TO PARALLEL**, vertically stacked | The third independent multiplier has analog `X DC`, `Y DC`, `kXY`. Serial-to-Parallel below has digital `SERIAL`/`CLK` inputs and bipolar parallel `X1`/`X2` outputs (round analog terminals in the diagram). |
| B7 | **PCM DECODER** | Digital `FS`, `PCM DATA` and `CLK` inputs; analog `OUTPUT 2` and `OUTPUT` terminals. A ringed mark labeled `TDM` appears beside the decoder; it is treated as an indicator/status mark rather than a 2 mm signal terminal pending a full-model confirmation. |
| B8 | **EXPANSION**, double width at far right | Optional expansion-board bay. The base panel drawing shows a physical slot, not ordinary 2 mm patch terminals. Optional add-on boards are separate hardware configurations and must not be presented as built-in base modules. |

The diagram also shows two shared `GND` sockets on the inter-row rail. These are common/system ground terminals. The header shows `DC IN 9–15V 1A`; the panel also shows a `POWER` indicator. Neither the power jack nor the headphone monitor jack is a signal-graph patch socket. [1] [2] [3]

## D. Socket inventory and stable IDs

The manual defines the front-panel socket convention: left-side sockets are inputs; right-side sockets are outputs; filled round markers are analog; filled square markers are digital; round `GND` terminals are common/system ground. The sample manual describes 2 mm patch sockets, with analog signals typically near 4 V peak-to-peak and digital levels at TTL 0–5 V. This convention, not screen coordinates alone, determines direction and signal type. [1]

IDs below are proposed software identifiers based on physical bay and printed label. Each physical terminal receives its own persistent ID. Repeated labels remain distinct by hardware instance—for example `top.multiplier.upper.X_DC` and `bottom.multiplier.X_DC`. The order in each entry is the vertical/left-to-right order shown on the panel; `IN`/`OUT` and types are made explicit.

| Hardware ID prefix | Individual physical sockets, with role and type |
|---|---|
| `top.adder` | `A` — analog input; `B` — analog input; `GA+gB` — analog output. |
| `top.multiplier.upper` | `X_DC` — analog input; `X_AC` — analog input; `Y_DC` — analog input; `Y_AC` — analog input; `kXY` — analog output. AC/DC choices are separate physical sockets and must not be silently merged into one screen location. |
| `top.multiplier.lower` | `X_DC` — analog input; `Y_DC` — analog input; `kXY` — analog output. |
| `top.twinPulse` | `CLK` — digital input; `Q1` — digital output; `Q2` — digital output. |
| `top.analogSwitch` | `S&H_IN` — analog input; `S&H_OUT` — analog output; `IN1` — analog input; `CONTROL1` — digital control input; `CONTROL2` — digital control input; `IN2` — analog input; `OUT` — analog output. |
| `top.noise` | `0dB` — analog output; `-6dB` — analog output; `-20dB` — analog output. |
| `top.buffer` | `IN` — analog input; `OUT` — analog output. The nearby stereo headphone jack is a monitor connector, not a patch-graph port. |
| `top.channel` | `CHANNEL_BPF_IN`/`CHANNEL_BPF_OUT` — analog input/output; `BASEBAND_LPF_IN`/`BASEBAND_LPF_OUT` — analog input/output; `NOISE`/`SIGNAL` — analog inputs to the internal Adder; `CHANNEL_OUT` — analog output. |
| `top.phaseShifter` | `IN` — analog input; `OUT` — analog output. `LO` is a ringed status mark in the drawing, not counted as a patch socket pending confirmation. |
| `top.utilities.comparator` | `REF` — analog reference input; `IN` — analog input; `OUT` — digital output. |
| `top.utilities.rectifier` | `IN` — analog input; `OUT` — analog output. |
| `top.utilities.diodeRcLpf` | `IN` — analog input; `OUT` — analog output. |
| `top.utilities.rcLpf` | `IN` — analog input; `OUT` — analog output. |
| `top.tuneableLpf` | `IN` — analog input; `OUT` — analog output; `fc_x100` — digital output. |
| `bottom.variableDcv` | `+5V` — square/digital-level output; `VDC` — analog output; `GND` — common/system ground. |
| `bottom.speech` | `OUT` — analog output from the onboard microphone. The microphone capsule is not a 2 mm patch input. |
| `bottom.exor` | `A` — digital input; `B` — digital input; `A_XOR_B` — digital output. |
| `bottom.vco` | `VCO_INPUT` — analog control input; `SINE` — analog output; `DIGITAL` — digital output. |
| `bottom.sequence` | `CLK` — digital input; `SYNC` — digital output; `X` — digital output; `Y` — digital output. |
| `bottom.lineCode` | `LINE_CODE` — analog output. The official specification says the encoder uses the Sequence Generator X sequence and the same clock; no extra external data/clock sockets are drawn in this physical region. |
| `bottom.divider` | `IN` — digital input; `OUT` — digital output. |
| `bottom.pcmEncoder` | `INPUT1`/`INPUT2` — analog inputs; `CLK` — digital input; `PCM_DATA`/`FS` — digital outputs. |
| `bottom.masterSignals` | `100kHz_SINE` — analog output; `100kHz_COS` — analog output; `100kHz_DIGITAL` — digital output; `8kHz_DIGITAL` — digital output; `2kHz_DIGITAL` — digital output; `2kHz_SINE` — analog output. |
| `bottom.multiplier` | `X_DC` — analog input; `Y_DC` — analog input; `kXY` — analog output. |
| `bottom.serialToParallel` | `SERIAL`/`CLK` — digital inputs; `X1`/`X2` — bipolar analog outputs. |
| `bottom.pcmDecoder` | `FS`/`PCM_DATA`/`CLK` — digital inputs; `OUTPUT2`/`OUTPUT` — analog outputs. `TDM` is a ringed status mark in the drawing, not counted as a patch socket pending confirmation. |
| `panel.groundRail` | `GND_LEFT` and `GND_RIGHT` — common/system ground terminals. |

The counted labels are the terminals represented as patch sockets in the manufacturer’s diagram; the power inlet, power/LO/TDM indicators, headphone connector and expansion slot are documented separately and are not treated as graph ports. Before final socket-count sign-off, compare this transcription against a full-resolution product photograph or the complete manual for the exact hardware revision. The software must not create extra terminals to fill an assumed count. [1] [2]

## E. Controls and non-patch hardware inventory

| Panel area | Visible controls/indicators/connectors |
|---|---|
| Header/enclosure | Printed EMONA Telecoms-Trainer 101 product title; analog/digital legend; DC input labeled 9–15 V, 1 A; power indicator; outer instrument enclosure. The digital twin may label itself Virtual Telecoms Lab while using neutral model-identification text. |
| Top Adder | `G` and `g` gain knobs. First Adder gain range is 0–2, inverting, per manufacturer documentation. |
| Top multipliers | AC/DC input choices are explicit separate sockets on the upper unit; no extra decorative controls. Three independent multiplier cores total. |
| Twin Pulse Generator | `WIDTH` and `DELAY` rotary controls; clock and pulse outputs. Manufacturer specs: clock <8 kHz, pulse width 5–40 μs, Q2–Q1 delay 50–300 μs. |
| Dual Analog Switch/S&H | External digital `CONTROL 1`/`CONTROL 2` sockets; sample/hold in/out and analog switch in/out. |
| Noise Generator | Three fixed output attenuation taps `0 dB`, `-6 dB`, `-20 dB`; manufacturer describes white-noise output from 10 Hz to below 240 kHz. |
| Buffer/headphone | `GAIN` knob; analog patch input/output; separate stereo headphone monitor socket. |
| Channel Module | BPF, Baseband LPF and fixed-gain Adder; published specs list BPF center 100 kHz, 24 kHz passband, and Baseband LPF cutoff 1.6 kHz. |
| Phase Shifter | `PHASE` knob, 0°/180° switch and ringed `LO` mark. The manufacturer’s specification describes low/high frequency operating regions and an automatic boundary near 40 kHz; it does not list an extra LO signal input/output. |
| Utilities | Comparator reference and signal inputs; rectifier and filter inputs/outputs. No additional knobs are drawn. |
| Tuneable LPF | `fc` and `GAIN` knobs; `fc × 100` output. Published sources disagree on exact cutoff/gain ranges; both values are recorded under uncertainties. The 8th-order elliptic response is documented. |
| Variable DCV / Speech / EXOR | `VDC` knob; built-in electret microphone; EXOR terminals. Manufacturer specification gives VDC ±2.5 V and a +5 V terminal. |
| VCO | `GAIN` and `FREQ` knobs, `HI`/`LO` range selector. Published frequency ranges are 1–17 kHz in LO mode and 60–140 kHz in HI mode. |
| Sequence Generator / Line Code / Divider | Sequence selection controls and a four-choice line-code selector as printed; Divider ratio selector. Manufacturer specification gives X=31 bits, Y=255 bits and divider factors ÷1/÷2/÷4/÷8. |
| PCM Encoder / Decoder | PCM/TDM mode selector on encoder; TDM indication on decoder; external clock, framing and data sockets. Both modules have physical terminal labels in the diagram. |
| Master Signals | Fixed reference outputs; no knobs are shown. Manufacturer specifications give analog 100 kHz quadrature carriers, a 2.083 kHz analog message and corresponding digital references including 8.333 kHz. |
| Serial-to-Parallel | Serial/clock inputs and X1/X2 parallel outputs; no separate knobs shown. |
| Expansion | Optional board insertion slot; do not imply optional board controls or sockets exist on the base unit. |
| Global ground/power | Two shared ground sockets on the inter-row rail; one ground socket inside Variable DCV; 9–15 V DC power inlet and power indicator. |

Variable controls in the manufacturer’s TIMS convention are not calibrated with numeric dial marks; values should be shown as software readouts without inventing printed scale ticks. [1] [2]

## F. Uncertainties that remain

1. **Fine colors and print finish:** the inline user photo is small; the official panel drawing is monochrome. The broad light-metal panel and blue/dark enclosure are apparent, but per-terminal color assignments, precise paint shades and tiny decorative markings are not confirmed. Do not assign a type-color code unless the user supplies a clearer photograph or a source documents it.
2. **Phase Shifter `LO` mark:** the panel drawing uses a ringed symbol rather than the solid round analog or square digital socket marker. The official specification documents LO/HI frequency regions but no extra LO port. Treat it as an indicator in the first vector reconstruction; do not make it connectable unless a full manual or clear hardware photo confirms it is a socket.
3. **PCM Decoder `TDM` mark:** similarly ringed. It is represented as a status indicator, not a signal socket, pending confirmation from a complete manual or full-resolution hardware view.
4. **Photo revision/model:** the visible reference title says Telecoms-Trainer 101 and the manufacturer distinguishes standard ETT-101 from PC-enabled ETT-101C. The reconstruction follows the standard ETT-101 board shown; no embedded USB scope/analyzer is added. Confirm if the intended hardware revision is an ETT-101C or includes an expansion board.
5. **Per-socket color and position fidelity:** module rectangles, order and socket anchor coordinates are now represented in the SVG layout from the official diagram. The monochrome diagram and low-resolution user photo do not establish a calibrated physical measurement or a finer pixel-perfect color/spacing tolerance.
6. **Tunable LPF document revision:** the sample User Manual’s module page states a 300 Hz–16 kHz cutoff and gain 0–×2, while the separate ETT-101 Specifications v1.1 sheet states 600 Hz–12 kHz and gain 0–1.6. Do not silently select one range as universally exact; confirm the target hardware revision before hard-bounding its control. [1] [2]

## References

[1]: https://www.emona-tims.com/wp-content/uploads/2015/07/ETT101-SAMPLE-UserManual.pdf "EMONA Telecoms-Trainer 101 User Manual"
[2]: https://www.emona-tims.com/wp-content/uploads/2015/07/ETT101-specifications-V1_1.pdf "ETT-101 BiSKIT Specifications V1.1"
[3]: https://www.emona-tims.com/emona-product/compact-experimenter/ "EMONA Compact Experimenter BiSKIT 101"
