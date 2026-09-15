import React from 'react';
import { CPU } from '../core/cpu';
import { CPUState } from '../core/types';
import { RegisterPanel } from './RegisterPanel';
import { FlagsPanel } from './FlagsPanel';
import { StackPanel } from './StackPanel';
import { MemoryViewer } from './MemoryViewer';
import { Controls } from './Controls';

type EmulatorStatus = 'idle' | 'ready' | 'running' | 'paused' | 'halted' | 'error';

interface CpuDetailsPageProps {
  cpu: CPU | null;
  cpuState: CPUState | null;
  prevState: CPUState | null;
  memBase: number;
  onMemBaseChange: (addr: number) => void;
  // Shared run controls so stepping works from this page too.
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
  onBack: () => void;
}

/**
 * Full CPU state view. Pure view onto the same running CPU owned by App —
 * navigating here and back never resets emulator state. Controls are shared
 * with the editor view so Run/Step/Pause work from either page and both
 * reflect state changes live.
 */
export function CpuDetailsPage(props: CpuDetailsPageProps) {
  const { cpu, cpuState, prevState, memBase, onMemBaseChange, onBack } = props;

  return (
    <div className="cpu-details">
      <div className="cpu-details-toolbar">
        <button className="btn btn-ghost" onClick={onBack} title="Back to the assembly editor" id="btn-back-editor">
          ← Editor
        </button>
        <span className="cpu-details-heading">CPU Details</span>
        <span className="cpu-details-sub">Live view of the running CPU — same state as the editor</span>
      </div>

      <Controls
        status={props.status}
        canRun={props.canRun}
        canStep={props.canStep}
        canPause={props.canPause}
        errorMsg={props.errorMsg}
        speed={props.speed}
        onAssemble={props.onAssemble}
        onRun={props.onRun}
        onStep={props.onStep}
        onPause={props.onPause}
        onReset={props.onReset}
        onSpeedChange={props.onSpeedChange}
        onHint={props.onHint}
      />

      <div className="cpu-details-grid">
        <section className="cpu-details-card" aria-label="Registers">
          <header className="cpu-details-card-header">Registers</header>
          <RegisterPanel cpuState={cpuState} prevState={prevState} bare />
        </section>

        <div className="cpu-details-side">
          <section className="cpu-details-card" aria-label="Flags">
            <header className="cpu-details-card-header">Flags</header>
            <FlagsPanel cpuState={cpuState} prevState={prevState} bare />
          </section>

          <section className="cpu-details-card" aria-label="Stack">
            <header className="cpu-details-card-header">Stack</header>
            <StackPanel cpu={cpu} cpuState={cpuState} initialSP={0x0100} bare />
          </section>
        </div>

        <section className="cpu-details-card cpu-details-memory" aria-label="Memory">
          <header className="cpu-details-card-header">Memory</header>
          <MemoryViewer cpu={cpu} cpuState={cpuState} baseAddress={memBase} onBaseChange={onMemBaseChange} />
        </section>
      </div>
    </div>
  );
}
