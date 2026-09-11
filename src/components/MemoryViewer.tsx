import React, { useState, useCallback, useEffect } from 'react';
import { CPU } from '../core/cpu';
import { CPUState } from '../core/types';

interface MemoryViewerProps {
  cpu: CPU | null;
  cpuState: CPUState | null;
  baseAddress: number;
  onBaseChange: (addr: number) => void;
}

const BYTES_PER_ROW = 8;
const ROWS = 8;

function isPrintable(b: number): boolean {
  return b >= 0x20 && b < 0x7f;
}

export function MemoryViewer({ cpu, cpuState, baseAddress, onBaseChange }: MemoryViewerProps) {
  const [offsetInput, setOffsetInput] = useState('0000');
  const [selectedSegment, setSelectedSegment] = useState<'DS' | 'CS' | 'SS' | 'ES'>('DS');

  const getSegmentValue = useCallback((seg: 'DS' | 'CS' | 'SS' | 'ES'): number => {
    if (!cpuState) {
      if (seg === 'DS') return 0x0000;
      if (seg === 'SS') return 0x2000;
      return 0x0000;
    }
    return cpuState[seg];
  }, [cpuState]);

  useEffect(() => {
    const segVal = getSegmentValue(selectedSegment);
    const segBase = (segVal << 4) & 0xfffff;
    const offset = Math.max(0, (baseAddress - segBase) & 0xffff);
    setOffsetInput(offset.toString(16).toUpperCase().padStart(4, '0'));
  }, [baseAddress, selectedSegment, getSegmentValue]);

  const handleGo = useCallback(() => {
    const offset = parseInt(offsetInput, 16);
    const validOffset = isNaN(offset) ? 0 : offset & 0xffff;
    const segVal = getSegmentValue(selectedSegment);
    const phys = ((segVal << 4) + validOffset) & 0xfffff;
    onBaseChange(phys);
  }, [offsetInput, selectedSegment, cpuState, onBaseChange]);

  const handleOffsetKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleGo();
    }
  };

  const handleSegmentChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const seg = e.target.value as 'DS' | 'CS' | 'SS' | 'ES';
    setSelectedSegment(seg);
    const offset = parseInt(offsetInput, 16);
    const validOffset = isNaN(offset) ? 0 : offset & 0xffff;
    const segVal = getSegmentValue(seg);
    const phys = ((segVal << 4) + validOffset) & 0xfffff;
    onBaseChange(phys);
  };

  const rows = Array.from({ length: ROWS }, (_, rowIdx) => {
    const rowAddr = (baseAddress + rowIdx * BYTES_PER_ROW) & 0xfffff;
    const bytes: number[] = [];
    for (let col = 0; col < BYTES_PER_ROW; col++) {
      const addr = (rowAddr + col) & 0xfffff;
      bytes.push(cpu ? cpu.readPhysical8(addr) : 0);
    }
    return { rowAddr, bytes };
  });

  return (
    <div className="memory-section">
      {/* Reference GO TO / SEGMENT controls bar */}
      <div className="goto-controls-bar">
        <span className="goto-label">GO TO:</span>
        <input
          type="text"
          className="goto-input"
          value={offsetInput}
          onChange={e => setOffsetInput(e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 4))}
          onKeyDown={handleOffsetKeyDown}
          maxLength={4}
          title="Offset in hex (0000-FFFF)"
        />
        <button className="goto-btn" onClick={handleGo} title="Jump to specified offset in segment">
          Go
        </button>

        <span className="goto-label" style={{ marginLeft: '4px' }}>SEGMENT:</span>
        <select
          className="segment-select"
          value={selectedSegment}
          onChange={handleSegmentChange}
          title="Select active segment"
        >
          <option value="DS">DS (Data)</option>
          <option value="CS">CS (Code)</option>
          <option value="SS">SS (Stack)</option>
          <option value="ES">ES (Extra)</option>
        </select>
      </div>

      {/* Hex Dump */}
      <div className="memory-hex-body">
        {rows.map(({ rowAddr, bytes }) => (
          <div key={rowAddr} className="memory-row">
            <span className="mem-addr">
              {rowAddr.toString(16).toUpperCase().padStart(5, '0')}
            </span>
            <span className="mem-bytes">
              {bytes.map((b, i) => (
                <span
                  key={i}
                  className={`mem-byte ${b !== 0 ? 'active' : ''}`}
                  id={`mem-${(rowAddr + i).toString(16)}`}
                >
                  {b.toString(16).toUpperCase().padStart(2, '0')}
                </span>
              ))}
            </span>
            <span className="mem-ascii">
              {bytes.map((b, i) => (
                <span key={i} className={isPrintable(b) ? 'printable' : 'dot'}>
                  {isPrintable(b) ? String.fromCharCode(b) : '·'}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
