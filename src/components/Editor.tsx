import React, { useRef, useEffect, useCallback } from 'react';

interface EditorProps {
  code: string;
  onChange: (val: string) => void;
  currentLine: number | null;
  breakpoints: Set<number>;
  onToggleBreakpoint: (line: number) => void;
  readOnly?: boolean;
}

export function Editor({ code, onChange, currentLine, breakpoints, onToggleBreakpoint, readOnly }: EditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef   = useRef<HTMLDivElement>(null);

  const lines = code.split('\n');
  const lineCount = Math.max(lines.length, 20);

  // Sync gutter scroll with textarea scroll
  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    const gt = gutterRef.current;
    if (ta && gt) {
      gt.scrollTop = ta.scrollTop;
    }
  }, []);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.addEventListener('scroll', syncScroll);
    return () => ta.removeEventListener('scroll', syncScroll);
  }, [syncScroll]);

  // Handle tab key in textarea
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newVal = code.slice(0, start) + '        ' + code.slice(end);
      onChange(newVal);
      // Restore cursor
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 8;
      });
    }
  }, [code, onChange]);

  return (
    <div className="editor-container">
      {/* Gutter */}
      <div className="editor-gutter">
        <div className="gutter-inner" ref={gutterRef} style={{ overflowY: 'hidden' }}>
          {Array.from({ length: lineCount }, (_, i) => {
            const lineNum = i + 1;
            const isCurrent = currentLine === lineNum;
            const hasBreakpoint = breakpoints.has(lineNum);
            return (
              <div
                key={lineNum}
                className={`gutter-line ${isCurrent ? 'current-line' : ''} ${hasBreakpoint ? 'has-breakpoint' : ''}`}
                onClick={() => onToggleBreakpoint(lineNum)}
                title={hasBreakpoint ? 'Remove breakpoint' : 'Add breakpoint'}
                id={`gutter-line-${lineNum}`}
              >
                {lineNum}
              </div>
            );
          })}
        </div>
      </div>

      {/* Textarea */}
      <div className="editor-textarea-wrap">
        <textarea
          ref={textareaRef}
          id="code-editor"
          className="editor-textarea"
          value={code}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          readOnly={readOnly}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          wrap="off"
          rows={lineCount}
          aria-label="Assembly code editor"
          placeholder="; Write 8086 assembly here..."
        />
      </div>
    </div>
  );
}
