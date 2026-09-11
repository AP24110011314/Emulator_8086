import React, { useState, useEffect } from 'react';

interface IoPortsPanelProps {
  port1Value: number;
  onPort1Change: (val: number) => void;
}

export function IoPortsPanel({ port1Value, onPort1Change }: IoPortsPanelProps) {
  const [text, setText] = useState(port1Value.toString(16).toUpperCase().padStart(2, '0'));

  useEffect(() => {
    setText(port1Value.toString(16).toUpperCase().padStart(2, '0'));
  }, [port1Value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 2);
    setText(raw);
    const parsed = parseInt(raw, 16);
    if (!isNaN(parsed)) {
      onPort1Change(parsed & 0xff);
    }
  };

  const handleBlur = () => {
    const parsed = parseInt(text, 16);
    if (isNaN(parsed)) {
      setText('00');
      onPort1Change(0);
    } else {
      setText((parsed & 0xff).toString(16).toUpperCase().padStart(2, '0'));
    }
  };

  return (
    <div className="sidebar-section io-section">
      <div className="sidebar-section-header">I/O PORTS</div>
      <div className="io-row">
        <span className="io-label">Input Port 1:</span>
        <input
          type="text"
          className="reg-box io-input"
          value={text}
          onChange={handleChange}
          onBlur={handleBlur}
          maxLength={2}
          title="Input Port 1 byte (hex)"
        />
        <span className="io-hint">hex (00-FF)</span>
      </div>
    </div>
  );
}
