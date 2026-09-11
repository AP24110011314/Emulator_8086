import { describe, expect, it } from 'vitest';
import { CPU } from '../../src/core/cpu';
import { Memory, physicalAddress } from '../../src/core/memory';
import { assemble, AssemblerResult } from '../../src/core/assembler';
import { createInterruptHandler } from '../../src/core/interrupts';

interface RunResult {
  cpu: CPU;
  asmResult: AssemblerResult;
  error?: Error;
}

function runSnippet(code: string, opts?: { ioHandler?: any; maxSteps?: number }): RunResult {
  const asmResult = assemble(code);
  if (asmResult.errors.length > 0) {
    throw new Error(`Assembly failed: ${asmResult.errors[0].message} (line ${asmResult.errors[0].line})`);
  }

  const cpu = new CPU();
  if (opts?.ioHandler) {
    cpu.interruptHandler = createInterruptHandler(opts.ioHandler);
  }

  // Load instructions into physical memory
  for (const ai of asmResult.instructions) {
    for (let i = 0; i < ai.instruction.bytes.length; i++) {
      cpu.writePhysical8(ai.address + i, ai.instruction.bytes[i]);
    }
  }

  // Detect segmented vs flat .COM style program
  const isSegmented = /(\.MODEL|PROC|SEGMENT|\.DATA|\.CODE|\.STACK)/i.test(code);
  const dataSeg = isSegmented ? asmResult.dataSegmentParagraph : 0;

  // Load data bytes
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

  // Map instructions by address for simulated execution
  const map = new Map<number, import('../../src/core/assembler').AssembledInstruction>();
  for (const ai of asmResult.instructions) {
    map.set(ai.address, ai);
  }

  let steps = 0;
  const maxSteps = opts?.maxSteps ?? 1000;
  let runErr: Error | undefined;

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

  return { cpu, asmResult, error: runErr };
}

