import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CPU } from '../../src/core/cpu';
import { assemble, AssembledInstruction } from '../../src/core/assembler';
import { createInterruptHandler, InterruptIO } from '../../src/core/interrupts';
import { SAMPLES } from '../../src/samples/index';
import {
  applyConsoleMessage,
  EMPTY_CONSOLE_VIEW,
} from '../../src/utils/consoleBus';

/**
 * Regression suite for user-reported issues:
 *  - print 0-9 duplicated as "0112233..." when run in one go
 *  - print A-Z duplicated
 *  - echo program saw no user input
 *  - even/odd check
 *  - largest-number program (AL should be 09H with a proper data definition)
 *
 * All runs use the App.tsx flat-mode harness (DS=0, SS=0x2000, SP=0x0100)
 * so these tests lock the UI execution model, not just the test harness.
 */

interface AppRunOpts {
  input?: string[];
  batch?: number; // mimic App runLoop batching (1 / 8 / 64)
}

function runApp(code: string, opts: AppRunOpts = {}) {
  const result = assemble(code);
  if (result.errors.length > 0) {
    throw new Error(`Assembly failed: ${result.errors[0].message}`);
  }
  const cpu = new CPU();
  let output = '';
  // App-style queue: handleKeyPress splits text into single chars; readChar
  // consumes one char at a time and keeps multi-char remainders queued.
  let queue: string[] = [...(opts.input ?? [])].flatMap(s => s.split(''));
  cpu.interruptHandler = createInterruptHandler({
    writeChar: (c: string) => { output += c; },
    // Mirrors App.tsx: peekChar for non-destructive status checks.
    peekChar: () => {
      const head = queue[0];
      return head && head.length > 0 ? head[0] : null;
    },
    readChar: () => {
      if (queue.length === 0) return null;
      const head = queue[0];
      if (head.length > 1) {
        queue = [head.slice(1), ...queue.slice(1)];
        return head[0];
      }
      const ch = head;
      queue = queue.slice(1);
      return ch;
    },
  });

  for (const ai of result.instructions) {
    for (let i = 0; i < ai.instruction.bytes.length; i++) {
      cpu.writePhysical8(ai.address + i, ai.instruction.bytes[i]);
    }
  }
  const isSegmented = /(\.MODEL|PROC|SEGMENT|\.DATA|\.CODE|\.STACK)/i.test(code);
  const dsVal = isSegmented
    ? (result.dataBytes.length > 0 ? result.dataSegmentParagraph : 0x1000)
    : 0x0000;
  if (result.dataBytes.length > 0) {
    const base = result.dataSegmentParagraph << 4;
    for (let i = 0; i < result.dataBytes.length; i++) {
      cpu.writePhysical8(base + i, result.dataBytes[i]);
    }
  }
  cpu.writeRegister('CS', 0);
  cpu.writeRegister('IP', result.entryAddress);
  cpu.writeRegister('DS', dsVal);
  cpu.writeRegister('ES', dsVal);
  cpu.writeRegister('SS', 0x2000);
  cpu.writeRegister('SP', 0x0100);

  const map = new Map<number, AssembledInstruction>();
  for (const ai of result.instructions) map.set(ai.address, ai);

  const batch = opts.batch ?? 1;
  let steps = 0;
  while (!cpu.getState().halted && steps < 10000) {
    for (let b = 0; b < batch && !cpu.getState().halted; b++) {
      const ip = cpu.getState().IP;
      const ai = map.get(ip);
      if (!ai) break;
      const before = ip;
      cpu.execute(ai.instruction);
      const after = cpu.getState().IP;
      if (after === before) {
        cpu.writeRegister('IP', (before + ai.instruction.bytes.length) & 0xffff);
      }
      steps++;
    }
  }
  return { cpu, output };
}

const PRINT_0_9 = `MOV CX, 10
MOV DL, '0'
PRINT:
    MOV AH, 02H
    INT 21H
    INC DL
    LOOP PRINT
MOV AH, 4CH
INT 21H`;

const PRINT_A_Z = `MOV CX, 26
MOV DL, 'A'
PRINT:
    MOV AH, 02H
    INT 21H
    INC DL
    LOOP PRINT
MOV AH, 4CH
INT 21H`;

