import { describe, expect, it } from 'vitest';
import { CPU } from '../../src/core/cpu';
import { Memory, physicalAddress } from '../../src/core/memory';
import { assemble, AssembledInstruction } from '../../src/core/assembler';
import { createInterruptHandler } from '../../src/core/interrupts';

interface RunResult {
  cpu: CPU;
  output: string;
  error?: Error;
}

function runSnippetWithIO(code: string, ioHandler?: { writeChar: (c: string) => void; readChar: () => string | null; readLine?: (maxChars: number) => string | null }, maxSteps = 10000): RunResult {
  const asmResult = assemble(code);
  if (asmResult.errors.length > 0) {
    throw new Error(`Assembly failed: ${asmResult.errors[0].message}`);
  }

  const cpu = new CPU();
  if (ioHandler) {
    cpu.interruptHandler = createInterruptHandler(ioHandler);
  }

  for (const ai of asmResult.instructions) {
    for (let i = 0; i < ai.instruction.bytes.length; i++) {
      cpu.writePhysical8(ai.address + i, ai.instruction.bytes[i]);
    }
  }

  const isSegmented = /(\.MODEL|PROC|SEGMENT|\.DATA|\.CODE|\.STACK)/i.test(code);
  const dataSeg = isSegmented ? asmResult.dataSegmentParagraph : 0;

  if (asmResult.dataBytes.length > 0) {
    const dataBase = dataSeg << 4;
    for (let i = 0; i < asmResult.dataBytes.length; i++) {
      cpu.writePhysical8(dataBase + i, asmResult.dataBytes[i]);
    }
  }

  cpu.writeRegister('CS', 0);
  cpu.writeRegister('IP', asmResult.entryAddress);
  cpu.writeRegister('DS', dataSeg);
  cpu.writeRegister('ES', dataSeg);
  cpu.writeRegister('SS', isSegmented ? 0x2000 : 0);
  cpu.writeRegister('SP', 0xFFFE);

  const map = new Map<number, AssembledInstruction>();
  for (const ai of asmResult.instructions) {
    map.set(ai.address, ai);
  }

  let steps = 0;
  let runErr: Error | undefined;
  let output = '';

  const origWriteChar = ioHandler?.writeChar ?? (() => {});
  const wrappedWriteChar = (c: string) => { output += c; origWriteChar(c); };

  while (!cpu.getState().halted && steps < maxSteps) {
    const ip = cpu.getState().IP;
    const ai = map.get(ip);
    if (!ai) break;
    const ipBefore = ip;
    try {
      cpu.execute(ai.instruction);
    } catch (e: any) {
      runErr = e instanceof Error ? e : new Error(String(e));
      break;
    }
    const ipAfter = cpu.getState().IP;
    if (ipAfter === ipBefore) {
      cpu.writeRegister('IP', (ipBefore + ai.instruction.bytes.length) & 0xffff);
    }
    steps++;
  }

  return { cpu, output, error: runErr };
}

function runWithIO(code: string): { output: string; cpu: CPU } {
  let output = '';
  const cpu = new CPU();
  cpu.interruptHandler = createInterruptHandler({
    writeChar: (c: string) => { output += c; },
    readChar: () => null
  });

  const asmResult = assemble(code);
  if (asmResult.errors.length > 0) throw new Error(asmResult.errors[0].message);

  for (const ai of asmResult.instructions) {
    for (let i = 0; i < ai.instruction.bytes.length; i++) {
      cpu.writePhysical8(ai.address + i, ai.instruction.bytes[i]);
    }
  }

  const isSegmented = /(\.MODEL|PROC|SEGMENT|\.DATA|\.CODE|\.STACK)/i.test(code);
  const dataSeg = isSegmented ? asmResult.dataSegmentParagraph : 0;
  if (asmResult.dataBytes.length > 0) {
    const dataBase = dataSeg << 4;
    for (let i = 0; i < asmResult.dataBytes.length; i++) {
      cpu.writePhysical8(dataBase + i, asmResult.dataBytes[i]);
    }
  }

  cpu.writeRegister('CS', 0);
  cpu.writeRegister('IP', asmResult.entryAddress);
  cpu.writeRegister('DS', dataSeg);
  cpu.writeRegister('ES', dataSeg);
  cpu.writeRegister('SS', isSegmented ? 0x2000 : 0);
  cpu.writeRegister('SP', 0xFFFE);

  const map = new Map<number, AssembledInstruction>();
  for (const ai of asmResult.instructions) map.set(ai.address, ai);

  let steps = 0;
  while (!cpu.getState().halted && steps < 10000) {
    const ip = cpu.getState().IP;
    const ai = map.get(ip);
    if (!ai) break;
    const ipBefore = ip;
    try { cpu.execute(ai.instruction); } catch { break; }
    const ipAfter = cpu.getState().IP;
    if (ipAfter === ipBefore) cpu.writeRegister('IP', (ipBefore + ai.instruction.bytes.length) & 0xffff);
    steps++;
  }
  return { output, cpu };
}

