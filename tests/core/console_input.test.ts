import { describe, expect, it } from 'vitest';
import { CPU } from '../../src/core/cpu';
import { assemble, AssembledInstruction } from '../../src/core/assembler';
import { createInterruptHandler } from '../../src/core/interrupts';
import {
  applyConsoleMessage,
  applyLineEditKey,
  clampLineEditPaste,
  EMPTY_CONSOLE_VIEW,
  eventToMessage,
} from '../../src/utils/consoleBus';
import { createKeyboardQueue } from '../../src/utils/keyboardQueue';
import { SAMPLES } from '../../src/samples/index';

// Local run harness (same execution model as src/App.tsx: assemble, load
// bytes at ai.address + data bytes at dataSegmentParagraph, execute()
// directly with manual IP advance). Segmented setup mirrors App.tsx.
function runProgram(code: string, pushInput: string | null, maxSteps = 10000): { cpu: CPU; output: string } {
  const asmResult = assemble(code);
  if (asmResult.errors.length > 0) {
    throw new Error(`Assembly failed: ${asmResult.errors[0].message}`);
  }
  const cpu = new CPU();
  let output = '';
  const queue = createKeyboardQueue();
  if (pushInput) queue.push(pushInput);
  cpu.interruptHandler = createInterruptHandler({
    writeChar: (c: string) => { output += c; },
    peekChar: () => queue.peekChar(),
    readChar: () => queue.readChar(),
    readLine: (max: number) => queue.readLine(max),
  });

  for (const ai of asmResult.instructions) {
    for (let i = 0; i < ai.instruction.bytes.length; i++) {
      cpu.writePhysical8(ai.address + i, ai.instruction.bytes[i]);
    }
  }
  const isSegmented = /(\.MODEL|PROC|SEGMENT|\.DATA|\.CODE|\.STACK)/i.test(code);
  const dsVal = isSegmented ? asmResult.dataSegmentParagraph : 0;
  if (asmResult.dataBytes.length > 0) {
    const base = asmResult.dataSegmentParagraph << 4;
    for (let i = 0; i < asmResult.dataBytes.length; i++) {
      cpu.writePhysical8(base + i, asmResult.dataBytes[i]);
    }
  }
  cpu.writeRegister('CS', 0);
  cpu.writeRegister('IP', asmResult.entryAddress);
  cpu.writeRegister('DS', dsVal);
  cpu.writeRegister('ES', dsVal);
  cpu.writeRegister('SS', 0x2000);
  cpu.writeRegister('SP', 0x0100);

  const map = new Map<number, AssembledInstruction>();
  for (const ai of asmResult.instructions) map.set(ai.address, ai);

  let steps = 0;
  while (!cpu.getState().halted && steps < maxSteps) {
    const ip = cpu.getState().IP;
    const ai = map.get(ip);
    if (!ai) break;
    cpu.execute(ai.instruction);
    if (cpu.getState().IP === ip) {
      cpu.writeRegister('IP', (ip + ai.instruction.bytes.length) & 0xffff);
    }
    steps++;
  }
  return { cpu, output };
}

describe('console line editing (AH=0Ah draft buffer)', () => {
  it('appends typed characters', () => {
    expect(applyLineEditKey('', 'A', 20)).toEqual({ action: 'append', draft: 'A' });
    expect(applyLineEditKey('Ad', 'a', 20)).toEqual({ action: 'append', draft: 'Ada' });
  });

  it('stops accepting characters at the DOS max-length byte', () => {
    expect(applyLineEditKey('ABCDE', 'F', 5)).toEqual({ action: 'noop', draft: 'ABCDE' });
    expect(applyLineEditKey('', 'x', 0)).toEqual({ action: 'noop', draft: '' });
  });

  it('backspace corrects mistakes, and is a noop on an empty draft', () => {
    expect(applyLineEditKey('Ada', 'Backspace', 20)).toEqual({ action: 'delete', draft: 'Ad' });
    expect(applyLineEditKey('', 'Backspace', 20)).toEqual({ action: 'noop', draft: '' });
  });

  it('Enter submits a non-empty draft and ignores an empty one', () => {
    expect(applyLineEditKey('Ada', 'Enter', 20)).toEqual({ action: 'submit', text: 'Ada' });
    expect(applyLineEditKey('', 'Enter', 20)).toEqual({ action: 'noop', draft: '' });
  });

  it('Enter on an empty draft still submits when max is 0 (unstickable wait)', () => {
    expect(applyLineEditKey('', 'Enter', 0)).toEqual({ action: 'submit', text: '' });
  });

  it('ignores control keys and modified keypresses', () => {
    for (const key of ['Shift', 'ArrowLeft', 'Tab', 'Escape', 'F5', 'Dead']) {
      expect(applyLineEditKey('A', key, 20)).toEqual({ action: 'noop', draft: 'A' });
    }
    expect(applyLineEditKey('A', 'a', 20, true)).toEqual({ action: 'noop', draft: 'A' });
  });
});

