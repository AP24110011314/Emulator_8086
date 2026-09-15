import React, { useState, useCallback, useRef, useEffect } from 'react';
import { CPU } from './core/cpu';
import { assemble, AssembledInstruction } from './core/assembler';
import { createInterruptHandler } from './core/interrupts';
import { saveAsmFile, openAsmFile } from './utils/files';
import { createKeyboardQueue } from './utils/keyboardQueue';
import {
  consoleBroadcast,
  isConsoleWindowOpen,
  isTauri,
  legacyPopupWrite,
  openConsoleWindow,
  subscribeConsoleMessages,
} from './utils/consoleBus';
import { CPUState } from './core/types';
import { SAMPLES } from './samples/index';
import { Editor } from './components/Editor';
import { RegisterPanel } from './components/RegisterPanel';
import { LedOutputPanel } from './components/LedOutputPanel';
import { IoPortsPanel } from './components/IoPortsPanel';
import { Controls } from './components/Controls';
import { HelpModal } from './components/HelpModal';
import { CpuDetailsPage } from './components/CpuDetailsPage';

// ─── Emulator state ───────────────────────────────────────────────────────────

type EmulatorStatus = 'idle' | 'ready' | 'running' | 'paused' | 'halted' | 'error';

type AppView = 'editor' | 'cpu';

// ─── Pending keyboard-input mode ──────────────────────────────────────────────
// Which kind of keyboard input the instruction at IP expects, if any.
// INT 21h AH=01h/08h (and INT 16h AH=00h) want a single character;
// INT 21h AH=0Ah wants a full string, capped by the DOS max-length byte
// at DS:DX. Returns null when IP isn't on a blocking input instruction.
type PendingInputMode = { kind: 'char' } | { kind: 'line'; max: number } | null;

function pendingInputMode(cpu: CPU, instrMap: Map<number, AssembledInstruction>): PendingInputMode {
  const ai = instrMap.get(cpu.getState().IP);
  if (!ai || ai.instruction.mnemonic.toUpperCase() !== 'INT') return null;
  const vecOp = ai.instruction.operands[0];
  const vector = vecOp?.type === 'immediate' ? (vecOp.value ?? -1) & 0xff : -1;
  const ah = cpu.readRegister8('AH');
  if (vector === 0x21 && ah === 0x0a) {
    const ds = cpu.readRegister16('DS');
    const dx = cpu.readRegister16('DX');
    return { kind: 'line', max: cpu.readPhysical8(((ds << 4) + dx) & 0xfffff) };
  }
  if ((vector === 0x21 && (ah === 0x01 || ah === 0x08)) || (vector === 0x16 && ah === 0x00)) {
    return { kind: 'char' };
  }
  return null;
}