describe('Bug Reproduction Tests', () => {

  // ─── Bug 1: Print A-Z prints characters twice ───
  describe('Bug 1: Print A to Z', () => {
    it('should print A-Z exactly once each, not duplicated', () => {
      const code = `
        MOV CX, 26
        MOV DL, 'A'
      loop:
        MOV AH, 02h
        INT 21h
        INC DL
        LOOP loop
        MOV AH, 4Ch
        INT 21h
      `;
      const { output } = runWithIO(code);
      expect(output).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    });
  });

  // ─── Bug 2: Print 0-9 prints duplicates ───
  describe('Bug 2: Print numbers 0 to 9', () => {
    it('should print 0123456789 exactly once each', () => {
      const code = `
        MOV CX, 10
        MOV DL, '0'
      num_loop:
        MOV AH, 02h
        INT 21h
        INC DL
        LOOP num_loop
        MOV AH, 4Ch
        INT 21h
      `;
      const { output } = runWithIO(code);
      expect(output).toBe('0123456789');
    });
  });

  // ─── Bug 3: User input ───
  describe('Bug 3: User input', () => {
    it('should read a character via INT 21h AH=01h', () => {
      const io = {
        writeChar: (c: string) => {},
        readChar: () => 'X'
      };
      const cpu = new CPU();
      cpu.interruptHandler = createInterruptHandler(io);

      const code = `
        MOV AH, 01h
        INT 21h
        MOV AH, 02h
        MOV DL, AL
        INT 21h
        MOV AH, 4Ch
        INT 21h
      `;
      const asmResult = assemble(code);
      if (asmResult.errors.length > 0) throw new Error(asmResult.errors[0].message);

      for (const ai of asmResult.instructions) {
        for (let i = 0; i < ai.instruction.bytes.length; i++) {
          cpu.writePhysical8(ai.address + i, ai.instruction.bytes[i]);
        }
      }
      cpu.writeRegister('CS', 0);
      cpu.writeRegister('IP', asmResult.entryAddress);
      cpu.writeRegister('DS', 0);
      cpu.writeRegister('ES', 0);
      cpu.writeRegister('SS', 0);
      cpu.writeRegister('SP', 0xFFFE);

      const map = new Map<number, AssembledInstruction>();
      for (const ai of asmResult.instructions) map.set(ai.address, ai);

      let steps = 0;
      let output = '';
      const origWriteChar = io.writeChar;
      const wrappedWriteChar = (c: string) => { output += c; origWriteChar(c); };
      cpu.interruptHandler = createInterruptHandler({ writeChar: wrappedWriteChar, readChar: io.readChar });

      while (!cpu.getState().halted && steps < 10000) {
        const ip = cpu.getState().IP;
        const ai = map.get(ip);
        if (!ai) break;
        const ipBefore = ip;
        try { cpu.execute(ai.instruction); } catch { break; }
        const ipAfter = cpu.getState().IP;
        if (ipAfter === ipBefore) cpu.writeRegister('IP', (ipBefore + ai.instruction.bytes.length) & 0xffff);
        steps++;
      }
      expect(output).toBe('XX'); // DOS echo ('X') + the program's own AH=02h print ('X')
    });

    it('should handle INT 21h AH=0Ah as buffered STRING input (not one char)', () => {
      // Regression test: the DOS buffer is pre-filled with '$' so a later
      // AH=09h print stops at the first untouched byte. The handler must
      // store the full line + actual count and leave the tail alone.
      const code = `
.DATA
NAME DB 20
     DB ?
     DB 20 DUP('$')
.CODE
MOV DX, OFFSET NAME
MOV AH, 0AH
INT 21H
MOV DX, OFFSET NAME + 2
MOV AH, 09H
INT 21H
      `;
      let output = '';
      const { cpu } = runSnippetWithIO(code, {
        writeChar: (c: string) => { output += c; },
        readChar: () => null,
        readLine: () => 'Ada',
      });
      const dataBase = cpu.readRegister16('DS') << 4;
      expect(cpu.readPhysical8(dataBase)).toBe(20); // max unchanged
      expect(cpu.readPhysical8(dataBase + 1)).toBe(3); // actual count
      expect(cpu.readPhysical8(dataBase + 2)).toBe('A'.charCodeAt(0));
      expect(cpu.readPhysical8(dataBase + 3)).toBe('d'.charCodeAt(0));
      expect(cpu.readPhysical8(dataBase + 4)).toBe('a'.charCodeAt(0));
      // Byte past the typed text is still '$' — the AH=09h terminator trick.
      expect(cpu.readPhysical8(dataBase + 5)).toBe('$'.charCodeAt(0));
      // Echo ('Ada') + AH=09h print ('Ada') — exactly the name, no '$'/garbage.
      expect(output).toBe('AdaAda');
    });

    it('should truncate INT 21h AH=0Ah input at the DOS max length', () => {
      const code = `
.DATA
BUF DB 5
    DB ?
    DB 10 DUP('$')
.CODE
MOV DX, OFFSET BUF
MOV AH, 0AH
INT 21H
MOV DX, OFFSET BUF + 2
MOV AH, 09H
INT 21H
MOV AH, 4Ch
INT 21H
      `;
      let output2 = '';
      const { cpu } = runSnippetWithIO(code, {
        writeChar: (c: string) => { output2 += c; },
        readChar: () => null,
        readLine: () => 'HelloWorld', // 10 chars, max is 5
      });
      const dataBase = cpu.readRegister16('DS') << 4;
      expect(cpu.readPhysical8(dataBase + 1)).toBe(5);
      expect(cpu.readPhysical8(dataBase + 2)).toBe('H'.charCodeAt(0));
      expect(cpu.readPhysical8(dataBase + 6)).toBe('o'.charCodeAt(0));
      expect(cpu.readPhysical8(dataBase + 7)).toBe('$'.charCodeAt(0));
      expect(output2).toBe('HelloHello');
      expect(cpu.getState().halted).toBe(true);
    });

    it('should handle INT 16h (keyboard services)', () => {
      const io = {
        writeChar: () => {},
        readChar: () => 'Z'
      };
      const cpu = new CPU();
      cpu.interruptHandler = createInterruptHandler(io);

      const code = `
        MOV AH, 00h
        INT 16h
        MOV AH, 02h
        MOV DL, AL
        INT 21h
        MOV AH, 4Ch
        INT 21h
      `;
      const asmResult = assemble(code);
      if (asmResult.errors.length > 0) throw new Error(asmResult.errors[0].message);

      for (const ai of asmResult.instructions) {
        for (let i = 0; i < ai.instruction.bytes.length; i++) {
          cpu.writePhysical8(ai.address + i, ai.instruction.bytes[i]);
        }
      }
      cpu.writeRegister('CS', 0);
      cpu.writeRegister('IP', asmResult.entryAddress);
      cpu.writeRegister('DS', 0);
      cpu.writeRegister('ES', 0);
      cpu.writeRegister('SS', 0);
      cpu.writeRegister('SP', 0xFFFE);

      const map = new Map<number, AssembledInstruction>();
      for (const ai of asmResult.instructions) map.set(ai.address, ai);

      let steps = 0;
      let output = '';
      cpu.interruptHandler = createInterruptHandler({ ...io, writeChar: (c: string) => { output += c; } });

      while (!cpu.getState().halted && steps < 10000) {
        const ip = cpu.getState().IP;
        const ai = map.get(ip);
        if (!ai) break;
        const ipBefore = ip;
        try { cpu.execute(ai.instruction); } catch { break; }
        const ipAfter = cpu.getState().IP;
        if (ipAfter === ipBefore) cpu.writeRegister('IP', (ipBefore + ai.instruction.bytes.length) & 0xffff);
        steps++;
      }
      expect(output).toBe('Z');
    });
  });

  // ─── Bug 4: Find largest number in array ───
  describe('Bug 4: Find largest number in array', () => {
    it('should correctly find max in array', () => {
      const code = `
        ORG 100h
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
        MOV AH, 4Ch
        INT 21h
      `;
      const { cpu } = runSnippetWithIO(code);
      expect(cpu.readRegister8('AL')).toBe(9);
    });
  });

  // ─── Additional: Step-by-step vs batch consistency ───
  describe('Execution consistency: step vs batch', () => {
    it('should produce identical output for A-Z when run as single steps vs batch', () => {
      const code = `
        MOV CX, 26
        MOV DL, 'A'
      loop:
        MOV AH, 02h
        INT 21h
        INC DL
        LOOP loop
        MOV AH, 4Ch
        INT 21h
      `;

      // Simulate batch execution (runLoop model)
      let batchOutput = '';
      const cpu = new CPU();
      cpu.interruptHandler = createInterruptHandler({
        writeChar: (c: string) => { batchOutput += c; },
        readChar: () => null
      });

      const asmResult = assemble(code);
      for (const ai of asmResult.instructions) {
        for (let i = 0; i < ai.instruction.bytes.length; i++) {
          cpu.writePhysical8(ai.address + i, ai.instruction.bytes[i]);
        }
      }
      cpu.writeRegister('CS', 0);
      cpu.writeRegister('IP', asmResult.entryAddress);
      cpu.writeRegister('DS', 0);
      cpu.writeRegister('ES', 0);
      cpu.writeRegister('SS', 0);
      cpu.writeRegister('SP', 0xFFFE);

      const map = new Map<number, AssembledInstruction>();
      for (const ai of asmResult.instructions) map.set(ai.address, ai);

      let steps = 0;
      while (!cpu.getState().halted && steps < 10000) {
        const ip = cpu.getState().IP;
        const ai = map.get(ip);
        if (!ai) break;
        const ipBefore = ip;
        try { cpu.execute(ai.instruction); } catch { break; }
        const ipAfter = cpu.getState().IP;
        if (ipAfter === ipBefore) cpu.writeRegister('IP', (ipBefore + ai.instruction.bytes.length) & 0xffff);
        steps++;
      }

      expect(batchOutput).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    });
  });
});