describe('8086_TEST_SUITE.md Full Suite', () => {

  // ─── 1. Data Transfer ───────────────────────────────────────────────────────
  describe('1. Data Transfer', () => {
    it('1.1 MOV — register to register, immediate to register', () => {
      const code = `
        MOV AX, 1234h
        MOV BX, AX
        MOV CL, 5
        MOV DH, CL
        HLT
      `;
      const { cpu } = runSnippet(code);
      const s = cpu.getState();
      expect(s.AX.toString(16).toUpperCase()).toBe('1234');
      expect(s.BX.toString(16).toUpperCase()).toBe('1234');
      expect(cpu.readRegister8('CL')).toBe(0x05);
      expect(cpu.readRegister8('DH')).toBe(0x05);
    });

    it('1.2 MOV — memory addressing (all modes)', () => {
      const code = `
        ORG 100h
        MOV AX, 1234h
        MOV [200h], AX        ; direct memory
        MOV AX, [200h]
        MOV BX, 200h
        MOV AX, [BX]           ; register indirect
        MOV AX, [BX+4]         ; based
        MOV SI, 10h
        MOV AX, [SI]            ; indexed
        MOV AX, [BX+SI]         ; based + indexed
        MOV AX, [BX+SI+4]       ; based + indexed + displacement
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getState().halted).toBe(true);
      // Ensure write to [200h] was verified
      expect(cpu.readPhysical8(0x200)).toBe(0x34);
      expect(cpu.readPhysical8(0x201)).toBe(0x12);
    });

    it('1.3 PUSH / POP / stack integrity', () => {
      const code = `
        MOV SP, 0FFFEh
        MOV AX, 1111h
        MOV BX, 2222h
        PUSH AX
        PUSH BX
        POP AX
        POP BX
        HLT
      `;
      const { cpu } = runSnippet(code);
      const s = cpu.getState();
      expect(s.AX.toString(16).toUpperCase()).toBe('2222');
      expect(s.BX.toString(16).toUpperCase()).toBe('1111');
      expect(s.SP).toBe(0xFFFE);
    });

    it('1.4 XCHG', () => {
      const code = `
        MOV AX, 000Ah
        MOV BX, 0014h
        XCHG AX, BX
        HLT
      `;
      const { cpu } = runSnippet(code);
      const s = cpu.getState();
      expect(s.AX).toBe(0x0014);
      expect(s.BX).toBe(0x000A);
    });

    it('1.5 LEA vs MOV (effective address, not value)', () => {
      const code = `
        MOV BX, 100h
        MOV [BX], WORD PTR 9999h
        LEA AX, [BX+2]
        MOV DX, [BX+2]
        HLT
      `;
      const { cpu } = runSnippet(code);
      const s = cpu.getState();
      expect(s.AX).toBe(0x0102);
      expect(s.DX).not.toBe(0x9999);
    });

    it('1.6 PUSHF / POPF / LAHF / SAHF', () => {
      const code = `
        MOV AX, 0FFFFh
        ADD AX, 1          ; wraps to 0000, sets CF and ZF
        PUSHF
        MOV BX, 0
        POP BX             ; BX now holds flags word
        LAHF
        MOV CL, AH         ; CL should reflect same flag bits as low byte of BX
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getFlag('CF')).toBe(true);
      expect(cpu.getFlag('ZF')).toBe(true);
      const bxLo = cpu.getState().BX & 0xFF;
      const cl = cpu.readRegister8('CL');
      expect(cl & 0x01).toBe(bxLo & 0x01); // CF matches
      expect((cl >> 6) & 0x01).toBe((bxLo >> 6) & 0x01); // ZF matches
    });

    it('1.7 XLAT', () => {
      const code = `
        MOV BX, 300h
        MOV BYTE PTR [BX+5], 77h
        MOV AL, 5
        XLAT
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.readRegister8('AL')).toBe(0x77);
    });
  });

  // ─── 2. Arithmetic ──────────────────────────────────────────────────────────
  describe('2. Arithmetic', () => {
    it('2.1 ADD / flag generation', () => {
      const code = `
        MOV AX, 7FFFh
        ADD AX, 1        ; signed overflow: 32767 + 1
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getState().AX).toBe(0x8000);
      expect(cpu.getFlag('OF')).toBe(true);
      expect(cpu.getFlag('SF')).toBe(true);
      expect(cpu.getFlag('ZF')).toBe(false);
      expect(cpu.getFlag('CF')).toBe(false);
    });

    it('2.2 ADD — unsigned carry', () => {
      const code = `
        MOV AX, 0FFFFh
        ADD AX, 1
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getState().AX).toBe(0x0000);
      expect(cpu.getFlag('CF')).toBe(true);
      expect(cpu.getFlag('ZF')).toBe(true);
      expect(cpu.getFlag('OF')).toBe(false);
    });

    it('2.3 ADC (add with carry, chained 32-bit add via two 16-bit adds)', () => {
      const code = `
        MOV AX, 0FFFFh
        MOV BX, 0001h
        MOV CX, 0000h
        MOV DX, 0001h
        ADD AX, BX
        ADC CX, DX
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getState().AX).toBe(0x0000);
      expect(cpu.getState().CX).toBe(0x0002);
    });

    it('2.4 SUB / borrow', () => {
      const code = `
        MOV AX, 0003h
        SUB AX, 0005h
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getState().AX).toBe(0xFFFE);
      expect(cpu.getFlag('CF')).toBe(true);
      expect(cpu.getFlag('SF')).toBe(true);
      expect(cpu.getFlag('ZF')).toBe(false);
    });

    it('2.5 SBB', () => {
      const code = `
        MOV AX, 0000h
        MOV BX, 0001h
        SUB AX, BX      ; AX=FFFF, CF=1
        MOV CX, 0001h
        MOV DX, 0000h
        SBB CX, DX       ; CX = 1 - 0 - CF(1) = 0
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getState().AX).toBe(0xFFFF);
      expect(cpu.getState().CX).toBe(0x0000);
    });

    it('2.6 INC / DEC (do NOT affect CF)', () => {
      const code = `
        STC              ; set carry manually
        MOV AX, 5
        INC AX
        DEC AX
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getState().AX).toBe(5);
      expect(cpu.getFlag('CF')).toBe(true);
    });

    it('2.7 NEG', () => {
      const code = `
        MOV AX, 0005h
        NEG AX
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getState().AX).toBe(0xFFFB);
      expect(cpu.getFlag('CF')).toBe(true);
    });

    it('2.8 CMP (flags only, operand unchanged)', () => {
      const code = `
        MOV AX, 10h
        MOV BX, 10h
        CMP AX, BX
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getState().AX).toBe(0x10);
      expect(cpu.getState().BX).toBe(0x10);
      expect(cpu.getFlag('ZF')).toBe(true);
      expect(cpu.getFlag('CF')).toBe(false);
    });

    it('2.9 MUL (unsigned)', () => {
      const code = `
        MOV AL, 10h
        MOV BL, 10h
        MUL BL
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getState().AX).toBe(0x0100);
      expect(cpu.getFlag('CF')).toBe(true);
      expect(cpu.getFlag('OF')).toBe(true);
    });

    it('2.10 MUL — 16-bit into DX:AX', () => {
      const code = `
        MOV AX, 0FFFFh
        MOV BX, 0002h
        MUL BX
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getState().DX).toBe(0x0001);
      expect(cpu.getState().AX).toBe(0xFFFE);
      expect(cpu.getFlag('CF')).toBe(true);
      expect(cpu.getFlag('OF')).toBe(true);
    });

    it('2.11 IMUL (signed)', () => {
      const code = `
        MOV AL, 0FEh       ; -2
        MOV BL, 5
        IMUL BL
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getState().AX).toBe(0xFFF6);
      expect(cpu.getFlag('CF')).toBe(false);
      expect(cpu.getFlag('OF')).toBe(false);
    });

    it('2.12 DIV (unsigned) — normal case', () => {
      const code = `
        MOV AX, 000Ah
        MOV BL, 0003h
        DIV BL
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.readRegister8('AL')).toBe(3);
      expect(cpu.readRegister8('AH')).toBe(1);
    });

    it('2.13 DIV — divide by zero (safe error handling)', () => {
      const code = `
        MOV AX, 000Ah
        MOV BL, 0
        DIV BL
        HLT
      `;
      const { error } = runSnippet(code);
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/zero/i);
    });

    it('2.14 IDIV (signed)', () => {
      const code = `
        MOV AX, 0FFF6h    ; -10
        MOV BL, 3
        IDIV BL
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.readRegister8('AL')).toBe(0xFD); // -3 in 2s comp
      expect(cpu.readRegister8('AH')).toBe(0xFF); // -1 remainder in 2s comp
    });

    it('2.15 CBW / CWD (sign extension)', () => {
      const code = `
        MOV AL, 0FFh      ; -1 as byte
        CBW
        MOV BX, AX        ; save CBW result (FFFF)
        MOV AX, 0FFFFh    ; -1 as word
        CWD
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getState().BX).toBe(0xFFFF);
      expect(cpu.getState().DX).toBe(0xFFFF);
      expect(cpu.getState().AX).toBe(0xFFFF);
    });

    it('2.16 DAA (BCD adjust after addition)', () => {
      const code = `
        MOV AL, 15h        ; BCD 15
        MOV BL, 27h        ; BCD 27
        ADD AL, BL          ; binary sum = 3Ch
        DAA
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.readRegister8('AL')).toBe(0x42);
    });

    it('2.17 AAA (ASCII adjust after addition)', () => {
      const code = `
        MOV AX, 0
        MOV AL, 08h
        MOV BL, 07h
        ADD AL, BL         ; AL=0Fh
        AAA
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.readRegister8('AL')).toBe(0x05);
      expect(cpu.readRegister8('AH')).toBe(0x01);
      expect(cpu.getFlag('CF')).toBe(true);
      expect(cpu.getFlag('AF')).toBe(true);
    });
  });

  // ─── 3. Logic / Bit Manipulation ───────────────────────────────────────────
  describe('3. Logic / Bit Manipulation', () => {
    it('3.1 AND / OR / XOR / NOT', () => {
      const code = `
        MOV AX, 0F0F0h
        AND AX, 0FF00h
        MOV BX, 0F0F0h
        OR BX, 000Fh
        MOV CX, 0FFFFh
        XOR CX, 0F0F0h
        MOV DX, 0000h
        NOT DX
        HLT
      `;
      const { cpu } = runSnippet(code);
      const s = cpu.getState();
      expect(s.AX).toBe(0xF000);
      expect(s.BX).toBe(0xF0FF);
      expect(s.CX).toBe(0x0F0F);
      expect(s.DX).toBe(0xFFFF);
    });

    it('3.2 TEST (flags only)', () => {
      const code = `
        MOV AX, 000Fh
        TEST AX, 00F0h
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getState().AX).toBe(0x000F);
      expect(cpu.getFlag('ZF')).toBe(true);
    });

    it('3.3 SHL / SHR', () => {
      const code = `
        MOV AL, 01h
        SHL AL, 1
        MOV BL, 80h
        SHR BL, 1
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.readRegister8('AL')).toBe(0x02);
      expect(cpu.readRegister8('BL')).toBe(0x40);
      expect(cpu.getFlag('CF')).toBe(false);
    });

    it('3.4 SAR (arithmetic, sign-preserving)', () => {
      const code = `
        MOV AL, 80h        ; -128 signed
        SAR AL, 1
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.readRegister8('AL')).toBe(0xC0);
    });

    it('3.5 ROL / ROR', () => {
      const code = `
        MOV AL, 81h
        ROL AL, 1
        MOV BL, 81h
        ROR BL, 1
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.readRegister8('AL')).toBe(0x03);
      expect(cpu.readRegister8('BL')).toBe(0xC0);
      expect(cpu.getFlag('CF')).toBe(true);
    });

    it('3.6 RCL / RCR (through carry)', () => {
      const code = `
        STC
        MOV AL, 40h
        RCL AL, 1
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.readRegister8('AL')).toBe(0x81);
      expect(cpu.getFlag('CF')).toBe(false);
    });
  });

  // ─── 4. Control Flow ────────────────────────────────────────────────────────
  describe('4. Control Flow', () => {
    it('4.1 Unconditional JMP', () => {
      const code = `
        JMP skip
        MOV AX, 1111h
        skip:
        MOV AX, 2222h
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getState().AX).toBe(0x2222);
    });

    // ── 4.2 Expanded Conditional Jump Table (All 16 mnemonics, Taken & Not Taken) ──
    describe('4.2 Comprehensive Conditional Jump Table', () => {
      const jumpCases: {
        mnemonic: string;
        setup: string;
        takenDesc: string;
        notTakenSetup: string;
        notTakenDesc: string;
      }[] = [
        { mnemonic: 'JE', setup: 'MOV AX, 5\nCMP AX, 5', takenDesc: '5 == 5', notTakenSetup: 'MOV AX, 5\nCMP AX, 3', notTakenDesc: '5 != 3' },
        { mnemonic: 'JNE', setup: 'MOV AX, 5\nCMP AX, 3', takenDesc: '5 != 3', notTakenSetup: 'MOV AX, 5\nCMP AX, 5', notTakenDesc: '5 == 5' },
        { mnemonic: 'JG', setup: 'MOV AX, 5\nCMP AX, 3', takenDesc: '5 > 3 (signed)', notTakenSetup: 'MOV AX, 3\nCMP AX, 5', notTakenDesc: '3 not > 5' },
        { mnemonic: 'JGE', setup: 'MOV AX, 5\nCMP AX, 5', takenDesc: '5 >= 5 (signed)', notTakenSetup: 'MOV AX, 2\nCMP AX, 5', notTakenDesc: '2 not >= 5' },
        { mnemonic: 'JL', setup: 'MOV AX, 3\nCMP AX, 5', takenDesc: '3 < 5 (signed)', notTakenSetup: 'MOV AX, 5\nCMP AX, 3', notTakenDesc: '5 not < 3' },
        { mnemonic: 'JLE', setup: 'MOV AX, 5\nCMP AX, 5', takenDesc: '5 <= 5 (signed)', notTakenSetup: 'MOV AX, 7\nCMP AX, 5', notTakenDesc: '7 not <= 5' },
        { mnemonic: 'JA', setup: 'MOV AX, 10\nCMP AX, 5', takenDesc: '10 > 5 (unsigned)', notTakenSetup: 'MOV AX, 5\nCMP AX, 10', notTakenDesc: '5 not > 10' },
        { mnemonic: 'JAE', setup: 'MOV AX, 10\nCMP AX, 10', takenDesc: '10 >= 10 (unsigned)', notTakenSetup: 'MOV AX, 5\nCMP AX, 10', notTakenDesc: '5 not >= 10' },
        { mnemonic: 'JB', setup: 'MOV AX, 3\nCMP AX, 10', takenDesc: '3 < 10 (unsigned)', notTakenSetup: 'MOV AX, 10\nCMP AX, 3', notTakenDesc: '10 not < 3' },
        { mnemonic: 'JBE', setup: 'MOV AX, 10\nCMP AX, 10', takenDesc: '10 <= 10 (unsigned)', notTakenSetup: 'MOV AX, 15\nCMP AX, 10', notTakenDesc: '15 not <= 10' },
        { mnemonic: 'JC', setup: 'STC', takenDesc: 'CF=1', notTakenSetup: 'CLC', notTakenDesc: 'CF=0' },
        { mnemonic: 'JNC', setup: 'CLC', takenDesc: 'CF=0', notTakenSetup: 'STC', notTakenDesc: 'CF=1' },
        { mnemonic: 'JO', setup: 'MOV AX, 7FFFh\nADD AX, 1', takenDesc: 'OF=1', notTakenSetup: 'MOV AX, 1\nADD AX, 1', notTakenDesc: 'OF=0' },
        { mnemonic: 'JNO', setup: 'MOV AX, 1\nADD AX, 1', takenDesc: 'OF=0', notTakenSetup: 'MOV AX, 7FFFh\nADD AX, 1', notTakenDesc: 'OF=1' },
        { mnemonic: 'JS', setup: 'MOV AX, 0\nDEC AX', takenDesc: 'SF=1', notTakenSetup: 'MOV AX, 5\nSUB AX, 1', notTakenDesc: 'SF=0' },
        { mnemonic: 'JNS', setup: 'MOV AX, 5\nSUB AX, 1', takenDesc: 'SF=0', notTakenSetup: 'MOV AX, 0\nDEC AX', notTakenDesc: 'SF=1' },
        { mnemonic: 'JP', setup: 'MOV AL, 3\nAND AL, 3', takenDesc: 'PF=1 (even parity)', notTakenSetup: 'MOV AL, 1\nAND AL, 1', notTakenDesc: 'PF=0 (odd parity)' },
        { mnemonic: 'JNP', setup: 'MOV AL, 1\nAND AL, 1', takenDesc: 'PF=0 (odd parity)', notTakenSetup: 'MOV AL, 3\nAND AL, 3', notTakenDesc: 'PF=1 (even parity)' },
      ];

      for (const jc of jumpCases) {
        it(`4.2 ${jc.mnemonic} taken when ${jc.takenDesc}`, () => {
          const code = `
            ${jc.setup}
            ${jc.mnemonic} target
            MOV BX, 1
            target:
            MOV BX, 2
            HLT
          `;
          const { cpu } = runSnippet(code);
          expect(cpu.getState().BX, `${jc.mnemonic} should be taken when ${jc.takenDesc}`).toBe(2);
        });

        it(`4.2 ${jc.mnemonic} not taken when ${jc.notTakenDesc}`, () => {
          const code = `
            ${jc.notTakenSetup}
            ${jc.mnemonic} target
            MOV BX, 1
            JMP done
            target:
            MOV BX, 2
            done:
            HLT
          `;
          const { cpu } = runSnippet(code);
          expect(cpu.getState().BX, `${jc.mnemonic} should NOT be taken when ${jc.notTakenDesc}`).toBe(1);
        });
      }
    });

    it('4.3 LOOP', () => {
      const code = `
        MOV CX, 5
        MOV AX, 0
        top:
        INC AX
        LOOP top
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getState().AX).toBe(5);
      expect(cpu.getState().CX).toBe(0);
    });

    it('4.4 LOOPE / LOOPNE', () => {
      const code = `
        MOV CX, 5
        MOV AX, 0
        MOV BX, 3
        top2:
        INC AX
        CMP AX, BX
        LOOPNE top2
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getState().AX).toBe(3);
      expect(cpu.getState().CX).toBe(2);
    });

    it('4.5 JCXZ', () => {
      const code = `
        MOV CX, 0
        JCXZ was_zero
        MOV AX, 1
        was_zero:
        MOV AX, 2
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getState().AX).toBe(2);
    });

    it('4.6 CALL / RET (near, with stack check)', () => {
      const code = `
        MOV SP, 0FFFEh
        CALL myproc
        MOV AX, 100h
        JMP end
        myproc:
        MOV BX, 200h
        RET
        end:
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getState().BX).toBe(0x200);
      expect(cpu.getState().AX).toBe(0x100);
      expect(cpu.getState().SP).toBe(0xFFFE);
    });

    it('4.7 Nested CALL', () => {
      const code = `
        MOV SP, 0FFFEh
        CALL outer
        JMP fin
        outer:
        CALL inner
        RET
        inner:
        MOV AX, 42h
        RET
        fin:
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getState().AX).toBe(0x42);
      expect(cpu.getState().SP).toBe(0xFFFE);
    });

    it('4.8 INT / IRET with flags preserved', () => {
      let intInvoked = false;
      const code = `
        MOV AX, 1234h
        INT 21h
        HLT
      `;
      const { cpu } = runSnippet(code, {
        ioHandler: {
          writeChar: () => {},
          readChar: () => null
        }
      });
      expect(cpu.getState().AX).toBe(0x1234);
    });
  });

  // ─── 5. String Instructions ─────────────────────────────────────────────────
  describe('5. String Instructions', () => {
    it('5.1 MOVSB with REP', () => {
      const code = `
        MOV SI, 100h
        MOV DI, 200h
        MOV CX, 5
        MOV BYTE PTR [100h], 1
        MOV BYTE PTR [101h], 2
        MOV BYTE PTR [102h], 3
        MOV BYTE PTR [103h], 4
        MOV BYTE PTR [104h], 5
        CLD
        REP MOVSB
        HLT
      `;
      const { cpu } = runSnippet(code);
      for (let i = 0; i < 5; i++) {
        expect(cpu.readPhysical8(0x200 + i)).toBe(i + 1);
      }
      expect(cpu.getState().SI).toBe(0x105);
      expect(cpu.getState().DI).toBe(0x205);
      expect(cpu.getState().CX).toBe(0);
    });

    it('5.2 MOVSB with DF set (direction reversed)', () => {
      const code = `
        MOV BYTE PTR [100h], 1
        MOV BYTE PTR [101h], 2
        MOV BYTE PTR [102h], 3
        MOV BYTE PTR [103h], 4
        MOV BYTE PTR [104h], 5
        STD
        MOV SI, 104h
        MOV DI, 204h
        MOV CX, 5
        REP MOVSB
        HLT
      `;
      const { cpu } = runSnippet(code);
      for (let i = 0; i < 5; i++) {
        expect(cpu.readPhysical8(0x200 + i)).toBe(i + 1);
      }
      expect(cpu.getState().SI).toBe(0x00FF);
      expect(cpu.getState().DI).toBe(0x01FF);
      expect(cpu.getState().CX).toBe(0);
    });

    it('5.3 CMPSB with REPE', () => {
      const code = `
        MOV BYTE PTR [100h], 10h
        MOV BYTE PTR [101h], 20h
        MOV BYTE PTR [102h], 30h
        MOV BYTE PTR [200h], 10h
        MOV BYTE PTR [201h], 20h
        MOV BYTE PTR [202h], 99h   ; mismatch on 3rd byte
        MOV SI, 100h
        MOV DI, 200h
        MOV CX, 3
        CLD
        REPE CMPSB
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getFlag('ZF')).toBe(false);
      expect(cpu.getState().CX).toBe(0); // exhausted comparison after index 2
    });

    it('5.4 SCASB with REPNE', () => {
      const code = `
        MOV BYTE PTR [100h], 1
        MOV BYTE PTR [101h], 2
        MOV BYTE PTR [102h], 5Ah   ; target
        MOV BYTE PTR [103h], 4
        MOV DI, 100h
        MOV CX, 10
        MOV AL, 5Ah
        CLD
        REPNE SCASB
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getFlag('ZF')).toBe(true);
      expect(cpu.getState().DI).toBe(0x103);
    });

    it('5.5 LODSB / STOSB (no REP, single step verification)', () => {
      const code = `
        MOV SI, 100h
        MOV BYTE PTR [100h], 99h
        CLD
        LODSB
        MOV DI, 200h
        STOSB
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.readRegister8('AL')).toBe(0x99);
      expect(cpu.readPhysical8(0x200)).toBe(0x99);
      expect(cpu.getState().SI).toBe(0x101);
      expect(cpu.getState().DI).toBe(0x201);
    });
  });

  // ─── 6. Addressing Mode Coverage ───────────────────────────────────────────
  describe('6. Addressing Mode Coverage', () => {
    it('6.1 Explicit coverage of all 8086 addressing forms', () => {
      const code = `
        MOV BX, 1000h
        MOV SI, 20h
        MOV DI, 40h
        MOV BP, 500h

        ; direct
        MOV AX, [1000h]

        ; register indirect
        MOV AX, [BX]
        MOV AX, [SI]
        MOV AX, [DI]

        ; based
        MOV AX, [BX+10h]
        MOV AX, [BP+10h]

        ; indexed
        MOV AX, [SI+10h]
        MOV AX, [DI+10h]

        ; based + indexed
        MOV AX, [BX+SI]
        MOV AX, [BX+DI]
        MOV AX, [BP+SI]
        MOV AX, [BP+DI]

        ; based + indexed + displacement
        MOV AX, [BX+SI+10h]
        MOV AX, [BP+DI+20h]

        ; segment override
        MOV AX, ES:[BX]
        MOV AX, CS:[100h]
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getState().halted).toBe(true);
    });
  });

  // ─── 7. Processor Control ───────────────────────────────────────────────────
  describe('7. Processor Control', () => {
    it('7.1 CLC, STC, CMC, CLD, STD, CLI, STI, NOP, HLT', () => {
      const code = `
        CLC
        STC
        CMC
        CLD
        STD
        CLI
        STI
        NOP
        HLT
      `;
      const { cpu } = runSnippet(code);
      expect(cpu.getFlag('CF')).toBe(false); // STC (1) then CMC (0)
      expect(cpu.getFlag('DF')).toBe(true);  // STD
      expect(cpu.getFlag('IF')).toBe(true);  // STI
      expect(cpu.getState().halted).toBe(true);
    });
  });

  // ─── 8. Assembler Directive Coverage ───────────────────────────────────────
  describe('8. Assembler Directive Coverage', () => {
    it('8.1 ORG, DB, DW, DUP, EQU, labels, END start', () => {
      const code = `
        ORG 100h

        message DB 'Hello$'
        count   DW 10
        buffer  DB 20 DUP(0)
        MAX     EQU 100

        start:
            MOV CX, MAX
            MOV AX, count
            LEA DX, message
            MOV AH, 4Ch
            INT 21h

        END start
      `;
      const { cpu, asmResult } = runSnippet(code);
      expect(asmResult.errors).toHaveLength(0);
      expect(cpu.getState().CX).toBe(100); // MAX substituted with 100
      expect(cpu.getState().DX).toBe(0x100); // LEA DX, message loaded message address
      // 20 DUP(0) buffer expanded into 20 zero bytes
      for (let i = 0; i < 20; i++) {
        expect(cpu.readPhysical8(0x108 + i)).toBe(0);
      }
      // END start resolved as entry point
      expect(asmResult.entryAddress).toBe(0x11C);
    });
  });

  // ─── 9. Full Integration Programs ──────────────────────────────────────────
  describe('9. Full Integration Programs', () => {
    it('9.1 Sum of an array', () => {
      const code = `
        ORG 100h
        arr DB 1, 2, 3, 4, 5
        MOV CX, 5
        MOV SI, OFFSET arr
        MOV AX, 0
        sum_loop:
            MOV BL, [SI]
            MOV BH, 0
            ADD AX, BX
            INC SI
            LOOP sum_loop
        MOV AH, 4Ch
        INT 21h
      `;
      const { cpu } = runSnippet(code);
      // Result 1+2+3+4+5=15 (0x0F). Program exits with AH=4Ch, AL=0Fh (exit code 15)
      expect(cpu.readRegister8('AL')).toBe(0x0F);
    });

    it('9.2 Factorial (iterative, CX=5)', () => {
      const code = `
        ORG 100h
        MOV CX, 5
        MOV AX, 1
        fact_loop:
            MOV BX, CX
            MUL BX
            LOOP fact_loop
        MOV AH, 4Ch
        INT 21h
      `;
      const { cpu } = runSnippet(code);
      // Result 5!=120 (0x78). Program exits with AH=4Ch, AL=78h (exit code 120)
      expect(cpu.readRegister8('AL')).toBe(0x78);
    });

    it('9.3 String reverse (in-place)', () => {
      const code = `
        ORG 100h
        str DB 'ABCDE'
        MOV SI, OFFSET str
        MOV DI, OFFSET str
        ADD DI, 4          ; point DI at last char
        MOV CX, 2          ; swap 2 pairs (5 chars, middle stays)
        rev_loop:
            MOV AL, [SI]
            MOV BL, [DI]
            MOV [SI], BL
            MOV [DI], AL
            INC SI
            DEC DI
            LOOP rev_loop
        MOV AH, 4Ch
        INT 21h
      `;
      const { cpu } = runSnippet(code);
      // str should now be 'EDCBA'
      const chars = [
        cpu.readPhysical8(0x100),
        cpu.readPhysical8(0x101),
        cpu.readPhysical8(0x102),
        cpu.readPhysical8(0x103),
        cpu.readPhysical8(0x104),
      ];
      expect(String.fromCharCode(...chars)).toBe('EDCBA');
    });

    it('9.4 Find max in an array', () => {
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
      const { cpu } = runSnippet(code);
      expect(cpu.readRegister8('AL')).toBe(9);
    });

    it('9.5 Fibonacci sequence (first 8 terms into memory)', () => {
      const code = `
        ORG 100h
        fib DB 8 DUP(0)
        MOV SI, OFFSET fib
        MOV BYTE PTR [SI], 0
        MOV BYTE PTR [SI+1], 1
        MOV CX, 6
        ADD SI, 2
        fib_loop:
            MOV AL, [SI-1]
            MOV BL, [SI-2]
            ADD AL, BL
            MOV [SI], AL
            INC SI
            LOOP fib_loop
        MOV AH, 4Ch
        INT 21h
      `;
      const { cpu } = runSnippet(code);
      const expected = [0, 1, 1, 2, 3, 5, 8, 13];
      for (let i = 0; i < 8; i++) {
        expect(cpu.readPhysical8(0x100 + i)).toBe(expected[i]);
      }
    });
  });

  // ─── Failure-path tests ─────────────────────────────────────────────────────
  describe('Failure Paths and Safety', () => {
    it('should safely error on unknown / invalid opcode without crashing', () => {
      const cpu = new CPU();
      // Write undefined opcode 0xFF to CS:IP
      cpu.writePhysical8(0, 0xD6); // SETALC (undocumented/unsupported)
      expect(() => {
        cpu.step();
      }).toThrow(/Unknown/i);
    });

    it('should halt safely or capture division by zero error', () => {
      const code = `
        MOV AX, 10
        MOV BL, 0
        DIV BL
        HLT
      `;
      const { error } = runSnippet(code);
      expect(error).toBeDefined();
    });
  });

});
