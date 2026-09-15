# AGENTS.md

Browser-based Intel 8086 emulator: assembler + step/run CPU + registers/flags/memory panels.

## Commands

- `npm run dev` — Vite dev server (fixed port 5173, `strictPort`; required by Tauri `devUrl`)
- `npm test` — all Vitest unit tests (Node only, no browser); single file: `npx vitest run tests/core/<name>.test.ts`
- `npm run build` — `tsc --noEmit` typecheck, then `vite build` into `dist/` (Tauri `frontendDist` + `beforeBuildCommand`; `dist/` is gitignored). No lint or formatter script.
- `npm run tauri dev` — native dev window (auto-starts Vite via `beforeDevCommand`; don't run `npm run dev` separately). `npm run build:mac` — release `.app` + `.dmg` into `src-tauri/target/release/bundle/`.
- Verify changes with `npm run build && npm test`.

## Architecture

- `src/core/` is framework-free TS (no DOM/React), unit-tested in Node: `cpu.ts`, `assembler.ts`, `memory.ts`, `interrupts.ts`, `types.ts`. `src/components/` is the React 18 UI.
- `src/core/assembler.ts` is the source of truth for parsing/directives (`ORG`, `DB`/`DW`/`DD`, `.MODEL`, `SEGMENT`, `PROC`, `END`) — labels resolve to physical addresses, `dataSegmentParagraph` is `0x1000`. `src/samples/index.ts` is the UI sample registry (inline strings; sibling `.asm` files are inert mirrors — editing them alone changes nothing).
- **Execution model (critical):** programs run via `assemble(source)` → write each `instruction.bytes` to `ai.address` in memory, build `Map<address, AssembledInstruction>`, then call `cpu.execute(instruction)` directly. `dataBytes` must also be loaded at `dataSegmentParagraph << 4`. See `programStep` in `src/App.tsx:94` or `runSnippet` in `tests/core/suite_8086.test.ts`.
- **IP-advance asymmetry:** `cpu.decode()` advances IP, but `cpu.execute()` does not — the direct-`execute()` harness must advance IP manually when unchanged (`IP = (ip + instruction.bytes.length) & 0xffff`). Never route assembled code through `decode()`/`step()` (double-advances/mis-decodes; `decodeOpcode` covers only a subset and returns `UNKNOWN`, which `execute()` throws on).
- INT 20h/21h/16h need a handler: `cpu.interruptHandler = createInterruptHandler({ writeChar, readChar })` (AH=4Ch and INT 20h halt via synthetic `HLT`; other vectors no-op). Port I/O via `cpu.onPortOut`/`cpu.onPortIn` (UI: port 2 → LED panel, port 1 → IoPorts panel).
- Segmented (`.MODEL`/`.DATA`/`.CODE`/`.STACK`/`PROC`/`SEGMENT`) vs flat `.COM`-style (`ORG 100h`) setup differs (DS/SS/SP). Detect via `/(\.MODEL|PROC|SEGMENT|\.DATA|\.CODE|\.STACK)/i`. Flat-mode SS/SP disagree by harness: `App.tsx`, `user_reported.test.ts`, and `instruction_reference.test.ts` use SS=`0x2000`/SP=`0x0100`; `suite_8086.test.ts` and `bug_reproduction.test.ts` use SS=`0`/SP=`0xFFFE` — copy the harness matching your context.

## Tests

- Vitest uses `globals: true`; six suites in `tests/core/` (`cpu`, `memory`, `suite_8086` per `8086_TEST_SUITE.md`, `instruction_reference`, `bug_reproduction`, `user_reported`). The large suites each define their own local `runSnippet`/`runAssembly` harness — copy the pattern rather than sharing it.
- `getState()` returns a copy — mutate only via `cpu.writeRegister` / `writeRegister8`; read via `readRegister16` / `readRegister8`. Physical addresses: `((seg << 4) + off) & 0xfffff` over flat 1 MB zero-init `Memory` (`src/core/memory.ts`).
- `8086_TEST_SUITE.md` is the conformance spec. `INSTALL_MACOS.md` has the Gatekeeper `xattr -cr` workaround and aarch64-only details.

## Gotchas

- tsconfig maps `@/* -> src/*` but Vite has no alias — `@/` imports break; use relative imports.
- README structure/supported-instruction tables lag the code; `execute()` switch in `src/core/cpu.ts` and `src/core/interrupts.ts` are the source of truth.
- Run-loop concurrency: `runLoop` in `App.tsx` must stay referentially stable (speed/breakpoints via refs) with a single-flight guard — a second timer chain re-executes INT 21h output (classic "0112233…" duplication). Batching (`1/8/64` instr per tick at speed `<100`/`>=100`/`>=1000`) changes render frequency only.
- Console transport dedupe: `consoleBroadcast` stamps a monotonic `seq` on append/sync/clear; `ConsoleWindow` applies via `applyConsoleMessage` (drops re-delivered/stale messages). `subscribeConsoleMessages` must stay cancellation-safe (late Tauri `import` after unmount must not leave live listeners). Covered by "Console transport dedupe" tests in `tests/core/user_reported.test.ts`.
- Blocking input: `isWaitingForInput` in `App.tsx` pauses Step/Run at INT 21h AH=`01`/`08`/`0A` and INT 16h AH=`00` when the keyboard queue is empty (executing would consume null → AL=0). Status checks (INT 21h AH=`0Bh`, INT 16h AH=`01h`) use non-destructive `peekChar` — never `readChar`.
- Flat-mode `[SI]` reads real memory at DS:SI, which overlaps the code region when DS=0 — array programs need a `DB` array + `OFFSET` (see `find_max` sample), not a bare `MOV SI,0000H`.
- `handleAssemble` clears the keyboard queue (`inputRef`/`pendingInput`) — type input after assembling, not before. `INT 21h AH=0Ah` echoes via `io.writeChar`, so a program that also prints the char shows it twice.