const ECHO = `MOV AH, 01H
INT 21H
MOV DL, AL
MOV AH, 02H
INT 21H
MOV AH, 4CH
INT 21H`;

const EVEN_ODD_7 = `MOV AL, 07H
TEST AL, 01H
JZ EVEN
MOV BL, 01H
JMP EXIT
EVEN:
MOV BL, 00H
EXIT:
HLT`;

const EVEN_ODD_8 = `MOV AL, 08H
TEST AL, 01H
JZ EVEN
MOV BL, 01H
JMP EXIT
EVEN:
MOV BL, 00H
EXIT:
HLT`;

const FIND_MAX = `ORG 100h
arr DB 3, 9, 2, 7, 5
MOV CX, 4
MOV SI, OFFSET arr
MOV AL, [SI]
find_max:
    INC SI
    MOV BL, [SI]
    CMP BL, AL
    JLE skip_update
    MOV AL, BL
skip_update:
    LOOP find_max
MOV AH, 4CH
INT 21H`;

describe('User-reported regressions (App harness)', () => {
  it('prints 0-9 exactly once each (no "0112233..." duplication)', () => {
    expect(runApp(PRINT_0_9).output).toBe('0123456789');
  });

  it('prints A-Z exactly once each (no duplication)', () => {
    expect(runApp(PRINT_A_Z).output).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  });

  it('batched run-loop execution matches single-step execution', () => {
    // The App runs batches of 8/64 per tick at high speeds; batching must
    // not change semantics vs stepping one instruction at a time.
    // Compares byte-for-byte console output AND final register state —
    // any future Run-vs-Step divergence fails here.
    const snapshot = (r: { cpu: CPU; output: string }) => {
      const s = r.cpu.getState();
      return {
        output: r.output,
        regs: [s.AX, s.BX, s.CX, s.DX, s.SI, s.DI, s.BP, s.SP, s.CS, s.IP, s.DS, s.ES, s.SS, s.FLAGS],
        halted: s.halted,
      };
    };
    for (const prog of [PRINT_0_9, PRINT_A_Z]) {
      const single = snapshot(runApp(prog, { batch: 1 }));
      const mid = snapshot(runApp(prog, { batch: 8 }));
      const fast = snapshot(runApp(prog, { batch: 64 }));
      expect(mid).toEqual(single);
      expect(fast).toEqual(single);
    }
    expect(runApp(PRINT_0_9, { batch: 64 }).output).toBe('0123456789');
    expect(runApp(PRINT_A_Z, { batch: 64 }).output).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  });

  it('echoes pre-typed user input via INT 21h AH=01h', () => {
    const { cpu, output } = runApp(ECHO, { input: ['K'] });
    // DOS echo ('K') + the program's own AH=02h print ('K').
    expect(output).toBe('KK');
    expect(cpu.readRegister8('AL')).toBe('K'.charCodeAt(0));
  });

  it('consumes multi-char queued input one character at a time', () => {
    // Pasted "Hi" must yield 'H' then 'i', not drop the remainder.
    // First read consumes 'H': DOS echo ('H') + AH=02h print ('H'); the
    // leftover 'i' stays queued for the next read.
    const { output } = runApp(ECHO, { input: ['Hi'] });
    expect(output).toBe('HH');
  });

  it('flags 07H as odd (BL=01H)', () => {
    expect(runApp(EVEN_ODD_7).cpu.readRegister8('BL')).toBe(1);
  });

  it('flags 08H as even (BL=00H)', () => {
    expect(runApp(EVEN_ODD_8).cpu.readRegister8('BL')).toBe(0);
  });

  it('finds the largest number in an array (AL=09H)', () => {
    expect(runApp(FIND_MAX).cpu.readRegister8('AL')).toBe(9);
  });

  it('finds the max with the user-shaped CMP AL,[SI] / JAE loop when data is defined', () => {
    // The pasted program failed only because it defined no data: with DS=0,
    // [SI] read the program's own bytes. With a real DB array it yields 09H.
    const code = `ORG 100h
        MOV CX, 4
        MOV SI, OFFSET arr
        MOV AL, [SI]
        INC SI
NEXT:
        CMP AL, [SI]
        JAE SKIP
        MOV AL, [SI]
SKIP:
        INC SI
        LOOP NEXT
        HLT
arr DB 3, 9, 2, 7, 5`;
    expect(runApp(code).cpu.readRegister8('AL')).toBe(9);
  });

  it('ships a working find_max sample matching its .asm mirror', () => {
    const sample = SAMPLES.find(s => s.id === 'find_max');
    expect(sample).toBeDefined();
    const mirror = readFileSync(join(__dirname, '../../src/samples/find_max.asm'), 'utf8').trim();
    expect(sample!.code.trim()).toBe(mirror);
    expect(runApp(sample!.code).cpu.readRegister8('AL')).toBe(9);
  });

  it('INT 21h AH=0Bh peeks without consuming the keystroke', () => {
    const code = `MOV AH, 0BH
INT 21H
MOV AH, 01H
INT 21H
MOV AH, 4CH
INT 21H`;
    const { cpu } = runApp(code, { input: ['Z'] });
    // Status check saw input ready AND the subsequent read got the same char.
    expect(cpu.readRegister8('AL')).toBe('Z'.charCodeAt(0));
  });

  it('INT 16h AH=01h peeks without consuming the keystroke', () => {
    const code = `MOV AH, 01H
INT 16H
MOV AH, 00H
INT 16H
HLT`;
    const { cpu } = runApp(code, { input: ['Q'] });
    expect(cpu.readRegister8('AL')).toBe('Q'.charCodeAt(0));
    expect(cpu.getFlag('ZF')).toBe(false);
  });

  it('legacy handlers without peekChar keep the old consume-on-status behavior', () => {
    const result = assemble(`MOV AH, 0BH
INT 21H
MOV AH, 4CH
INT 21H`);
    const cpu = new CPU();
    let queue = ['Z'];
    const io: InterruptIO = {
      writeChar: () => {},
      readChar: () => (queue.length > 0 ? queue.shift()! : null),
    };
    cpu.interruptHandler = createInterruptHandler(io);
    for (const ai of result.instructions) {
      for (let i = 0; i < ai.instruction.bytes.length; i++) {
        cpu.writePhysical8(ai.address + i, ai.instruction.bytes[i]);
      }
    }
    cpu.writeRegister('CS', 0);
    cpu.writeRegister('IP', result.entryAddress);
    cpu.writeRegister('DS', 0);
    cpu.writeRegister('SS', 0x2000);
    cpu.writeRegister('SP', 0x0100);
    const map = new Map<number, AssembledInstruction>();
    for (const ai of result.instructions) map.set(ai.address, ai);
    let steps = 0;
    while (!cpu.getState().halted && steps < 100) {
      const ip = cpu.getState().IP;
      const ai = map.get(ip);
      if (!ai) break;
      cpu.execute(ai.instruction);
      if (cpu.getState().IP === ip) {
        cpu.writeRegister('IP', (ip + ai.instruction.bytes.length) & 0xffff);
      }
      steps++;
    }
    expect(cpu.readRegister8('AL')).toBe(0xff);
  });
});

