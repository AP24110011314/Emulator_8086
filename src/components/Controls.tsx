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
}

const SPEED_LABELS: Record<number, string> = {
  1: '1 Hz', 5: '5 Hz', 10: '10 Hz', 25: '25 Hz',
  50: '50 Hz', 100: '100 Hz', 500: '500 Hz', 1000: '1 kHz'
};

function speedLabel(val: number): string {
  // Find closest
  const keys = Object.keys(SPEED_LABELS).map(Number);
  const closest = keys.reduce((prev, curr) => Math.abs(curr - val) < Math.abs(prev - val) ? curr : prev);
  return SPEED_LABELS[closest] ?? `${val} Hz`;
}

export function Controls({
  status, canRun, canStep, canPause, errorMsg, speed,
  onAssemble, onRun, onStep, onPause, onReset, onSpeedChange
}: ControlsProps) {
  const isIdle = status === 'idle' || status === 'error';

  return (
    <div className="controls-bar">
      {/* Assemble button */}
      <button
        id="btn-assemble"
        className="btn btn-primary"
        onClick={onAssemble}
        disabled={status === 'running'}
        data-tooltip="Parse and assemble the code (F5)"
        title="Assemble"
      >
        ⚙ Assemble
      </button>

      <div style={{ width: '1px', height: '20px', background: 'var(--border)', margin: '0 2px' }} />

      {/* Run */}
      <button
        id="btn-run"
        className="btn btn-success"
        onClick={canRun ? onRun : (isIdle ? () => { onAssemble(); setTimeout(onRun, 100); } : undefined)}
        disabled={!canRun && !isIdle}
        title="Run continuously"
      >
        ▶ Run
      </button>

      {/* Step */}
      <button
        id="btn-step"
        className="btn btn-primary"
        onClick={canStep ? onStep : (isIdle ? () => { onAssemble(); setTimeout(onStep, 50); } : undefined)}
        disabled={!canStep && !isIdle}
        title="Execute one instruction"
      >
        ⤵ Step
      </button>

      {/* Pause */}
      <button
        id="btn-pause"
        className="btn btn-warning"
        onClick={onPause}
        disabled={!canPause}
        title="Pause execution"
      >
        ⏸ Pause
      </button>

      {/* Reset */}
      <button
        id="btn-reset"
        className="btn btn-danger"
        onClick={onReset}
        title="Reset emulator and clear output"
      >
        ↺ Reset
      </button>

      {/* Error message */}
      {errorMsg && (
        <span className="error-banner" title={errorMsg}>
          ⚠ {errorMsg}
        </span>
      )}

      {/* Speed slider */}
      <div className="speed-control">
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
      </div>
    </div>
  );
}
