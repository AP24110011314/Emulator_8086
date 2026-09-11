import React, { useRef, useEffect } from 'react';

interface OutputPanelProps {
  output: string;
  isRunning?: boolean;
  onClear?: () => void;
}

export function OutputPanel({ output, isRunning, onClear }: OutputPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new output arrives
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [output]);

  return (
    <div className="output-panel-container">
      <div className="sidebar-section-header output-header">
        <span>CONSOLE OUTPUT</span>
        {output && onClear && (
          <button className="clear-btn" onClick={onClear} title="Clear console output">
            Clear
          </button>
        )}
      </div>
      <div className="output-body" id="output-console">
        {output ? (
          <span className="output-text">{output}</span>
        ) : (
          <span className="output-placeholder">
            Waiting for INT 21h output...
          </span>
        )}
        {isRunning && <span className="output-cursor" />}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
