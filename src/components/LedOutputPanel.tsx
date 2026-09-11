import React from 'react';

interface LedOutputPanelProps {
  value: number; // 8-bit integer (0-255)
}

export function LedOutputPanel({ value }: LedOutputPanelProps) {
  const byteVal = value & 0xff;
  const hexVal = byteVal.toString(16).toUpperCase().padStart(2, '0') + 'h';
  const bits = [7, 6, 5, 4, 3, 2, 1, 0];

  return (
    <div className="sidebar-section led-section">
      <div className="sidebar-section-header">LED OUTPUT (PORT 2)</div>
      <div className="led-container">
        <div className="led-row">
          {bits.map(bit => {
            const isOn = (byteVal & (1 << bit)) !== 0;
            return (
              <div
                key={bit}
                className={`led-circle ${isOn ? 'on' : 'off'}`}
                title={`Bit ${bit}: ${isOn ? '1 (HIGH)' : '0 (LOW)'}`}
              >
                {bit}
              </div>
            );
          })}
        </div>
        <div className="led-value-text">
          Value: <span className="led-val-hex">{hexVal}</span> <span className="led-val-dec">({byteVal})</span>
        </div>
      </div>
    </div>
  );
}