describe('Label arithmetic in operands (OFFSET NAME + 2)', () => {
  // Buffered-input style program: NAME sits at data offset 1 (after PAD),
  // so NAME + 2 must resolve to 3.
  const BUFFER_PROG = (movLine: string) => `.DATA
PAD DB 0AAH
NAME DB 20
     DB ?
     DB 20 DUP('$')
.CODE
${movLine}
HLT`;
  const NAME_BASE = 1;

  function movSrcValue(movLine: string): number {
    const result = assemble(BUFFER_PROG(movLine));
    if (result.errors.length > 0) {
      throw new Error(`Assembly failed: ${result.errors[0].message}`);
    }
    const mov = result.instructions.find(ai => ai.instruction.mnemonic === 'MOV');
    expect(mov).toBeDefined();
    const op = mov!.instruction.operands[1];
    expect(op.type).toBe('immediate');
    return op.value!;
  }

  it('resolves OFFSET NAME + 2 to the label address plus 2', () => {
    expect(movSrcValue('MOV DX, OFFSET NAME + 2')).toBe(NAME_BASE + 2);
  });

  it('accepts all spacing variants around the operator identically', () => {
    for (const line of [
      'MOV DX, OFFSET NAME+2',
      'MOV DX, OFFSET NAME +2',
      'MOV DX, OFFSET NAME+ 2',
      'MOV DX, OFFSET NAME  +  2',
    ]) {
      expect(movSrcValue(line)).toBe(NAME_BASE + 2);
    }
  });

  it('resolves bare label arithmetic without OFFSET', () => {
    expect(movSrcValue('MOV DX, NAME + 2')).toBe(NAME_BASE + 2);
  });

  it('supports subtraction and hex constants', () => {
    expect(movSrcValue('MOV DX, OFFSET NAME - 1')).toBe(NAME_BASE - 1);
    expect(movSrcValue('MOV DX, OFFSET NAME + 02H')).toBe(NAME_BASE + 2);
  });

  it('runs end-to-end: DX holds NAME base + 2 after execution', () => {
    const { cpu } = runApp(BUFFER_PROG('MOV DX, OFFSET NAME + 2'));
    expect(cpu.readRegister16('DX')).toBe(NAME_BASE + 2);
  });

  it('supports label arithmetic in brackets and reads the right byte', () => {
    // Data offset 3 is the first '$' of the buffer's string area.
    const { cpu } = runApp(BUFFER_PROG('MOV AL, [NAME + 2]'));
    expect(cpu.readRegister8('AL')).toBe('$'.charCodeAt(0));
  });

  it('leaves plain-label resolution untouched', () => {
    expect(movSrcValue('MOV DX, OFFSET NAME')).toBe(NAME_BASE);
    expect(movSrcValue('MOV DX, NAME')).toBe(NAME_BASE);
  });

  it('still reports undefined labels (arithmetic or plain)', () => {
    const arith = assemble(BUFFER_PROG('MOV DX, OFFSET NOPE + 2'));
    expect(arith.errors.length).toBeGreaterThan(0);
    expect(arith.errors[0].message).toContain('NOPE');
    const plain = assemble(BUFFER_PROG('MOV DX, NOPE'));
    expect(plain.errors.length).toBeGreaterThan(0);
  });
});

