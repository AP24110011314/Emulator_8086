import React from 'react';
import { CPU } from '../core/cpu';
import { CPUState } from '../core/types';

interface StackPanelProps {
  cpu: CPU | null;
  cpuState: CPUState | null;
  initialSP?: number;
  /** Render content only (no section wrapper/header) when nested in a card that has its own heading. */
  bare?: boolean;
}

export function StackPanel({ cpu, cpuState, initialSP = 0x0100, bare }: StackPanelProps) {
  // If no CPU or SP has not decremented below initialSP, stack is empty
  const isEmpty = !cpuState || !cpu || cpuState.SP >= initialSP;

  const stackEntries: { address: number; offset: number; value: number }[] = [];
  if (!isEmpty && cpu && cpuState) {
    const ss = cpuState.SS;
    // Show up to 6 words pushed on stack
    const count = Math.min(8, Math.floor((initialSP - cpuState.SP) / 2));
    for (let i = 0; i < count; i++) {
      const spOffset = (cpuState.SP + i * 2) & 0xffff;
      const phys = ((ss << 4) + spOffset) & 0xfffff;
      const val = cpu.readPhysical16(phys);
      stackEntries.push({ address: phys, offset: spOffset, value: val });
    }
  }

  return (
    <div className={`sidebar-section stack-section${bare ? ' bare' : ''}`}>
      {!bare && <div className="sidebar-section-header">STACK</div>}
      <div className="stack-content">
        {isEmpty ? (
          <div className="stack-empty">Stack is empty</div>
        ) : (
          <div className="stack-list">
            {stackEntries.map((item, idx) => (
              <div key={item.offset} className="stack-item">
                <span className="stack-pointer">{idx === 0 ? '▶ SP' : '   '}</span>
                <span className="stack-offset">
                  {cpuState!.SS.toString(16).toUpperCase().padStart(4, '0')}:
                  {item.offset.toString(16).toUpperCase().padStart(4, '0')}
                </span>
                <span className="reg-box stack-val">
                  {item.value.toString(16).toUpperCase().padStart(4, '0')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
