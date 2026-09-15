import React from 'react';
import { CPUState, FLAG_BITS, FlagName } from '../core/types';

interface FlagsPanelProps {
  cpuState: CPUState | null;
  prevState: CPUState | null;
  /** Render content only (no section wrapper/header) when nested in a card that has its own heading. */
  bare?: boolean;
}

interface FlagInfo {
  name: FlagName;
  label: string;
  description: string;
}

// 6 flags in exact order shown in reference screenshot: CF, ZF, SF, OF, PF, AF
const FLAGS_LIST: FlagInfo[] = [
  { name: 'CF', label: 'CF', description: 'Carry Flag — unsigned overflow / borrow' },
  { name: 'ZF', label: 'ZF', description: 'Zero Flag — result was zero' },
  { name: 'SF', label: 'SF', description: 'Sign Flag — result was negative (MSB=1)' },
  { name: 'OF', label: 'OF', description: 'Overflow Flag — signed arithmetic overflow' },
  { name: 'PF', label: 'PF', description: 'Parity Flag — even number of set bits' },
  { name: 'AF', label: 'AF', description: 'Auxiliary Carry — BCD carry bit 3 to 4' },
];

function getFlag(flags: number, name: FlagName): boolean {
  return (flags & (1 << FLAG_BITS[name])) !== 0;
}

export function FlagsPanel({ cpuState, prevState, bare }: FlagsPanelProps) {
  const flags = cpuState ? cpuState.FLAGS : 0;
  const prevFlags = prevState ? prevState.FLAGS : flags;

  return (
    <div className={`sidebar-section flags-section${bare ? ' bare' : ''}`}>
      {!bare && <div className="sidebar-section-header">FLAGS</div>}
      <div className="flags-row">
        {FLAGS_LIST.map(({ name, label, description }) => {
          const isSet = getFlag(flags, name);
          const wasSet = getFlag(prevFlags, name);
          const isChanged = isSet !== wasSet;

          return (
            <div
              key={name}
              id={`flag-${name.toLowerCase()}`}
              className={`flag-tile ${isSet ? 'set' : ''} ${isChanged ? 'changed' : ''}`}
              title={description}
            >
              <div className="flag-tile-name">{label}</div>
              <div className="flag-tile-value">{isSet ? '1' : '0'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