describe('Console transport dedupe', () => {
  it('applies a twice-delivered append exactly once (no "0112233...")', () => {
    let view = EMPTY_CONSOLE_VIEW;
    const stream = [
      { type: 'sync' as const, full: '0', seq: 1 },
      { type: 'append' as const, chunk: '1', seq: 2 },
      // Same messages delivered a second time (dual transports / resubscribe)
      { type: 'sync' as const, full: '0', seq: 1 },
      { type: 'append' as const, chunk: '1', seq: 2 },
      { type: 'append' as const, chunk: '2', seq: 3 },
      { type: 'append' as const, chunk: '2', seq: 3 },
    ];
    for (const msg of stream) view = applyConsoleMessage(view, msg);
    expect(view.text).toBe('012');
  });

  it('ignores stale syncs and orders clear before late appends', () => {
    let view = EMPTY_CONSOLE_VIEW;
    view = applyConsoleMessage(view, { type: 'append', chunk: 'A', seq: 1 });
    view = applyConsoleMessage(view, { type: 'append', chunk: 'B', seq: 2 });
    // Stale re-sync from an earlier snapshot must not wipe newer appends.
    view = applyConsoleMessage(view, { type: 'sync', full: 'A', seq: 1 });
    expect(view.text).toBe('AB');
    view = applyConsoleMessage(view, { type: 'clear', seq: 3 });
    expect(view.text).toBe('');
    // Duplicate of a pre-clear append must not resurrect text.
    view = applyConsoleMessage(view, { type: 'append', chunk: 'B', seq: 2 });
    expect(view.text).toBe('');
    view = applyConsoleMessage(view, { type: 'append', chunk: 'C', seq: 4 });
    expect(view.text).toBe('C');
  });
});
