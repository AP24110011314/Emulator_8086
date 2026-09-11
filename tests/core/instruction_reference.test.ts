import { describe, expect, it } from 'vitest';
import { CPU } from '../../src/core/cpu';
import { Memory } from '../../src/core/memory';
import { SAMPLES } from '../../src/samples';
import { assemble } from '../../src/core/assembler';
import { createInterruptHandler } from '../../src/core/interrupts';

function runAssembly(code: string, ioHandler?: { writeChar: (c: string) => void; readChar: () => string | null }): CPU {
  const result = assemble(code);
  if (result.errors.length > 0) {
    throw new Error(`Assembly failed: ${result.errors[0].message} (line ${result.errors[0].line})`);
  }
  const cpu = new CPU();
  if (ioHandler) {
    cpu.interruptHandler = createInterruptHandler(ioHandler);
  }
  // Load code
  for (const ai of result.instructions) {
    for (let i = 0; i < ai.instruction.bytes.length; i++) {
      cpu.writePhysical8(ai.address + i, ai.instruction.bytes[i]);
    }
  }
  // Load data
  if (result.dataBytes.length > 0) {
    const dataBase = result.dataSegmentParagraph << 4;
    for (let i = 0; i < result.dataBytes.length; i++) {
      cpu.writePhysical8(dataBase + i, result.dataBytes[i]);
    }
  }
  cpu.writeRegister('CS', 0);
  cpu.writeRegister('IP', result.entryAddress);
  cpu.writeRegister('DS', result.dataSegmentParagraph);
  cpu.writeRegister('SS', 0x2000);
  cpu.writeRegister('SP', 0x0100);

  // Run all instructions until HLT or max 500 steps
  const map = new Map<number, import('../../src/core/assembler').AssembledInstruction>();
  for (const ai of result.instructions) {
    map.set(ai.address, ai);
  }

  let steps = 0;
  while (!cpu.getState().halted && steps < 500) {
    const ip = cpu.getState().IP;
    const ai = map.get(ip);
    if (!ai) break;
    const ipBefore = ip;
    cpu.execute(ai.instruction);
    const ipAfter = cpu.getState().IP;
    if (ipAfter === ipBefore) {
      cpu.writeRegister('IP', (ipBefore + ai.instruction.bytes.length) & 0xffff);
    }
    steps++;
  }
  return cpu;
}

