import React from 'react';

type EmulatorStatus = 'idle' | 'ready' | 'running' | 'paused' | 'halted' | 'error';

interface ControlsProps {
  status: EmulatorStatus;
  canRun: boolean;
  canStep: boolean;
  canPause: boolean;
  errorMsg: string;
  speed: number;
  onAssemble: () => void;
  onRun: () => void;
  onStep: () => void;
  onPause: () => void;
  onReset: () => void;
  onSpeedChange: (val: number) => void;
  onHint: (msg: string | null) => void;
}

const SPEED_LABELS: Record<number, string> = {
  1: '1 Hz', 5: '5 Hz', 10: '10 Hz', 25: '25 Hz',
  50: '50 Hz', 100: '100 Hz', 500: '500 Hz', 1000: '1 kHz'
};

// One-click speed presets for the chip row.
const SPEED_PRESETS: Array<{ value: number; label: string }> = [
  { value: 1, label: '1 Hz' },
  { value: 10, label: '10 Hz' },
  { value: 100, label: '100 Hz' },
  { value: 1000, label: 'Max' },
];

function speedLabel(val: number): string {
  // Find closest
  const keys = Object.keys(SPEED_LABELS).map(Number);
  const closest = keys.reduce((prev, curr) => Math.abs(curr - val) < Math.abs(prev - val) ? curr : prev);
  return SPEED_LABELS[closest] ?? `${val} Hz`;
}

export function Controls({
  status, canRun, canStep, canPause, errorMsg, speed,
  onAssemble, onRun, onStep, onPause, onReset, onSpeedChange, onHint
}: ControlsProps) {
  const isIdle = status === 'idle' || status === 'error';
  const isRunning = status === 'running';

  return (
    <div className="controls-bar">
      {/* Build group */}
      <div className="controls-group" role="group" aria-label="Build">
        <span className="controls-group-label">Build</span>
        <button
          id="btn-assemble"
          className="btn btn-primary"
          onClick={onAssemble}
          disabled={isRunning}
          title="Assemble the program"
          onMouseEnter={() => onHint('Assemble — translate the editor code into 8086 machine code and load it into memory.')}
          onMouseLeave={() => onHint(null)}
          onFocus={() => onHint('Assemble — translate the editor code into 8086 machine code and load it into memory.')}
          onBlur={() => onHint(null)}
        >
          ⚙ Assemble
        </button>
      </div>

      <div className="controls-sep" />

      {/* Execute group */}
      <div className="controls-group" role="group" aria-label="Execute">
        <span className="controls-group-label">Execute</span>
        <button
          id="btn-run"
          className={`btn btn-success${isRunning ? ' is-live' : ''}`}
          onClick={canRun ? onRun : (isIdle ? () => { onAssemble(); setTimeout(onRun, 100); } : undefined)}
          disabled={!canRun && !isIdle}
          title="Run continuously"
          onMouseEnter={() => onHint('Run — execute continuously at the SPEED rate. Pause anytime to inspect registers.')}
          onMouseLeave={() => onHint(null)}
          onFocus={() => onHint('Run — execute continuously at the SPEED rate. Pause anytime to inspect registers.')}
          onBlur={() => onHint(null)}
        >
          ▶ Run
        </button>

        <button
          id="btn-step"
          className="btn btn-primary"
          onClick={canStep ? onStep : (isIdle ? () => { onAssemble(); setTimeout(onStep, 50); } : undefined)}
          disabled={!canStep && !isIdle}
          title="Execute one instruction"
          onMouseEnter={() => onHint('Step — execute exactly one instruction and watch the registers and flags change.')}
          onMouseLeave={() => onHint(null)}
          onFocus={() => onHint('Step — execute exactly one instruction and watch the registers and flags change.')}
          onBlur={() => onHint(null)}
        >
          ⤵ Step
        </button>

        <button
          id="btn-pause"
          className="btn btn-warning"
          onClick={onPause}
          disabled={!canPause}
          title="Pause execution"
          onMouseEnter={() => onHint('Pause — freeze a running program. Resume with Run or advance manually with Step.')}
          onMouseLeave={() => onHint(null)}
          onFocus={() => onHint('Pause — freeze a running program. Resume with Run or advance manually with Step.')}
          onBlur={() => onHint(null)}
        >
          ⏸ Pause
        </button>

        <button
          id="btn-reset"
          className="btn btn-danger"
          onClick={onReset}
          title="Reset emulator and clear output"
          onMouseEnter={() => onHint('Reset — clear the CPU, memory, console output and step counter. Your code stays.')}
          onMouseLeave={() => onHint(null)}
          onFocus={() => onHint('Reset — clear the CPU, memory, console output and step counter. Your code stays.')}
          onBlur={() => onHint(null)}
        >
          ↺ Reset
        </button>
      </div>

      {/* Error message */}
      {errorMsg && (
        <span className="error-banner" title={errorMsg}>
          ⚠ {errorMsg}
        </span>
      )}

      {/* Speed slider + presets */}
      <div
        className="speed-control"
        onMouseEnter={() => onHint('Speed — how many instructions run per second. Use the chips for quick presets.')}
        onMouseLeave={() => onHint(null)}
      >
        <span className="speed-label">SPEED</span>
        <input
          id="speed-slider"
          type="range"
          className="speed-slider"
          min={1}
          max={1000}
          step={1}
          value={speed}
          onChange={e => onSpeedChange(Number(e.target.value))}
          title={`Speed: ${speedLabel(speed)}`}
        />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--neon-blue)', minWidth: '54px' }}>
          {speedLabel(speed)}
        </span>
        <span className="speed-presets" role="group" aria-label="Speed presets">
          {SPEED_PRESETS.map(p => (
            <button
              key={p.value}
              className={`chip${speed === p.value ? ' active' : ''}`}
              onClick={() => onSpeedChange(p.value)}
              title={`Set speed to ${SPEED_LABELS[p.value]}`}
            >
              {p.label}
            </button>
          ))}
        </span>
      </div>
    </div>
  );
}
