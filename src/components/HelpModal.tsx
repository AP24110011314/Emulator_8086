import React from 'react';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpModal({ isOpen, onClose }: HelpModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="help-modal" onClick={e => e.stopPropagation()}>
        <div className="help-modal-header">
          <div className="help-modal-title">
            <span className="help-icon-badge">?</span>
            Intel 8086 Emulator — Quick Reference &amp; Guide
          </div>
          <button className="help-close-btn" onClick={onClose} title="Close Help">✕</button>
        </div>

        <div className="help-modal-body">
          <section className="help-section">
            <h3>Registers</h3>
            <div className="help-grid">
              <div><strong>AX (AH/AL)</strong>: Accumulator for arithmetic, logic, and I/O</div>
              <div><strong>BX (BH/BL)</strong>: Base register, general data &amp; address pointer</div>
              <div><strong>CX (CH/CL)</strong>: Count register for loops and shifts</div>
              <div><strong>DX (DH/DL)</strong>: Data register for I/O port address and multiply/divide</div>
              <div><strong>SP / BP</strong>: Stack Pointer &amp; Base Pointer for stack frame operations</div>
              <div><strong>SI / DI</strong>: Source Index &amp; Destination Index for string / indexed moves</div>
              <div><strong>CS / DS / SS / ES</strong>: Segment registers (Code, Data, Stack, Extra)</div>
              <div><strong>IP</strong>: Instruction Pointer (offset in CS)</div>
            </div>
          </section>

          <section className="help-section">
            <h3>Flags</h3>
            <div className="help-flags-grid">
              <div><span className="flag-tag">CF</span> Carry Flag (unsigned overflow/borrow)</div>
              <div><span className="flag-tag">ZF</span> Zero Flag (result is zero)</div>
              <div><span className="flag-tag">SF</span> Sign Flag (MSB is 1 / negative)</div>
              <div><span className="flag-tag">OF</span> Overflow Flag (signed arithmetic overflow)</div>
              <div><span className="flag-tag">PF</span> Parity Flag (even number of 1 bits)</div>
              <div><span className="flag-tag">AF</span> Auxiliary Carry (carry out of bit 3 to 4)</div>
            </div>
          </section>

          <section className="help-section">
            <h3>I/O Ports &amp; LED Output</h3>
            <div className="help-text">
              <p>
                <strong>Port 1 (Input Port)</strong>: Enter a 2-digit hex byte in the <em>Input Port 1</em> box.
                Code can read it using <code>IN AL, 1</code> or <code>IN AL, 01h</code>.
              </p>
              <p style={{ marginTop: '6px' }}>
                <strong>Port 2 (LED Output)</strong>: 8 circular LEDs map directly to bits 7 to 0 of Port 2.
                Writing with <code>OUT 2, AL</code> updates the LEDs and displayed value in real time.
              </p>
            </div>
          </section>

          <section className="help-section">
            <h3>Common Instructions</h3>
            <div className="help-code-grid">
              <div><code>MOV dst, src</code> — Copy src to dst</div>
              <div><code>ADD / SUB dst, src</code> — Add/Subtract</div>
              <div><code>INC / DEC reg</code> — Increment/Decrement</div>
              <div><code>CMP op1, op2</code> — Compare and set flags</div>
              <div><code>JMP / JZ / JNZ label</code> — Jump conditional/unconditional</div>
              <div><code>PUSH / POP reg</code> — Push/Pop word to/from stack</div>
              <div><code>CALL / RET</code> — Procedure call and return</div>
              <div><code>LOOP label</code> — Decrement CX and jump if non-zero</div>
              <div><code>IN AL, port</code> — Read byte from port</div>
              <div><code>OUT port, AL</code> — Write byte to port</div>
              <div><code>INT 21h</code> — DOS interrupt (AH=02h char, AH=09h string)</div>
              <div><code>HLT</code> — Halt processor execution</div>
            </div>
          </section>
        </div>

        <div className="help-modal-footer">
          <button className="btn btn-primary" onClick={onClose}>Got It</button>
        </div>
      </div>
    </div>
  );
}
