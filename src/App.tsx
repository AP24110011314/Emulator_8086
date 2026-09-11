import React, { useState, useCallback, useRef, useEffect } from 'react';
import { CPU } from './core/cpu';
import { assemble, AssembledInstruction } from './core/assembler';
import { createInterruptHandler } from './core/interrupts';
import { CPUState } from './core/types';
import { SAMPLES } from './samples/index';
import { Editor } from './components/Editor';
import { RegisterPanel } from './components/RegisterPanel';
import { FlagsPanel } from './components/FlagsPanel';
import { LedOutputPanel } from './components/LedOutputPanel';
import { IoPortsPanel } from './components/IoPortsPanel';
import { StackPanel } from './components/StackPanel';
import { MemoryViewer } from './components/MemoryViewer';
import { Controls } from './components/Controls';
import { OutputPanel } from './components/OutputPanel';
import { HelpModal } from './components/HelpModal';

// ─── Emulator state ───────────────────────────────────────────────────────────

type EmulatorStatus = 'idle' | 'ready' | 'running' | 'paused' | 'halted' | 'error';

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

  // CPU instance — persisted across renders
  const cpuRef = useRef<CPU | null>(null);
  const runTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assembledRef = useRef<AssembledInstruction[]>([]);
  const statusRef = useRef<EmulatorStatus>('idle');
  const port1ValueRef = useRef<number>(0);

  statusRef.current = status;
  assembledRef.current = assembled;
  port1ValueRef.current = port1Value;

  // Map from byte-address -> AssembledInstruction for O(1) lookup
  const instrMapRef = useRef<Map<number, AssembledInstruction>>(new Map());

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

  // ── Output handler ──
  const appendOutput = useCallback((ch: string) => {
    setOutput(prev => prev + ch);
  }, []);

  // ── Assemble ──
  const handleAssemble = useCallback(() => {
    setErrorMsg('');
    setOutput('');

    const result = assemble(code);
    if (result.errors.length > 0) {
      const err = result.errors[0];
      setErrorMsg(`Line ${err.line}: ${err.message}`);
      setStatus('error');
      return;
    }

    // Create new CPU and wire up interrupt handler
    const cpu = new CPU();
    const io = {
      writeChar: appendOutput,
      readChar: () => null
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
    for (const ai of result.instructions) {
      map.set(ai.address, ai);
    }
    instrMapRef.current = map;
    setAssembled(result.instructions);
    setCpuState(cpu.getState() as CPUState);
    setPrevState(null);
    setCurrentLine(null);
    setStatus('ready');
  }, [code, appendOutput]);

  // ── Find current line from IP ──
  const findCurrentLine = useCallback((ip: number): number | null => {
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

    try {
      const before = cpu.getState() as CPUState;
      setPrevState(before);
      const instr = programStep(cpu);
      const after = cpu.getState() as CPUState;
      setCpuState({ ...after });
      setCurrentLine(findCurrentLine(after.IP));
      if (after.halted || !instr) {
        setStatus('halted');
      } else {
        setStatus('paused');
      }
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, [handleAssemble, findCurrentLine, programStep]);

  // ── Run loop ──
  const stopRun = useCallback(() => {
    if (runTimerRef.current) {
      clearTimeout(runTimerRef.current);
      runTimerRef.current = null;
    }
  }, []);

  const runLoop = useCallback(() => {
    const cpu = cpuRef.current;
    if (!cpu || statusRef.current !== 'running') return;
    if (cpu.getState().halted) {
      setStatus('halted');
      setCpuState(cpu.getState() as CPUState);
      return;
    }

    try {
      const before = cpu.getState() as CPUState;
      setPrevState(before);
      const instr = programStep(cpu);
      const after = cpu.getState() as CPUState;
      setCpuState({ ...after });
      setCurrentLine(findCurrentLine(after.IP));

      if (after.halted || !instr) {
        setStatus('halted');
        return;
      }

      // Check breakpoints
      const line = findCurrentLine(after.IP);
      if (line !== null && breakpoints.has(line)) {
        setStatus('paused');
        return;
      }

      const delay = Math.max(1, 1000 / speed);
      runTimerRef.current = setTimeout(runLoop, delay);
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus('error');
      stopRun();
    }
  }, [speed, breakpoints, findCurrentLine, stopRun, programStep]);

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
    stopRun();
  }, [stopRun]);

  const handleReset = useCallback(() => {
    stopRun();
    cpuRef.current = null;
    setAssembled([]);
    setCpuState(null);
    setPrevState(null);
    setCurrentLine(null);
    setOutput('');
    setErrorMsg('');
    setStatus('idle');
    setPort2LedValue(0);
  }, [stopRun]);

  // Start run loop when status becomes 'running'
  useEffect(() => {
    if (status === 'running') {
      runLoop();
    }
    return () => {
      if (status !== 'running') stopRun();
    };
  }, [status, runLoop, stopRun]);

  // ── Sample loader ──
  const handleSampleChange = useCallback((id: string) => {
    if (!id) return;
    const sample = SAMPLES.find(s => s.id === id);
    if (sample) {
      handleReset();
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

  const isRunning = status === 'running';
  const canStep = (status === 'ready' || status === 'paused') && !isRunning;
  const canRun  = (status === 'ready' || status === 'paused') && !isRunning;
  const canPause = isRunning;

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

        <div className="header-spacer" />

        {/* Top Right: Sample loader & ? Help button */}
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

          <button
            className="btn-help-top"
            onClick={() => setIsHelpOpen(true)}
            title="Open Reference & Help Guide"
          >
            ? Help
          </button>
        </div>
      </header>

      {/* ── Main grid ────────────────────────────────────────────────────── */}
      <main className="app-main">
        {/* ── Left: Controls + Editor + Status bar ── */}
        <div className="left-panel">
          {/* Controls */}
          <Controls
            status={status}
            canRun={canRun}
            canStep={canStep}
            canPause={canPause}
            errorMsg={errorMsg}
            speed={speed}
            onAssemble={handleAssemble}
            onRun={handleRun}
            onStep={handleStep}
            onPause={handlePause}
            onReset={handleReset}
            onSpeedChange={setSpeed}
          />

          {/* Editor */}
          <div className="panel" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="panel-header">
              <span className="panel-title">
                <span className="panel-title-dot" style={{ background: 'var(--accent-cyan)' }} />
                Assembly Editor
              </span>
              <span style={{ fontSize: '10px', color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                {code.split('\n').length} lines
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

          {/* Status bar */}
          <div className="status-bar">
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
                {currentLine !== null && (
                  <div className="status-item">
                    <span style={{ color: 'var(--text-faint)' }}>Line</span>
                    <span style={{ color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)', fontSize: '10.5px' }}>{currentLine}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Right: Reference Sidebar Panel ── */}
        <div className="right-panel">
          <div className="sidebar-container">
            {/* 1. REGISTERS */}
            <RegisterPanel cpuState={cpuState} prevState={prevState} />

            {/* 2. FLAGS */}
            <FlagsPanel cpuState={cpuState} prevState={prevState} />

            {/* 3. LED OUTPUT (PORT 2) */}
            <LedOutputPanel value={port2LedValue} />

            {/* 4. I/O PORTS */}
            <IoPortsPanel port1Value={port1Value} onPort1Change={setPort1Value} />

            {/* 5. STACK */}
            <StackPanel cpu={cpuRef.current} cpuState={cpuState} initialSP={0x0100} />

            {/* 6. GO TO: [ 0000 ] [ Go ] SEGMENT: [ DS (Data) v ] + Memory Hex */}
            <MemoryViewer
              cpu={cpuRef.current}
              cpuState={cpuState}
              baseAddress={memBase}
              onBaseChange={setMemBase}
            />

            {/* 7. CONSOLE OUTPUT with Clear Button */}
            <OutputPanel
              output={output}
              isRunning={isRunning}
              onClear={() => setOutput('')}
            />
          </div>
        </div>
      </main>

      {/* ── Help Modal ────────────────────────────────────────────────────── */}
      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
    </div>
  );
}
