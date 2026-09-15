# 8086 Emulator

> **Intel 8086 microprocessor emulator** — write 8086 assembly, assemble it, and
> step through execution while registers, flags, stack, and memory update live.
> Runs in the browser, or as a native macOS app (Tauri).

[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tauri](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)](https://tauri.app/)
[![Vitest](https://img.shields.io/badge/Tested_with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)

---

## Features

- **In-browser assembler** — flat `.COM`-style (`ORG 100h`) and segmented
  (`.MODEL` / `.DATA` / `.CODE` / `.STACK` / `PROC`) programs, labels, `DB`/`DW`
- **Step / Run / Pause / Reset** — single-step or run continuously at
  1 Hz – 1 kHz; high speeds batch instructions per tick so long loops finish fast
- **Breakpoints** — click a gutter line number; execution pauses there
- **Live register panel** — AX, BX, CX, DX (+ AH/AL…), SP, BP, SI, DI, IP,
  DS, SS, CS with per-step change highlighting and hover descriptions
- **Flags panel** — CF, PF, AF, ZF, SF, OF (+ TF, IF, DF) with tooltips
- **Stack, memory viewer, Port-2 LEDs, I/O ports** — hex/ASCII dump with
  segment presets and go-to-address
- **External Console window** — `INT 21h` output opens a separate OS window
  automatically (Tauri window, `window.open` + `BroadcastChannel` fallback)
- **CPU Details page** — Registers / Flags / Stack / Memory diagnostic view
  sharing the same live CPU as the editor (no state reset on switch)
- **DOS INT 21h simulation** — character/string I/O, `AH=4Ch` halt, INT 20h
- **Open / Save `.asm` files** — native Finder dialogs in the Tauri app,
  Blob-download fallback in the browser
- **10 built-in samples** — hello world, Fibonacci, countdown, find-max, LED counter,
  port I/O, string ops, procedures, and more

---

## Install the macOS app

Download the `.dmg` from
[GitHub Releases](../../releases) — full steps, including the one-time
Gatekeeper unblock for the unsigned app, are in
**[INSTALL_MACOS.md](INSTALL_MACOS.md)**:

```bash
xattr -cr /Applications/Emulator8086.app
```

> Apple Silicon only (`aarch64`). Intel Macs: build from source
> (`npm run build:mac` targets the host CPU).

## 📸 Screenshots Of MacOS App

### Emulator App Interface

![8086 Emulator Demo 1](./screenshots/home_page.png)
---

<<<<<<< HEAD
### Emulator Execution and features

![8086 Emulator Demo 2](./screenshots/2.png)
---
### Emulator CPU Details Section
![8086 Emulator Demo 1](./screenshots/3.png)
---


## 🗂️ Project Structure
=======
## Getting started (development)
>>>>>>> e7f4c10 (updation of both)

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later (npm is bundled)
- Rust toolchain — only needed for the Tauri desktop commands

### Setup

```bash
git clone https://github.com/<your-username>/emulator_8086.git
cd emulator_8086
npm install
```

### Run in the browser

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) (fixed port, `strictPort`).
/
### Run the native dev window

```bash
npm run tauri dev
```

Auto-starts Vite via `beforeDevCommand` — don't run `npm run dev` separately.

### Tests & verification

```bash
npm test          # all Vitest unit tests (Node only, no browser) — 140 tests
npm run build     # tsc --noEmit typecheck, then vite build into dist/
```

Single test file: `npx vitest run tests/core/<name>.test.ts`.
Verify changes with `npm run build && npm test`.

### Release build (macOS)

```bash
npm run build:mac
```

Produces `.app` + `.dmg` under `src-tauri/target/release/bundle/`
(`dist/` is the Tauri `frontendDist` and is gitignored).

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server (fixed port 5173) |
| `npm test` | All Vitest unit tests |
| `npm run build` | Typecheck + production build into `dist/` |
| `npm run tauri dev` | Native dev window (auto-starts Vite) |
| `npm run build:mac` | Release `.app` + `.dmg` for macOS |

---

## Project structure

```
emulator_8086/
├── index.html
├── src/
│   ├── main.tsx                # React root + ?window=console routing
│   ├── App.tsx                 # Root component — CPU, editor, panels, run loop
│   ├── index.css               # Theme + component styles
│   ├── core/                   # Framework-free emulator engine (unit-tested in Node)
│   │   ├── cpu.ts              # 8086 CPU — instruction execution engine
│   │   ├── assembler.ts        # Source text → AssembledInstruction objects
│   │   ├── memory.ts           # Flat 1 MB memory model
│   │   ├── interrupts.ts       # INT 20h/21h (DOS) interrupt handler
│   │   └── types.ts            # CPUState, Instruction, Operand, flag helpers
│   ├── components/
│   │   ├── Editor.tsx          # Code editor, gutter, breakpoints, current line
│   │   ├── Controls.tsx        # Assemble / Step / Run / Reset / Speed
│   │   ├── RegisterPanel.tsx   # Live register display (+ bare mode for CPU page)
│   │   ├── FlagsPanel.tsx      # CPU flags display
│   │   ├── StackPanel.tsx      # Stack display
│   │   ├── MemoryViewer.tsx    # Hex/ASCII memory viewer
│   │   ├── LedOutputPanel.tsx  # Port 2 LED display
│   │   ├── IoPortsPanel.tsx    # I/O port panel
│   │   ├── CpuDetailsPage.tsx  # CPU Details diagnostic view
│   │   ├── ConsoleWindow.tsx   # External console window view
│   │   └── HelpModal.tsx       # In-app help
│   ├── utils/
│   │   ├── consoleBus.ts       # Console window open/sync/broadcast (Tauri + browser)
│   │   └── files.ts            # Open/Save .asm (Tauri dialogs + browser fallback)
│   └── samples/
│       ├── index.ts            # Sample registry (source of truth for the UI)
│       ├── hello_world.asm     # …mirrors of the registry entries…
│       └── *.asm
├── tests/core/                 # cpu, memory, suite_8086, instruction_reference
├── src-tauri/                  # Tauri shell (windows, capabilities, icons, bundle)
├── INSTALL_MACOS.md            # macOS install + Gatekeeper instructions
├── 8086_TEST_SUITE.md          # Emulator conformance test-suite spec
├── AGENTS.md                   # Contributor notes (execution model, gotchas)
├── vite.config.ts / vitest.config.ts / tsconfig.json
└── package.json
```

> The `.asm` files next to `src/samples/index.ts` are mirrors — the inline
> strings in the registry are what the UI loads.

### Execution model

The emulator does not run raw machine code by default. `assemble(source)`
returns `{ instructions, dataBytes, … }`; programs run by writing each
`instruction.bytes` to memory, building an address→instruction map, and
calling `cpu.execute(instruction)` directly. `cpu.decode()` advances IP but
`cpu.execute()` does not, so the harness advances IP manually. See
`programStep` in `src/App.tsx`. (Details in `AGENTS.md`.)

---

## Supported instructions

Source of truth: the `execute()` switch in `src/core/cpu.ts`.

| Category | Instructions |
|---|---|
| Data transfer | `MOV`, `PUSH`, `POP`, `XCHG`, `LEA`, `LDS`, `LES` |
| Arithmetic | `ADD`, `ADC`, `SUB`, `SBB`, `MUL`, `IMUL`, `DIV`, `IDIV`, `INC`, `DEC`, `NEG`, `CMP`, `CBW`, `CWD` |
| BCD | `AAA`, `AAS`, `AAM`, `AAD`, `DAA`, `DAS` |
| Logic | `AND`, `OR`, `XOR`, `NOT`, `TEST` |
| Shift / rotate | `SHL`/`SAL`, `SHR`, `SAR`, `ROL`, `ROR`, `RCL`, `RCR` |
| String ops | `MOVS[B/W]`, `CMPS[B/W]`, `SCAS[B/W]`, `LODS[B/W]`, `STOS[B/W]`, `XLAT[B]` |
| Control flow | `JMP`, all `Jcc` (`JE/JZ`, `JNE/JNZ`, `JL/JG/JLE/JGE`, `JB/JA/…`), `JCXZ`, `LOOP`, `LOOPE`/`LOOPZ`, `LOOPNE`/`LOOPNZ` |
| Subroutines | `CALL`, `RET`, `RETF` |
| Interrupts | `INT` (20h/21h simulated), `INTO`, `IRET` |
| Port I/O | `IN`, `OUT` (port 1 → I/O panel, port 2 → LEDs) |
| Flags | `CLC`, `STC`, `CMC`, `CLD`, `STD`, `CLI`, `STI`, `LAHF`, `SAHF`, `PUSHF`, `POPF` |
| Misc | `NOP`, `HLT`, `WAIT`, `LOCK`, `ESC` |
| Directives | `DB`, `DW`, `DD`, `ORG`, `.MODEL`, `.DATA`, `.CODE`, `.STACK`, `.DOSSEG`, `SEGMENT`, `PROC`, labels |

## INT 21h services

| AH | Service |
|---|---|
| `01h` | Read character from stdin → AL |
| `02h` | Write character in DL to stdout |
| `06h` | Direct console I/O |
| `08h` | Read character without echo |
| `09h` | Write `$`-terminated string at DS:DX |
| `0Ah` | Buffered keyboard input |
| `0Bh`/`0Ch` | Input status / flush buffer + input |
| `25h`/`35h` | Set / get interrupt vector |
| `39h`/`3Ch`/`40h` | `MKDIR` / create file / write file |
| `4Ch` | Exit program (halts emulation) |

## Built-in samples

Load any sample from the dropdown in the header:

| Sample | Description |
|---|---|
| `hello_world` | String output via INT 21h service 09h |
| `fibonacci` | Fibonacci numbers using `LOOP` |
| `countdown` | Counts 10 → 0, printing each digit |
| `find_max` | Largest value in a byte array (`DB` + `OFFSET`, result in AL) |
| `sum_array` | Sums an array in memory |
| `register_demo` | Register moves and arithmetic basics |
| `led_counter` | Binary counter on the Port 2 LEDs |
| `io_port_demo` | Port 1 input / Port 2 output demo |
| `string_ops` | String instructions (`MOVS`/`SCAS`/…) |
| `procedures_demo` | `CALL`/`RET` procedures |

---

## Testing

[Vitest](https://vitest.dev/) suites run in Node — no browser required:

```bash
npm test
```

| Suite | Covers |
|---|---|
| `cpu.test.ts` | Instruction-level execution, flags, registers |
| `memory.test.ts` | 8/16-bit reads/writes, boundaries |
| `suite_8086.test.ts` | End-to-end conformance per `8086_TEST_SUITE.md` |
| `instruction_reference.test.ts` | Broad instruction reference checks |
| `bug_reproduction.test.ts` | INT 21h/INT 16h I/O and output-capture scenarios |
| `user_reported.test.ts` | User-reported regressions (App harness) + console dedupe |

---

## Tech stack

| Technology | Purpose |
|---|---|
| [TypeScript](https://www.typescriptlang.org/) | Core engine + UI |
| [React](https://react.dev/) 18 | Reactive UI layer |
| [Vite](https://vitejs.dev/) | Dev server & bundler |
| [Tauri](https://tauri.app/) 2 | Native macOS shell (windows, dialogs, fs) |
| [Vitest](https://vitest.dev/) | Unit testing |
| Inter + JetBrains Mono | UI typography |

---

## License

ISC — see [LICENSE](LICENSE).