describe('INSTRUCTION_REFERENCE.md Full Compliance', () => {

  // ─── 1. Data Transfer Instructions ──────────────────────────────────────────
  describe('1. Data Transfer Instructions', () => {
    it('should execute MOV, PUSH, POP, XCHG, LAHF, SAHF, PUSHF, POPF', () => {
      const code = `
        MOV AX, 1234h
        MOV BX, 5678h
        XCHG AX, BX
        PUSH AX
        PUSH BX
        POP CX
        POP DX
        PUSHF
        POPF
        STC
        LAHF
        MOV BL, AH
        CLC
        SAHF
        HLT
      `;
      const cpu = runAssembly(code);
      expect(cpu.getState().CX).toBe(0x1234);
      expect(cpu.getState().DX).toBe(0x5678);
      expect(cpu.readRegister8('BL') & 1).toBe(1); // CF was set when LAHF captured it
      expect(cpu.getFlag('CF')).toBe(true); // SAHF restored CF back to 1 from AH (overriding CLC)
    });

    it('should execute XLAT / XLATB table translation', () => {
      const code = `
.DATA
  TABLE DB 10h, 20h, 30h, 40h
.CODE
  MOV BX, OFFSET TABLE
  MOV AL, 2
  XLAT
  HLT
      `;
      const cpu = runAssembly(code);
      expect(cpu.readRegister8('AL')).toBe(0x30);
    });

    it('should execute LEA, LDS, LES', () => {
      const code = `
.DATA
  PTR_DATA DW 1234h, 5678h
.CODE
  LEA SI, [BP+10h]
  LES DI, [PTR_DATA]
  LDS BX, [PTR_DATA]
  HLT
      `;
      const cpu = runAssembly(code);
      expect(cpu.getState().SI).toBe(16);
      expect(cpu.getState().DI).toBe(0x1234);
      expect(cpu.getState().ES).toBe(0x5678);
      expect(cpu.getState().BX).toBe(0x1234);
      expect(cpu.getState().DS).toBe(0x5678);
    });

    it('should execute IN and OUT port instructions', () => {
      let writtenPort = -1;
      let writtenVal = -1;
      const code = `
        MOV AL, 55h
        OUT 2, AL
        IN AL, 1
        HLT
      `;
      const result = assemble(code);
      const cpu = new CPU();
      cpu.onPortOut = (port, val) => { writtenPort = port; writtenVal = val; };
      cpu.onPortIn = (port) => port === 1 ? 0xAB : 0;
      for (const ai of result.instructions) {
        cpu.execute(ai.instruction);
      }
      expect(writtenPort).toBe(2);
      expect(writtenVal).toBe(0x55);
      expect(cpu.readRegister8('AL')).toBe(0xAB);
    });
  });

  // ─── 2. Arithmetic Instructions ─────────────────────────────────────────────
  describe('2. Arithmetic Instructions', () => {
    it('should execute ADD, ADC, SUB, SBB, INC, DEC, NEG, CMP', () => {
      const code = `
        MOV AX, 5
        ADD AX, 10
        STC
        ADC AX, 4
        SUB AX, 5
        STC
        SBB AX, 3
        INC AX
        DEC AX
        NEG AX
        CMP AX, -11
        HLT
      `;
      const cpu = runAssembly(code);
      expect(cpu.getState().AX).toBe((-11) & 0xffff);
      expect(cpu.getFlag('ZF')).toBe(true);
    });

    it('should execute MUL, IMUL, DIV, IDIV', () => {
      const code = `
        MOV AL, 10
        MOV BL, 5
        MUL BL
        MOV CX, AX

        MOV AL, -4
        MOV BL, 3
        IMUL BL
        MOV DX, AX

        MOV AX, 100
        MOV BL, 10
        DIV BL
        MOV SI, AX

        MOV AX, -50
        MOV BL, 5
        IDIV BL
        MOV DI, AX

        HLT
      `;
      const cpu = runAssembly(code);
      expect(cpu.getState().CX).toBe(50);
      expect(cpu.getState().DX & 0xff).toBe((-12) & 0xff);
      expect(cpu.readRegister8('AL')).toBe((-10) & 0xff); // quotient in AL
    });

    it('should execute CBW and CWD', () => {
      const code = `
        MOV AL, 80h
        CBW
        MOV BX, AX
        CWD
        HLT
      `;
      const cpu = runAssembly(code);
      expect(cpu.getState().BX).toBe(0xff80);
      expect(cpu.getState().DX).toBe(0xffff);
    });

    it('should execute BCD & ASCII adjust: AAA, AAS, AAM, AAD, DAA, DAS', () => {
      const code = `
        MOV AX, 0005h
        ADD AL, 08h
        AAA
        MOV BX, AX

        MOV AX, 0102h
        SUB AL, 05h
        AAS
        MOV CX, AX

        MOV AL, 35
        AAM
        MOV DX, AX

        MOV AX, 0305h
        AAD
        MOV SI, AX

        MOV AL, 38h
        ADD AL, 45h
        DAA
        MOV DI, AX

        HLT
      `;
      const cpu = runAssembly(code);
      expect(cpu.getState().BX).toBe(0x0103);
      expect(cpu.getState().CX).toBe(0x0007);
      expect(cpu.getState().DX).toBe(0x0305);
      expect(cpu.getState().SI).toBe(35);
      expect(cpu.getState().DI & 0xff).toBe(0x83);
    });
  });

  // ─── 3. Logic / Bit Manipulation ────────────────────────────────────────────
  describe('3. Logic / Bit Manipulation', () => {
    it('should execute AND, OR, XOR, NOT, TEST', () => {
      const code = `
        MOV AX, 00FFh
        AND AX, 0F0Fh
        OR AX, 00F0h
        XOR AX, 00FFh
        NOT AX
        TEST AX, 0F00h
        HLT
      `;
      const cpu = runAssembly(code);
      expect(cpu.getFlag('ZF')).toBe(false);
    });

    it('should execute SHL, SHR, SAR, ROL, ROR, RCL, RCR', () => {
      const code = `
        MOV AX, 1
        SHL AX, 3
        SHR AX, 1
        MOV BX, -8
        SAR BX, 1
        MOV CX, 8001h
        ROL CX, 1
        ROR CX, 1
        STC
        RCL AX, 1
        RCR AX, 1
        HLT
      `;
      const cpu = runAssembly(code);
      expect(cpu.getState().AX).toBe(4);
      expect(cpu.getState().BX).toBe((-4) & 0xffff);
      expect(cpu.getState().CX).toBe(0x8001);
    });

    it('should execute single-operand shift defaulting to count 1', () => {
      const code = `
        MOV AX, 4
        SHL AX
        SHR AX
        HLT
      `;
      const cpu = runAssembly(code);
      expect(cpu.getState().AX).toBe(4);
    });
  });

  // ─── 4. Control Transfer / Flow ─────────────────────────────────────────────
  describe('4. Control Transfer / Flow', () => {
    it('should execute conditional jumps and LOOP', () => {
      const code = `
        MOV AX, 0
        MOV CX, 5
    COUNT:
        INC AX
        LOOP COUNT
        CMP AX, 5
        JE IS_FIVE
        JMP FAILED
    IS_FIVE:
        MOV BX, 1
        JMP DONE
    FAILED:
        MOV BX, 0
    DONE:
        HLT
      `;
      const cpu = runAssembly(code);
      expect(cpu.getState().AX).toBe(5);
      expect(cpu.getState().BX).toBe(1);
    });

    it('should execute CALL and RET with parameter pop (RET n)', () => {
      const code = `
        PUSH 10h
        PUSH 20h
        CALL ADD_TWO
        HLT

    ADD_TWO:
        MOV BP, SP
        MOV AX, [BP+4]
        ADD AX, [BP+2]
        RET 4
      `;
      const cpu = runAssembly(code);
      expect(cpu.getState().AX).toBe(0x30);
      expect(cpu.getState().SP).toBe(0x0100); // 4 bytes popped from stack
    });

    it('should execute JCXZ', () => {
      const code = `
        MOV CX, 0
        JCXZ SKIP
        MOV AX, 1
    SKIP:
        MOV BX, 2
        HLT
      `;
      const cpu = runAssembly(code);
      expect(cpu.getState().AX).toBe(0);
      expect(cpu.getState().BX).toBe(2);
    });
  });

  // ─── 5. String Instructions ─────────────────────────────────────────────────
  describe('5. String Instructions', () => {
    it('should execute REP MOVSB', () => {
      const code = `
.DATA
  SRC DB 'ABCDE'
  DST DB 5 DUP(0)
.CODE
  MOV SI, OFFSET SRC
  MOV DI, OFFSET DST
  MOV CX, 5
  CLD
  REP MOVSB
  HLT
      `;
      const cpu = runAssembly(code);
      expect(cpu.getState().CX).toBe(0);
    });

    it('should execute LODSB and STOSB', () => {
      const code = `
.DATA
  SRC DB 42h
  DST DB 0
.CODE
  MOV SI, OFFSET SRC
  MOV DI, OFFSET DST
  CLD
  LODSB
  STOSB
  HLT
      `;
      const cpu = runAssembly(code);
      expect(cpu.readRegister8('AL')).toBe(0x42);
    });
  });

  // ─── 6. Processor Control & Flags ───────────────────────────────────────────
  describe('6. Processor Control & Flags', () => {
    it('should execute CLC, STC, CMC, CLD, STD, CLI, STI, NOP, HLT', () => {
      const code = `
        STC
        CMC
        CLC
        STD
        CLD
        STI
        CLI
        NOP
        HLT
      `;
      const cpu = runAssembly(code);
      expect(cpu.getFlag('CF')).toBe(false);
      expect(cpu.getFlag('DF')).toBe(false);
      expect(cpu.getFlag('IF')).toBe(false);
      expect(cpu.getState().halted).toBe(true);
    });
  });

  // ─── 7. Directives, Keywords & Addressing Modes ─────────────────────────────
  describe('7. Directives, Keywords & Addressing Modes', () => {
    it('should support OFFSET and SEG keywords', () => {
      const code = `
.DATA
  VAR1 DW 1234h
.CODE
  MOV DX, OFFSET VAR1
  MOV AX, SEG VAR1
  HLT
      `;
      const cpu = runAssembly(code);
      expect(cpu.getState().DX).toBe(0);
      expect(cpu.getState().AX).toBe(0x1000);
    });

    it('should resolve data labels inside memory brackets [VAR]', () => {
      const code = `
.DATA
  NUM DW 55AAh
.CODE
  MOV AX, [NUM]
  HLT
      `;
      const cpu = runAssembly(code);
      expect(cpu.getState().AX).toBe(0x55AA);
    });

    it('should support segment prefixes outside brackets ES:[BX]', () => {
      const code = `
        MOV AX, ES:[BX]
        HLT
      `;
      const res = assemble(code);
      expect(res.errors).toHaveLength(0);
      expect(res.instructions[0].instruction.operands[1].segment).toBe('ES');
    });

    it('should support global EQU directives and DUP with hex/uninitialized', () => {
      const code = `
        MY_CONST EQU 42
        .DATA
        ARR DB 4 DUP(0)
        ARR2 DW 2 DUP(?)
        .CODE
        MOV AX, MY_CONST
        HLT
      `;
      const cpu = runAssembly(code);
      expect(cpu.getState().AX).toBe(42);
    });

    it('should skip textbook directives like TITLE, PAGE, NAME, MACRO blocks', () => {
      const code = `
        TITLE MyTextbookProgram
        PAGE 60, 132
        NAME testprog

        PRINT_CHAR MACRO c
          MOV DL, c
          MOV AH, 02h
          INT 21h
        ENDM

        .CODE
        MOV AX, 99
        HLT
      `;
      const cpu = runAssembly(code);
      expect(cpu.getState().AX).toBe(99);
    });

    it('should support ORG 100h COM style program entry address', () => {
      const code = `
        ORG 100h
        MOV AX, 77
        HLT
      `;
      const res = assemble(code);
      expect(res.entryAddress).toBe(0x0100);
      expect(res.instructions[0].address).toBe(0x0100);
    });

    it('should support based, indexed, and displacement addressing modes', () => {
      const code = `
        MOV AX, [BX]
        MOV CX, [SI]
        MOV DX, [DI]
        MOV AX, [BX+4]
        MOV AX, [BX+SI]
        MOV AX, [BX+DI+8]
        MOV AX, [BP+4]
        HLT
      `;
      const res = assemble(code);
      expect(res.errors).toHaveLength(0);
    });

    it('should assemble and validate all built-in sample programs without error', () => {
      for (const sample of SAMPLES) {
        const res = assemble(sample.code);
        expect(res.errors, `Sample ${sample.name} failed: ${res.errors[0]?.message}`).toHaveLength(0);
        expect(res.instructions.length).toBeGreaterThan(0);
      }
    });
  });
});