describe('console paste clamping', () => {
  it('truncates pasted text to the remaining max-length budget', () => {
    expect(clampLineEditPaste('AB', 'CDEFGH', 5)).toBe('CDE');
    expect(clampLineEditPaste('', 'Hello', 20)).toBe('Hello');
    expect(clampLineEditPaste('ABCDE', 'FG', 5)).toBe('');
  });

  it('folds pasted newlines to spaces (no embedded submits)', () => {
    expect(clampLineEditPaste('', 'a\r\nb', 20)).toBe('a b');
  });
});

describe('keyboard queue (INT 21h / INT 16h stdin)', () => {
  it('peeks without consuming; reads consume one char at a time', () => {
    const q = createKeyboardQueue();
    expect(q.peekChar()).toBeNull();
    expect(q.readChar()).toBeNull();
    q.push('Hi');
    expect(q.length).toBe(2);
    expect(q.peekChar()).toBe('H');
    expect(q.peekChar()).toBe('H');
    expect(q.readChar()).toBe('H');
    expect(q.readChar()).toBe('i');
    expect(q.readChar()).toBeNull();
  });

  it('readLine consumes a console-submitted line with its terminator', () => {
    const q = createKeyboardQueue();
    // Exactly what the console window sends on Enter: draft + '\r'.
    q.push('Ada\r');
    expect(q.readLine(20)).toBe('Ada');
    expect(q.readChar()).toBeNull();
  });

  it('readLine truncates at maxChars like the DOS buffer', () => {
    const q = createKeyboardQueue();
    q.push('HelloWorld\r');
    expect(q.readLine(5)).toBe('Hello');
  });

  it('clear drops everything', () => {
    const q = createKeyboardQueue();
    q.push('abc');
    q.clear();
    expect(q.length).toBe(0);
    expect(q.readLine(10)).toBeNull();
  });
});

describe('console bus input messages', () => {
  it('maps the new Tauri events back to bus messages', () => {
    expect(eventToMessage('emulator-console-input-mode', { mode: 'line', max: 20 })).toEqual({
      type: 'input-mode', mode: 'line', max: 20,
    });
    expect(eventToMessage('emulator-console-input-data', { text: 'Ada\r', id: '7-xyz' })).toEqual({
      type: 'input-data', text: 'Ada\r', id: '7-xyz',
    });
    expect(eventToMessage('emulator-console-request-input-mode', {})).toEqual({
      type: 'request-input-mode',
    });
  });

  it('leaves the text view untouched for input-channel messages', () => {
    let view = EMPTY_CONSOLE_VIEW;
    view = applyConsoleMessage(view, { type: 'append', chunk: 'Hi', seq: 1 });
    view = applyConsoleMessage(view, { type: 'input-mode', mode: 'line', max: 20 });
    view = applyConsoleMessage(view, { type: 'input-data', text: 'Ada\r' });
    view = applyConsoleMessage(view, { type: 'request-input-mode' });
    expect(view.text).toBe('Hi');
  });
});

describe('name_input sample end to end (console-typed buffered string)', () => {
  const sample = SAMPLES.find(s => s.id === 'name_input');
  if (!sample) throw new Error('name_input sample missing');

  it('assembles cleanly', () => {
    expect(assemble(sample.code).errors).toEqual([]);
  });

  it('reads the console-submitted line exactly like the old input box did', () => {
    // Manual flow this mirrors: prompt printed, user types "Ada" live in
    // the console (draft preview + cursor), Enter sends "Ada\r" over the
    // bus, the program reads the DOS buffer and greets.
    const { cpu, output } = runProgram(sample.code, 'Ada\r');
    expect(output).toBe('Enter your name: Ada\r\nHello, Ada');

    const dataBase = cpu.readRegister16('DS') << 4;
    // NAMEBUF layout after the 18-byte 'Enter your name: $' prompt:
    // [max=20][actual=3]['A','d','a','$' fill untouched...]
    const buf = dataBase + 'Enter your name: $'.length;
    expect(cpu.readPhysical8(buf)).toBe(20); // max byte
    expect(cpu.readPhysical8(buf + 1)).toBe(3); // actual count
    expect(cpu.readPhysical8(buf + 2)).toBe('A'.charCodeAt(0));
    expect(cpu.readPhysical8(buf + 4)).toBe('a'.charCodeAt(0));
    expect(cpu.readPhysical8(buf + 5)).toBe('$'.charCodeAt(0));
    expect(cpu.getState().halted).toBe(true);
  });
});

describe('AH=01h single-character echo', () => {
  it('echoes the consumed keypress at the cursor like real DOS', () => {
    const code = `
      ORG 100h
      MOV AH, 01h
      INT 21h
      MOV AH, 4Ch
      INT 21h
    `;
    const { cpu, output } = runProgram(code, 'Q');
    expect(cpu.readRegister8('AL')).toBe('Q'.charCodeAt(0));
    expect(output).toBe('Q');
  });
});