function waitingMessageFor(cpu: CPU, instrMap: Map<number, AssembledInstruction>): string {
  const mode = pendingInputMode(cpu, instrMap);
  if (mode?.kind === 'line') {
    return `Waiting for string input (max ${mode.max} chars) — type in the Console window, then press Enter.`;
  }
  return 'Waiting for keyboard input — press any key in the Console window.';
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [code, setCode] = useState(SAMPLES[0].code);
  const [status, setStatus] = useState<EmulatorStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [cpuState, setCpuState] = useState<CPUState | null>(null);
  const [prevState, setPrevState] = useState<CPUState | null>(null);
  const [assembled, setAssembled] = useState<AssembledInstruction[]>([]);
  const [currentLine, setCurrentLine] = useState<number | null>(null);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());
  const [output, setOutput] = useState('');
  const [speed, setSpeed] = useState(10); // instructions per second
  const [memBase, setMemBase] = useState(0x10000); // default to DS 0x1000
  const [port1Value, setPort1Value] = useState<number>(0);
  const [port2LedValue, setPort2LedValue] = useState<number>(0);
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);
  // Instructions executed since last assemble (debugger-style counter).
  const [stepCount, setStepCount] = useState<number>(0);
  // Current file name shown in the editor header; tracks open/save/sample.
  const [fileName, setFileName] = useState<string>('program.asm');
  // Transient "Copied" feedback for the console Copy button.
  const [copied, setCopied] = useState<boolean>(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Hover hint shown in the status bar (set by toolbar/sidebar buttons).
  const [hint, setHint] = useState<string | null>(null);
  // In-app navigation: the emulator CPU lives above the view switch, so
  // navigating between Editor and CPU Details never resets running state.
  const [view, setView] = useState<AppView>('editor');

  // CPU instance — persisted across renders
  const cpuRef = useRef<CPU | null>(null);
  const runTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assembledRef = useRef<AssembledInstruction[]>([]);
  const statusRef = useRef<EmulatorStatus>('idle');
  const port1ValueRef = useRef<number>(0);
  // Latest console text (source of truth; the external console window is a
  // pure view that re-syncs from here on open). A ref is needed because the
  // interrupt handler fires outside React render cycles.
   const outputRef = useRef<string>('');
  // Keystroke queue feeding INT 21h / INT 16h reads. Owned by a ref (not
  // state): the run-loop timer and the interrupt handler consume it outside
  // React render cycles, and queue edits must apply synchronously.
  const queueRef = useRef(createKeyboardQueue());
   const runLoopActiveRef = useRef(false);
   // Live values for the run loop. The loop itself stays referentially stable
   // so changing speed/breakpoints mid-run never spawns a second timer chain
   // (a previous source of duplicated INT 21h output like "0112233...").
   const speedRef = useRef(speed);
   const breakpointsRef = useRef<Set<number>>(breakpoints);
   // Last auto-open check (ms). Throttled so a fast run loop doesn't hammer
  // the backend with an openness check on every output character.
  const consoleLastTryRef = useRef<number>(0);

   statusRef.current = status;
   assembledRef.current = assembled;
   port1ValueRef.current = port1Value;
   speedRef.current = speed;
   breakpointsRef.current = breakpoints;

  // Map from byte-address -> AssembledInstruction for O(1) lookup
  const instrMapRef = useRef<Map<number, AssembledInstruction>>(new Map());
  // Map from byte-address -> source line for O(1) breakpoint/current-line lookup
  const lineMapRef = useRef<Map<number, number>>(new Map());
  // How a paused input-wait started: 'run' when the continuous run loop
  // parked on a blocking read (fresh console input resumes the run), null
  // otherwise (a manual stepper gets exactly one auto-step for the read).
  const resumeAfterInputRef = useRef<'run' | null>(null);
  // Latest handleStep for the console-input bus callback below. The bus
  // subscription stays mounted once (cancellation-safe); the ref keeps it
  // calling the current step closure.
  const handleStepRef = useRef<() => void>(() => {});

  // ── Core step function ──
  const programStep = useCallback((cpu: CPU): import('./core/types').Instruction | null => {
    if (cpu.getState().halted) return null;
    const ip = cpu.getState().IP;
    const ai = instrMapRef.current.get(ip);
    if (!ai) return null;

    const ipBefore = ip;
    cpu.execute(ai.instruction);
    const ipAfter = cpu.getState().IP;

    if (ipAfter === ipBefore) {
      cpu.writeRegister('IP', (ipBefore + ai.instruction.bytes.length) & 0xffff);
    }

    return ai.instruction;
  }, []);

  // ── External console window ──
  // Console text is broadcast via the event bus (Tauri emit/listen, or
  // BroadcastChannel in a plain browser) to a separate OS window. The main
  // window keeps the source of truth; the console window only displays it.
  // The console opens on demand: automatically when program output arrives
  // and the window isn't already open, or anytime via the "Open Console"
  // launcher. Quiet: failures (e.g. a browser popup blocker) stay silent
  // here — the launcher button remains for manual opening without affecting
  // the emulator.
  const ensureConsoleForOutput = useCallback(() => {
    const now = Date.now();
    if (now - consoleLastTryRef.current < 2000) return;
    consoleLastTryRef.current = now;
    void (async () => {
      try {
        // Real check — never assume. An already-open window is left alone
        // (no focus stealing); a missing one is opened and synced.
        if (await isConsoleWindowOpen()) return;
        const res = await openConsoleWindow();
        if (res.opened) {
          consoleBroadcast({ type: 'sync', full: outputRef.current });
        }
      } catch {
        // Quiet: manual launcher reports failures to the user.
      }
    })();
  }, []);

  const handleOpenConsole = useCallback(() => {
    void openConsoleWindow().then(res => {
      if (res.opened) {
        consoleBroadcast({ type: 'sync', full: outputRef.current });
      } else if (isTauri()) {
        setErrorMsg('Could not open the Console window (Tauri error) — try relaunching the app.');
      } else {
        setErrorMsg('Console popup was blocked — allow popups for this site, then click Open Console again.');
      }
    });
  }, []);

  // ── Blocking-input check ──
  // True when the next instruction is a blocking keyboard read (INT 21h
  // AH=01h/08h/0Ah, INT 16h AH=00h) and no keystroke is queued. Executing it
  // now would consume "null" (AL=0) and the program would miss the user's
  // keystroke, so Step pauses here and Run auto-pauses instead.
  // (Defined early: the console-input bus subscription below depends on it.)
  const isWaitingForInput = useCallback((cpu: CPU): boolean => {
    if (queueRef.current.length > 0) return false;
    const ai = instrMapRef.current.get(cpu.getState().IP);
    if (!ai || ai.instruction.mnemonic.toUpperCase() !== 'INT') return false;
    const vecOp = ai.instruction.operands[0];
    const vector = vecOp?.type === 'immediate' ? (vecOp.value ?? -1) & 0xff : -1;
    const ah = cpu.readRegister8('AH');
    if (vector === 0x21) return ah === 0x01 || ah === 0x08 || ah === 0x0a;
    if (vector === 0x16) return ah === 0x00;
    return false;
  }, []);

  // ── Input-mode announcements (main → console window) ──
  // Tells the console whether the CPU is parked on a blocking keyboard read
  // so it can show the blinking cursor and accept keystrokes. Re-sent
  // whenever the debugger state settles (see the [status, cpuState] effect
  // below) and on demand when a console window asks. Repeat announcements
  // of an unchanged mode are skipped (the console already shows it) unless
  // forced — e.g. a freshly opened console polling the current state.
  const lastModeKeyRef = useRef<string>('');
  const broadcastInputMode = useCallback((force = false) => {
    const cpu = cpuRef.current;
    const st = statusRef.current;
    const m = cpu && (st === 'ready' || st === 'paused' || st === 'running')
      ? pendingInputMode(cpu, instrMapRef.current)
      : null;
    const key = !m ? 'null' : m.kind === 'char' ? 'char' : `line:${m.max}`;
    if (!force && key === lastModeKeyRef.current) return;
    lastModeKeyRef.current = key;
    if (!m) consoleBroadcast({ type: 'input-mode', mode: null });
    else if (m.kind === 'char') consoleBroadcast({ type: 'input-mode', mode: 'char' });
    else consoleBroadcast({ type: 'input-mode', mode: 'line', max: m.max });
  }, []);

  // Answer full-state sync requests from (re)opened console windows.
  // Also receives keystrokes typed directly into the console window
  // ('input-data') and input-mode polls from newly opened consoles.
  // `seenInputIds` drops the dual-transport duplicate of each keystroke
  // (Tauri event + BroadcastChannel carry the same stamped id).
  const seenInputIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const unsubscribe = subscribeConsoleMessages(msg => {
      if (msg.type === 'request-sync') {
        consoleBroadcast({ type: 'sync', full: outputRef.current });
        broadcastInputMode(true);
      } else if (msg.type === 'request-input-mode') {
        broadcastInputMode(true);
      } else if (msg.type === 'input-data') {
        if (msg.id) {
          if (seenInputIdsRef.current.has(msg.id)) return;
          seenInputIdsRef.current.add(msg.id);
          if (seenInputIdsRef.current.size > 200) {
            seenInputIdsRef.current = new Set([...seenInputIdsRef.current].slice(-100));
          }
        }
        const cpu = cpuRef.current;
        // Was the CPU parked on a blocking read with nothing queued? If so
        // this text satisfies it — queue first, then resume below.
        const wasWaiting = cpu ? isWaitingForInput(cpu) : false;
        if (msg.text) queueRef.current.push(msg.text);
        broadcastInputMode();
        if (wasWaiting && msg.text && statusRef.current === 'paused') {
          if (resumeAfterInputRef.current === 'run') {
            // Wait began during a continuous run — resume it; the run loop
            // restarts through the existing single-flight status effect.
            resumeAfterInputRef.current = null;
            setErrorMsg('');
            setStatus('running');
          } else {
            // Manual stepping — satisfy just the blocked read with one step
            // so the typed character echoes immediately without running away.
            resumeAfterInputRef.current = null;
            handleStepRef.current();
          }
        }
      }
      // This window owns the source of truth; append/sync/clear/input-mode
      // messages are meant for console windows and are deliberately ignored.
    });
    return unsubscribe;
  }, [broadcastInputMode, isWaitingForInput]);

  // ── Output handler (INT 21h writes land here) ──
  const appendOutput = useCallback((ch: string) => {
    outputRef.current += ch;
    setOutput(outputRef.current);
    consoleBroadcast({ type: 'append', chunk: ch });
    legacyPopupWrite(outputRef.current);
    // Open the console on program output if it isn't already open — this
    // covers first output, and re-opening after the user closed the window.
    ensureConsoleForOutput();
  }, [ensureConsoleForOutput]);

  // ── Assemble ──
  const handleAssemble = useCallback(() => {
    // Stop any in-flight run loop before replacing the CPU, otherwise the
    // old timer chain would keep stepping the discarded instance.
    if (runTimerRef.current) {
      clearTimeout(runTimerRef.current);
      runTimerRef.current = null;
    }
    runLoopActiveRef.current = false;
    setErrorMsg('');
    setOutput('');
    outputRef.current = '';
    consoleBroadcast({ type: 'clear' });
    // Fresh program => fresh keyboard queue (stale keystrokes from a
    // previous run must not leak into the next INT 21h read).
    queueRef.current.clear();
    resumeAfterInputRef.current = null;

    const result = assemble(code);
    if (result.errors.length > 0) {
      const err = result.errors[0];
      setErrorMsg(`Line ${err.line}: ${err.message}`);
      setStatus('error');
      return;
    }

    // Create new CPU and wire up interrupt handler
    const cpu = new CPU();
    // Keyboard input comes from the shared queue (fed by keystrokes typed
    // into the console window): non-destructive peek for status checks
    // (INT 21h AH=0Bh, INT 16h AH=01h), single-char reads, and buffered
    // AH=0Ah line reads that swallow the Enter terminator.
    const queue = queueRef.current;
    const io = {
      writeChar: appendOutput,
      peekChar: () => queue.peekChar(),
      readChar: () => queue.readChar(),
      readLine: (maxChars: number) => queue.readLine(maxChars),
    };
    cpu.interruptHandler = createInterruptHandler(io);

    // Port I/O handlers
    cpu.onPortIn = (port: number) => {
      if (port === 1) return port1ValueRef.current;
      return 0;
    };
    cpu.onPortOut = (port: number, val: number) => {
      if (port === 2) {
        setPort2LedValue(val & 0xff);
      }
    };

    // Load instructions into CPU memory at CS:IP = 0:0
    for (const ai of result.instructions) {
      for (let i = 0; i < ai.instruction.bytes.length; i++) {
        cpu.writePhysical8(ai.address + i, ai.instruction.bytes[i]);
      }
    }

    // Detect segmented vs flat .COM style program
    const isSegmented = /(\.MODEL|PROC|SEGMENT|\.DATA|\.CODE|\.STACK)/i.test(code);
    const dsVal = isSegmented ? (result.dataBytes.length > 0 ? result.dataSegmentParagraph : 0x1000) : 0x0000;

    // Load data segment bytes (from DB/DW directives) into memory
    if (result.dataBytes.length > 0) {
      const dataPhysBase = result.dataSegmentParagraph << 4;
      for (let i = 0; i < result.dataBytes.length; i++) {
        cpu.writePhysical8(dataPhysBase + i, result.dataBytes[i]);
      }
    }

    cpu.writeRegister('CS', 0x0000);
    cpu.writeRegister('IP', result.entryAddress);
    cpu.writeRegister('DS', dsVal);
    cpu.writeRegister('ES', dsVal);
    cpu.writeRegister('SS', 0x2000);
    cpu.writeRegister('SP', 0x0100);

    const initialMemBase = isSegmented
      ? ((dsVal << 4) & 0xfffff)
      : (result.entryAddress & 0xffff0);
    setMemBase(initialMemBase);

    cpuRef.current = cpu;
    const map = new Map<number, AssembledInstruction>();
    const lmap = new Map<number, number>();
    for (const ai of result.instructions) {
      map.set(ai.address, ai);
      lmap.set(ai.address, ai.sourceLine);
    }
    instrMapRef.current = map;
    lineMapRef.current = lmap;
    setAssembled(result.instructions);
    setCpuState(cpu.getState() as CPUState);
    setPrevState(null);
    setCurrentLine(null);
    setStepCount(0);
    setStatus('ready');
  }, [code, appendOutput]);

  // ── Find current line from IP (O(1) map, linear fallback) ──
  const findCurrentLine = useCallback((ip: number): number | null => {
    const hit = lineMapRef.current.get(ip);
    if (hit !== undefined) return hit;
    const instructions = assembledRef.current;
    if (!instructions.length) return null;
    for (const ai of instructions) {
      if (ai.address === ip) return ai.sourceLine;
    }
    return null;
  }, []);

  // ── Step one instruction ──
  const handleStep = useCallback(() => {
    const cpu = cpuRef.current;
    if (!cpu) { handleAssemble(); return; }
    if (cpu.getState().halted) { setStatus('halted'); return; }
    if (isWaitingForInput(cpu)) {
      setErrorMsg(waitingMessageFor(cpu, instrMapRef.current));
      setStatus('paused');
      // A manual step waits here (not a run) — later console input earns a
      // single auto-step, not a resumed run. Make sure the console is open
      // so there is somewhere to type.
      resumeAfterInputRef.current = null;
      ensureConsoleForOutput();
      return;
    }

    try {
      const before = cpu.getState() as CPUState;
      setPrevState(before);
      const instr = programStep(cpu);
      const after = cpu.getState() as CPUState;
      setCpuState({ ...after });
      setStepCount(c => c + 1);
      setCurrentLine(findCurrentLine(after.IP));
      setErrorMsg('');
      if (after.halted || !instr) {
        setStatus('halted');
      } else {
        setStatus('paused');
      }
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, [handleAssemble, findCurrentLine, programStep, isWaitingForInput, ensureConsoleForOutput]);

  // ── Run loop ──
  const stopRun = useCallback(() => {
    if (runTimerRef.current) {
      clearTimeout(runTimerRef.current);
      runTimerRef.current = null;
    }
    runLoopActiveRef.current = false;
  }, []);

  const runLoop = useCallback(() => {
    const cpu = cpuRef.current;
    if (!cpu || statusRef.current !== 'running') {
      runLoopActiveRef.current = false;
      return;
    }

    try {
      setErrorMsg('');
      // Batch several instructions per timer tick at high speeds so long
      // loops finish promptly with a single render per tick. Slow speeds
      // keep one instruction per tick for visible single-stepping.
      // Halt/breakpoint/output behavior is still checked per instruction,
      // so batching changes only render frequency, not semantics.
      // NOTE: speed/breakpoints are read via refs so the loop stays
      // referentially stable — changing them mid-run must not start a
      // second concurrent chain (which duplicated INT 21h output).
      const liveSpeed = speedRef.current;
      const liveBreakpoints = breakpointsRef.current;
      const batch = liveSpeed >= 1000 ? 64 : liveSpeed >= 100 ? 8 : 1;
      let prev = cpu.getState() as CPUState;
      let after = prev;
      let executed = 0;
      let stopped: 'halted' | 'breakpoint' | 'input' | null = after.halted ? 'halted' : null;
      for (let i = 0; i < batch && !stopped; i++) {
        // Blocking keyboard read with an empty queue: pause (IP unchanged)
        // so the user can type and resume — never consume a null keystroke.
        if (isWaitingForInput(cpu)) {
          stopped = 'input';
          break;
        }
        prev = cpu.getState() as CPUState;
        const instr = programStep(cpu);
        after = cpu.getState() as CPUState;
        executed++;
        if (after.halted || !instr) {
          stopped = 'halted';
        } else {
          const line = findCurrentLine(after.IP);
          if (line !== null && liveBreakpoints.has(line)) stopped = 'breakpoint';
        }
      }
      setPrevState(prev);
      setCpuState({ ...after });
      if (executed > 0) setStepCount(c => c + executed);
      setCurrentLine(findCurrentLine(after.IP));

      if (stopped) {
        if (stopped === 'input') {
          setErrorMsg(waitingMessageFor(cpu, instrMapRef.current));
          setStatus('paused');
          // The wait began during a continuous run — fresh console input
          // resumes it (see the bus subscription). Open the console so
          // there is somewhere to type.
          resumeAfterInputRef.current = 'run';
          ensureConsoleForOutput();
        } else {
          setStatus(stopped === 'halted' ? 'halted' : 'paused');
        }
        runLoopActiveRef.current = false;
        return;
      }

      const delay = Math.max(1, 1000 / liveSpeed);
      runTimerRef.current = setTimeout(runLoop, delay);
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus('error');
      stopRun();
      runLoopActiveRef.current = false;
    }
  }, [findCurrentLine, stopRun, programStep, isWaitingForInput, ensureConsoleForOutput]);

  const handleRun = useCallback(() => {
    if (!cpuRef.current) {
      handleAssemble();
      return;
    }
    setStatus('running');
    setErrorMsg('');
  }, [handleAssemble]);

  const handlePause = useCallback(() => {
    setStatus('paused');
    // Intentional stop — later console input earns a single auto-step
    // rather than resuming a run the user deliberately froze.
    resumeAfterInputRef.current = null;
    stopRun();
  }, [stopRun]);

  const handleReset = useCallback(() => {
    stopRun();
    runLoopActiveRef.current = false;
    cpuRef.current = null;
    instrMapRef.current = new Map();
    lineMapRef.current = new Map();
    setAssembled([]);
    setCpuState(null);
    setPrevState(null);
    setCurrentLine(null);
    setOutput('');
    outputRef.current = '';
    queueRef.current.clear();
    resumeAfterInputRef.current = null;
    consoleBroadcast({ type: 'clear' });
    lastModeKeyRef.current = '';
    broadcastInputMode(true);
    setErrorMsg('');
    setStatus('idle');
    setPort2LedValue(0);
    setStepCount(0);
  }, [stopRun, broadcastInputMode]);


  // ── Announce the keyboard-wait state to the console window whenever the
  // debugger settles, so its cursor tracks stepping/running/halt.
  useEffect(() => {
    broadcastInputMode();
  }, [status, cpuState, broadcastInputMode]);

  const handleClearOutput = useCallback(() => {
    outputRef.current = '';
    setOutput('');
    consoleBroadcast({ type: 'clear' });
  }, []);

  // ── Copy console output to the clipboard ──
  const handleCopyOutput = useCallback(async () => {
    if (!outputRef.current) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(outputRef.current);
      } else {
        // Legacy fallback for contexts without the async clipboard API.
        const ta = document.createElement('textarea');
        ta.value = outputRef.current;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setErrorMsg('Copy failed — clipboard is unavailable in this context.');
    }
  }, []);

  // ── Save current code to a .asm file ──
  // In Tauri this shows the native Finder save sheet (dialog plugin) and
  // writes via the fs plugin; in a browser it falls back to a Blob download.
  const handleSave = useCallback(async () => {
    try {
      setErrorMsg('');
      const result = await saveAsmFile(code, fileName);
      if (result !== null) {
        const base = result.split(/[/\\]/).pop();
        if (base) setFileName(base);
      }
    } catch (e: unknown) {
      setErrorMsg(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [code, fileName]);

  // ── Open a .asm file from disk ──
  const handleOpen = useCallback(async () => {
    try {
      setErrorMsg('');
      const file = await openAsmFile();
      if (!file) return; // user cancelled
      handleReset();
      setFileName(file.name);
      setCode(file.contents);
    } catch (e: unknown) {
      setErrorMsg(`Open failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [handleReset]);

  // Start run loop when status becomes 'running'.
  // Single-flight: only one timer chain may exist at a time. The guard
  // blocks double-starts from StrictMode remounts or stale closures, which
  // previously executed INT 21h twice per instruction ("0112233...").
  useEffect(() => {
    if (status === 'running') {
      if (runLoopActiveRef.current) return;
      runLoopActiveRef.current = true;
      runLoop();
    }
    return () => {
      if (runTimerRef.current) {
        clearTimeout(runTimerRef.current);
        runTimerRef.current = null;
      }
      // Leaving/entering 'running' tears down the previous chain; the
      // setup above restarts it exactly once when still running.
      runLoopActiveRef.current = false;
    };
  }, [status, runLoop, stopRun]);

  // Clear pending timers on unmount so no callback fires after teardown.
  useEffect(() => {
    return () => {
      if (runTimerRef.current) clearTimeout(runTimerRef.current);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // ── Sample loader ──
  const handleSampleChange = useCallback((id: string) => {
    if (!id) return;
    const sample = SAMPLES.find(s => s.id === id);
    if (sample) {
      handleReset();
      setFileName(`${sample.id}.asm`);
      setCode(sample.code);
    }
  }, [handleReset]);

  // ── Breakpoint toggle ──
  const toggleBreakpoint = useCallback((line: number) => {
    setBreakpoints(prev => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  }, []);

  // Keep the bus subscription's step pointer current (updated post-commit,
  // read only from the async console-input callback).
  useEffect(() => {
    handleStepRef.current = handleStep;
  });

  const isRunning = status === 'running';
  const canStep = (status === 'ready' || status === 'paused') && !isRunning;
  const canRun  = (status === 'ready' || status === 'paused') && !isRunning;
  const canPause = isRunning;

  // Which keyboard-input mode the program is waiting for (if any) — read
  // live from the CPU so the input box labels itself correctly after every
  // step. Null when idle, errored, or not parked on an input instruction.
  const inputMode = cpuRef.current && (status === 'ready' || status === 'paused' || status === 'running')
    ? pendingInputMode(cpuRef.current, instrMapRef.current)
    : null;

  const controlsProps = {
    status, canRun, canStep, canPause, errorMsg, speed,
    onAssemble: handleAssemble, onRun: handleRun, onStep: handleStep,
    onPause: handlePause, onReset: handleReset, onSpeedChange: setSpeed,
    onHint: setHint,
  };

  return (
    <div className="app">
      {/* ── Top Toolbar ──────────────────────────────────────────────────── */}
      <header className="app-header">
        <div className="app-logo">
          <span className="logo-chip">8086</span>
          <div>
            <div className="logo-title">Intel 8086 Emulator</div>
          </div>
        </div>

        <div className="header-divider" />

        {/* Status pill */}
        <div className={`header-status ${status}`}>
          <div className="header-status-dot" />
          {status === 'idle' ? 'Not assembled' : status.charAt(0).toUpperCase() + status.slice(1)}
          {cpuState && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', opacity: 0.8, marginLeft: '4px' }}>
              {cpuState.CS.toString(16).toUpperCase().padStart(4,'0')}:
              {cpuState.IP.toString(16).toUpperCase().padStart(4,'0')}
            </span>
          )}
        </div>

        {/* In-app navigation (simple view switch; no router in this project).
            State lives above the switch, so views share one running CPU. */}
        <nav className="header-nav" aria-label="Views">
          <button
            className={`header-nav-btn ${view === 'editor' ? 'active' : ''}`}
            onClick={() => setView('editor')}
            id="nav-editor"
          >
            Editor
          </button>
          <button
            className={`header-nav-btn ${view === 'cpu' ? 'active' : ''}`}
            onClick={() => setView('cpu')}
            id="nav-cpu"
          >
            CPU Details
          </button>
        </nav>

        <div className="header-spacer" />

        {/* Top Right: Sample loader */}
        <div className="header-right-controls">
          <select
            id="sample-select"
            className="sample-select"
            onChange={e => handleSampleChange(e.target.value)}
            defaultValue=""
            title="Load a sample program"
          >
            <option value="" disabled>-- Load Sample --</option>
            {SAMPLES.map(s => (
              <option key={s.id} value={s.id}>{s.name} — {s.description}</option>
            ))}
          </select>
        </div>
      </header>

      {/* ── Main grid ────────────────────────────────────────────────────── */}
      {view === 'cpu' ? (
        <main className="app-main app-main-full">
          <CpuDetailsPage
            cpu={cpuRef.current}
            cpuState={cpuState}
            prevState={prevState}
            memBase={memBase}
            onMemBaseChange={setMemBase}
            onBack={() => setView('editor')}
            {...controlsProps}
          />
        </main>
      ) : (
      <main className="app-main">
        {/* ── Left: Controls + Editor + Status bar ── */}
        <div className="left-panel">
          {/* Controls */}
          <Controls {...controlsProps} />

          {/* Editor */}
          <div className="panel" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="panel-header">
              <span className="panel-title">
                <span className="panel-title-dot" style={{ background: 'var(--accent-cyan)' }} />
                Assembly Editor
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <button
                  className="btn-help-top"
                  onClick={handleOpen}
                  title="Open a .asm file from disk"
                  onMouseEnter={() => setHint('Open — load a .asm source file from disk into the editor.')}
                  onMouseLeave={() => setHint(null)}
                >
                  📂 Open
                </button>
                <button
                  className="btn-help-top"
                  onClick={handleSave}
                  title="Save the editor contents to a .asm file"
                  onMouseEnter={() => setHint('Save — write the editor contents to a .asm file on disk.')}
                  onMouseLeave={() => setHint(null)}
                >
                  💾 Save
                </button>
                <span className="file-name" title={fileName}>
                  📄 {fileName}
                </span>
                <span style={{ fontSize: '10px', color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                  {code.split('\n').length} lines
                </span>
              </span>
            </div>
            <div className="panel-body" style={{ flex: 1 }}>
              <Editor
                code={code}
                onChange={val => { setCode(val); if (status !== 'idle') setStatus('idle'); }}
                currentLine={currentLine}
                breakpoints={breakpoints}
                onToggleBreakpoint={toggleBreakpoint}
                readOnly={isRunning}
              />
            </div>
          </div>

          {/* Status bar (shows the hovered button's hint when present) */}
          <div className="status-bar">
            {hint ? (
              <div className="status-item status-hint">
                <span style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>Hint:</span>
                <span>{hint}</span>
              </div>
            ) : (
            <>
            <div className="status-item">
              <div className={`status-dot ${status}`} />
              <span style={{ textTransform: 'capitalize' }}>
                {status === 'idle' ? 'Not assembled' : status}
              </span>
            </div>
            {cpuState && (
              <>
                <div className="status-item">
                  <span style={{ color: 'var(--text-faint)' }}>CS:IP</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)', fontSize: '10.5px' }}>
                    {cpuState.CS.toString(16).toUpperCase().padStart(4, '0')}:
                    {cpuState.IP.toString(16).toUpperCase().padStart(4, '0')}
                  </span>
                </div>
                <div className="status-item">
                  <span style={{ color: 'var(--text-faint)' }}>Program</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px' }}>
                    {assembled.length} instr
                  </span>
                </div>
                <div className="status-item">
                  <span style={{ color: 'var(--text-faint)' }}>Executed</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px' }}>
                    {stepCount} steps
                  </span>
                </div>
                {currentLine !== null && (
                  <div className="status-item">
                    <span style={{ color: 'var(--text-faint)' }}>Line</span>
                    <span style={{ color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)', fontSize: '10.5px' }}>{currentLine}</span>
                  </div>
                )}
              </>
            )}
            </>
            )}
          </div>
        </div>

        {/* ── Right: registers + I/O + console launcher ── */}
        <div className="right-panel">
          <div className="sidebar-container">
            {/* Registers at the top-right (full CPU Details stay one tab away) */}
            <RegisterPanel cpuState={cpuState} prevState={prevState} />

            {/* LED OUTPUT (PORT 2) */}
            <LedOutputPanel value={port2LedValue} />

            {/* I/O PORTS */}
            <IoPortsPanel port1Value={port1Value} onPort1Change={setPort1Value} />

            {/* Console lives in its own OS window now; launcher + copy/clear here */}
            <div className="sidebar-section console-section">
              <div className="sidebar-section-header output-header">
                <span>CONSOLE OUTPUT</span>
                {output.length > 0 && (
                  <span style={{ display: 'inline-flex', gap: '4px' }}>
                    <button
                      className="clear-btn"
                      onClick={handleCopyOutput}
                      title="Copy console output to the clipboard"
                      onMouseEnter={() => setHint('Copy — copy all console output text to the clipboard.')}
                      onMouseLeave={() => setHint(null)}
                    >
                      {copied ? '✓ Copied' : 'Copy'}
                    </button>
                    <button
                      className="clear-btn"
                      onClick={handleClearOutput}
                      title="Clear console output (main + console window)"
                      onMouseEnter={() => setHint('Clear — erase console output here and in the Console window.')}
                      onMouseLeave={() => setHint(null)}
                    >
                      Clear
                    </button>
                  </span>
                )}
              </div>
              <div className="console-external-note">
                <span>Output appears in a separate Console window.</span>
                <button
                  className="btn btn-ghost"
                  onClick={handleOpenConsole}
                  title="Open (or focus) the external console window"
                  onMouseEnter={() => setHint('Console — open the separate output window. It also opens by itself on the first print.')}
                  onMouseLeave={() => setHint(null)}
                >
                  🖥 {output.length > 0 ? 'Show Console' : 'Open Console'}
                  {output.length > 0 && (
                    <span className="output-count-badge" title={`${output.length} characters of output`}>
                      {output.length > 999 ? '999+' : output.length}
                    </span>
                  )}
                </button>
              </div>
              <div className="input-section">
                <span>Keyboard Input</span>
                <div className="console-external-note">
                  {inputMode?.kind === 'line' ? (
                    <span>⌨ Waiting for {inputMode.max} chars max — click the Console window and type there, then Enter.</span>
                  ) : inputMode?.kind === 'char' ? (
                    <span>⌨ Waiting for a key — click the Console window and press any key.</span>
                  ) : (
                    <span>⌨ Programs read the keyboard from the Console window — click it and type when asked.</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      )}

      {/* ── Bottom-right footer: Help ──────────────────────────────────── */}
      <footer className="app-footer">
        <button
          className="btn-help-top"
          onClick={() => setIsHelpOpen(true)}
          title="Open Reference & Help Guide"
          onMouseEnter={() => setHint('Help — open the instruction reference, port guide and debugger tips.')}
          onMouseLeave={() => setHint(null)}
        >
          ? Help
        </button>
      </footer>

      {/* ── Help Modal ────────────────────────────────────────────────────── */}
      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
    </div>
  );
}
