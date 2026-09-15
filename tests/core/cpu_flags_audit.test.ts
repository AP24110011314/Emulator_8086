// Regression: exhaustive conditional-jump truth table + exact ADC/SBB/DIV
// flag behavior. Root causes fixed: ADC/SBB folded-carry flag computation,
// DIV-overflow not halting, CALL return address on the decode/step path.
import { describe, expect, it } from 'vitest';
import { CPU } from '../../src/core/cpu';
import { assemble } from '../../src/core/assembler';
import { createInterruptHandler } from '../../src/core/interrupts';

// Direct-execute harness (App.tsx programStep parity): execute each
// instruction at IP, advancing IP manually when the instruction leaves it
// unchanged.
function run(code: string, io?: any) {
  const r = assemble(code);
  if (r.errors.length) throw new Error('ASM: ' + r.errors[0].message);
  const cpu = new CPU();
  if (io) cpu.interruptHandler = createInterruptHandler(io);
  for (const ai of r.instructions)
    for (let i = 0; i < ai.instruction.bytes.length; i++)
      cpu.writePhysical8(ai.address + i, ai.instruction.bytes[i]);
  if (r.dataBytes.length)
    for (let i = 0; i < r.dataBytes.length; i++)
      cpu.writePhysical8((r.dataSegmentParagraph << 4) + i, r.dataBytes[i]);
  cpu.writeRegister('CS', 0);
  cpu.writeRegister('IP', r.entryAddress);
  cpu.writeRegister('DS', 0);
  cpu.writeRegister('ES', 0);
  cpu.writeRegister('SS', 0);
  cpu.writeRegister('SP', 0xFFFE);
  const map = new Map(r.instructions.map(a => [a.address, a]));
  let steps = 0;
  while (!cpu.getState().halted && steps < 2000) {
    const ip = cpu.getState().IP;
    const ai = map.get(ip);
    if (!ai) break;
    cpu.execute(ai.instruction);
    if (cpu.getState().IP === ip) cpu.writeRegister('IP', (ip + ai.instruction.bytes.length) & 0xffff);
    steps++;
  }
  return cpu;
}
const F = (cpu: CPU, f: any) => cpu.getFlag(f);

describe('conditional jumps exhaustive (taken + not-taken)', () => {
  const cases: Array<[string, string, string]> = [
    // [mnemonic, setup producing TAKEN, setup producing NOT-TAKEN]
    ['JE', 'MOV AX,5\nCMP AX,5', 'MOV AX,5\nCMP AX,3'],
    ['JNE', 'MOV AX,5\nCMP AX,3', 'MOV AX,5\nCMP AX,5'],
    ['JG', 'MOV AX,5\nCMP AX,3', 'MOV AX,5\nCMP AX,5'],   // equal not-taken
    ['JG', 'MOV AX,5\nCMP AX,3', 'MOV AX,3\nCMP AX,5'],   // less not-taken
    ['JL', 'MOV AX,3\nCMP AX,5', 'MOV AX,5\nCMP AX,5'],
    ['JL', 'MOV AX,3\nCMP AX,5', 'MOV AX,5\nCMP AX,3'],
    ['JGE', 'MOV AX,5\nCMP AX,5', 'MOV AX,3\nCMP AX,5'],
    ['JGE', 'MOV AX,5\nCMP AX,3', 'MOV AX,3\nCMP AX,5'],
    ['JLE', 'MOV AX,5\nCMP AX,5', 'MOV AX,5\nCMP AX,3'],
    ['JLE', 'MOV AX,3\nCMP AX,5', 'MOV AX,5\nCMP AX,3'],
    ['JA', 'MOV AX,5\nCMP AX,3', 'MOV AX,5\nCMP AX,5'],
    ['JA', 'MOV AX,5\nCMP AX,3', 'MOV AX,3\nCMP AX,5'],
    ['JB', 'MOV AX,3\nCMP AX,5', 'MOV AX,5\nCMP AX,5'],
    ['JB', 'MOV AX,3\nCMP AX,5', 'MOV AX,5\nCMP AX,3'],
    ['JAE', 'MOV AX,5\nCMP AX,5', 'MOV AX,3\nCMP AX,5'],
    ['JBE', 'MOV AX,5\nCMP AX,5', 'MOV AX,5\nCMP AX,3'],
    ['JBE', 'MOV AX,3\nCMP AX,5', 'MOV AX,5\nCMP AX,3'],
    ['JC', 'STC', 'CLC'],
    ['JNC', 'CLC', 'STC'],
    ['JO', 'MOV AX,7FFFh\nADD AX,1', 'MOV AX,1\nADD AX,1'],
    ['JNO', 'MOV AX,1\nADD AX,1', 'MOV AX,7FFFh\nADD AX,1'],
    ['JS', 'MOV AX,0\nSUB AX,1', 'MOV AX,1\nADD AX,1'],
    ['JNS', 'MOV AX,1\nADD AX,1', 'MOV AX,0\nSUB AX,1'],
    ['JP', 'MOV AL,3\nTEST AL,AL', 'MOV AL,1\nTEST AL,AL'],   // 3=2 bits even; 1=1 bit odd
    ['JNP', 'MOV AL,1\nTEST AL,AL', 'MOV AL,3\nTEST AL,AL'],
  ];
  for (const [m, taken, notTaken] of cases) {
    it(`${m} taken`, () => {
      const cpu = run(`${taken}\n${m} yes\nMOV BX,1\nJMP done\nyes:\nMOV BX,2\ndone:\nHLT`);
      expect(cpu.getState().BX).toBe(2);
    });
    it(`${m} not-taken`, () => {
      const cpu = run(`${notTaken}\n${m} yes\nMOV BX,1\nJMP done\nyes:\nMOV BX,2\ndone:\nHLT`);
      expect(cpu.getState().BX).toBe(1);
    });
  }
  it('signed overflow CMP drives JG/JL correctly (7FFF vs -1)', () => {
    // AX=7FFF, BX=FFFF(-1): CMP AX,BX → 7FFF-FFFF = 0x8000, OF=1,SF=1 → SF==OF → JG taken, JL not
    let cpu = run('MOV AX,7FFFh\nMOV BX,0FFFFh\nCMP AX,BX\nJG yes\nMOV CX,1\nJMP done\nyes:\nMOV CX,2\ndone:\nHLT');
    expect(cpu.getState().CX).toBe(2);
    cpu = run('MOV AX,7FFFh\nMOV BX,0FFFFh\nCMP AX,BX\nJL yes\nMOV CX,1\nJMP done\nyes:\nMOV CX,2\ndone:\nHLT');
    expect(cpu.getState().CX).toBe(1);
  });
});

describe('arithmetic flag edge cases', () => {
  it('ADC exact: 7FFF+7FFF+C=1 → OF=1 AF=1 CF=0', () => {
    const cpu = run('MOV AX,7FFFh\nSTC\nADC AX,7FFFh\nHLT');
    const s = cpu.getState();
    expect(s.AX).toBe(0xFFFF);
    expect(F(cpu, 'OF')).toBe(true);
    expect(F(cpu, 'AF')).toBe(true);
    expect(F(cpu, 'CF')).toBe(false);
  });
  it('SBB exact: 8000-7FFF-C=1 → OF=1', () => {
    const cpu = run('MOV AX,8000h\nSTC\nSBB AX,7FFFh\nHLT');
    expect(cpu.getState().AX).toBe(0);
    expect(F(cpu, 'OF')).toBe(true);
  });
  it('SBB AF exact: 10-0F-C=1 borrows nibble', () => {
    const cpu = run('MOV AX,10h\nSTC\nSBB AX,0Fh\nHLT');
    expect(cpu.getState().AX).toBe(0);
    expect(F(cpu, 'AF')).toBe(true);
    expect(F(cpu, 'CF')).toBe(false);
  });
  it('SBB CF: 0-0-C=1 → FFFF CF=1', () => {
    const cpu = run('MOV AX,0\nSTC\nSBB AX,0\nHLT');
    expect(cpu.getState().AX).toBe(0xFFFF);
    expect(F(cpu, 'CF')).toBe(true);
  });
  it('ADC CF chain: FFFF+1+C → carry out', () => {
    const cpu = run('MOV AX,0FFFFh\nSTC\nADC AX,0\nHLT');
    expect(cpu.getState().AX).toBe(0);
    expect(F(cpu, 'CF')).toBe(true);
  });
  it('INC/DEC preserve CF, set AF/OF', () => {
    const cpu = run('STC\nMOV AX,7FFFh\nINC AX\nHLT');
    expect(cpu.getState().AX).toBe(0x8000);
    expect(F(cpu, 'CF')).toBe(true);
    expect(F(cpu, 'OF')).toBe(true);
    const cpu2 = run('STC\nMOV AX,8000h\nDEC AX\nHLT');
    expect(cpu2.getState().AX).toBe(0x7FFF);
    expect(F(cpu2, 'CF')).toBe(true);
    expect(F(cpu2, 'OF')).toBe(true);
  });
  it('NEG edges', () => {
    let cpu = run('MOV AX,0\nNEG AX\nHLT');
    expect(cpu.getState().AX).toBe(0);
    expect(F(cpu, 'CF')).toBe(false);
    cpu = run('MOV AX,8000h\nNEG AX\nHLT');
    expect(cpu.getState().AX).toBe(0x8000);
    expect(F(cpu, 'OF')).toBe(true);
    expect(F(cpu, 'CF')).toBe(true);
    cpu = run('MOV AL,1\nNEG AL\nHLT');
    expect(cpu.readRegister8('AL')).toBe(0xFF);
    expect(F(cpu, 'CF')).toBe(true);
  });
  it('IMUL 8-bit negative: AL=-2 * 5 = -10, AH sign-ext → CF=OF=0', () => {
    const cpu = run('MOV AL,0FEh\nMOV BL,5\nIMUL BL\nHLT');
    expect(cpu.getState().AX).toBe(0xFFF6);
    expect(F(cpu, 'CF')).toBe(false);
    expect(F(cpu, 'OF')).toBe(false);
  });
  it('IMUL 8-bit overflow: 100*100 → CF=OF=1', () => {
    const cpu = run('MOV AL,100\nMOV BL,100\nIMUL BL\nHLT');
    expect(F(cpu, 'CF')).toBe(true);
    expect(F(cpu, 'OF')).toBe(true);
  });
  it('MUL 8-bit: 10h*10h=100h → AH=1 CF=OF=1', () => {
    const cpu = run('MOV AL,10h\nMOV BL,10h\nMUL BL\nHLT');
    expect(cpu.getState().AX).toBe(0x0100);
    expect(F(cpu, 'CF')).toBe(true);
    expect(F(cpu, 'OF')).toBe(true);
  });
  it('DIV overflow throws + halts', () => {
    const r = assemble('MOV AX,0FFFFh\nMOV BL,1\nDIV BL\nHLT');
    const cpu = new CPU();
    cpu.writeRegister('CS', 0); cpu.writeRegister('IP', 0);
    cpu.writeRegister('SS', 0); cpu.writeRegister('SP', 0xFFFE);
    const map = new Map(r.instructions.map(a => [a.address, a]));
    let threw: Error | null = null;
    let steps = 0;
    while (!cpu.getState().halted && steps < 50) {
      const ip = cpu.getState().IP;
      const ai = map.get(ip);
      if (!ai) break;
      try { cpu.execute(ai.instruction); } catch (e) { threw = e as Error; break; }
      if (cpu.getState().IP === ip) cpu.writeRegister('IP', (ip + ai.instruction.bytes.length) & 0xffff);
      steps++;
    }
    expect(threw?.message).toBe('Division overflow');
    expect(cpu.getState().halted).toBe(true);
  });
  it('IDIV negative: -10/3 → AL=-3 AH=-1', () => {
    const cpu = run('MOV AX,0FFF6h\nMOV BL,3\nIDIV BL\nHLT');
    expect(cpu.readRegister8('AL')).toBe(0xFD);
    expect(cpu.readRegister8('AH')).toBe(0xFF);
  });
  it('DAA/DAS/AAA/AAS', () => {
    let cpu = run('MOV AL,15h\nMOV BL,27h\nADD AL,BL\nDAA\nHLT');
    expect(cpu.readRegister8('AL')).toBe(0x42);
    cpu = run('MOV AL,08h\nMOV BL,07h\nADD AL,BL\nAAA\nHLT');
    expect(cpu.readRegister8('AL')).toBe(5);
    expect(F(cpu, 'CF')).toBe(true);
    expect(F(cpu, 'AF')).toBe(true);
    cpu = run('MOV AL,43h\nMOV BL,27h\nSUB AL,BL\nDAS\nHLT');
    expect(cpu.readRegister8('AL')).toBe(0x16);
  });
  it('AAM/AAD', () => {
    let cpu = run('MOV AL,25\nAAM\nHLT');
    expect(cpu.readRegister8('AH')).toBe(2);
    expect(cpu.readRegister8('AL')).toBe(5);
    cpu = run('MOV AH,2\nMOV AL,5\nAAD\nHLT');
    expect(cpu.readRegister8('AL')).toBe(25);
  });
  it('shifts capture CF; SAR sign-extends; count 0 = no-op flags', () => {
    let cpu = run('MOV AL,81h\nSHR AL,1\nHLT');
    expect(cpu.readRegister8('AL')).toBe(0x40);
    expect(F(cpu, 'CF')).toBe(true);
    cpu = run('MOV AL,80h\nSAR AL,1\nHLT');
    expect(cpu.readRegister8('AL')).toBe(0xC0);
    cpu = run('STC\nMOV AL,55h\nSHL AL,0\nHLT');
    expect(cpu.readRegister8('AL')).toBe(0x55);
    expect(F(cpu, 'CF')).toBe(true); // untouched
  });
  it('rotates through carry', () => {
    const cpu = run('STC\nMOV AL,40h\nRCL AL,1\nHLT');
    expect(cpu.readRegister8('AL')).toBe(0x81);
    expect(F(cpu, 'CF')).toBe(false);
    const cpu2 = run('MOV AL,81h\nROL AL,1\nHLT');
    expect(cpu2.readRegister8('AL')).toBe(0x03);
    expect(F(cpu2, 'CF')).toBe(true);
    const cpu3 = run('MOV BL,81h\nROR BL,1\nHLT');
    expect(cpu3.readRegister8('BL')).toBe(0xC0);
    expect(F(cpu3, 'CF')).toBe(true);
  });
  it('CALL via step() returns to right address', () => {
    const cpu = new CPU();
    cpu.writeRegister('SS', 0); cpu.writeRegister('SP', 0xFFFE);
    cpu.writeRegister('CS', 0); cpu.writeRegister('IP', 0);
    // 0: CALL 6 (E8 03 00), 3: NOP, 6: RET
    cpu.loadAndJump([0xE8, 0x03, 0x00, 0x90, 0x90, 0x90, 0xC3], 0, 0);
    cpu.step(); // CALL → IP=6, pushes 3
    expect(cpu.getState().IP).toBe(6);
    expect(cpu.getMemory().read16(0xFFFC)).toBe(3);
    cpu.step(); // RET → IP=3, SP restored
    expect(cpu.getState().IP).toBe(3);
    expect(cpu.getState().SP).toBe(0xFFFE);
    cpu.step(); // NOP → IP=4
    expect(cpu.getState().IP).toBe(4);
  });
  it('nested CALL/RET balances SP (direct path)', () => {
    const cpu = run('MOV SP,0FFFEh\nCALL outer\nJMP fin\nouter:\nCALL inner\nRET\ninner:\nMOV AX,42h\nRET\nfin:\nHLT');
    expect(cpu.getState().AX).toBe(0x42);
    expect(cpu.getState().SP).toBe(0xFFFE);
  });
  it('RET n cleans args (procedures_demo shape)', () => {
    const cpu = run('PUSH 15h\nPUSH 25h\nCALL ADDN\nHLT\nADDN:\nPUSH BP\nMOV BP,SP\nMOV AX,[BP+6]\nADD AX,[BP+4]\nPOP BP\nRET 4');
    expect(cpu.getState().AX).toBe(0x3A);
  });
  it('RCR OF = MSB XOR second-MSB (was always false)', () => {
    // AL=81h CF=0 → result 40h, CF=1, OF = 0^1 = 1
    let cpu = run('MOV AL,81h\nCLC\nRCR AL,1\nHLT');
    expect(cpu.readRegister8('AL')).toBe(0x40);
    expect(F(cpu, 'CF')).toBe(true);
    expect(F(cpu, 'OF')).toBe(true);
    // AL=00h CF=0 → result 00h, CF=0, OF = 0^0 = 0
    cpu = run('MOV AL,00h\nCLC\nRCR AL,1\nHLT');
    expect(F(cpu, 'CF')).toBe(false);
    expect(F(cpu, 'OF')).toBe(false);
    // 16-bit: AX=C000h CF=0 → result 6000h, OF = 0^1 = 1
    cpu = run('MOV AX,0C000h\nCLC\nRCR AX,1\nHLT');
    expect(cpu.getState().AX).toBe(0x6000);
    expect(F(cpu, 'OF')).toBe(true);
  });
  it('rotate count 0 leaves flags untouched (all four)', () => {
    for (const m of ['ROL', 'ROR', 'RCL', 'RCR']) {
      const cpu = run(`STC\nMOV AL,55h\n${m} AL,0\nHLT`);
      expect(cpu.readRegister8('AL')).toBe(0x55);
      expect(F(cpu, 'CF')).toBe(true);
    }
    // CL=0 at runtime is also a no-op
    const cpu = run('STC\nMOV AL,55h\nMOV CL,0\nROL AL,CL\nHLT');
    expect(cpu.readRegister8('AL')).toBe(0x55);
    expect(F(cpu, 'CF')).toBe(true);
  });
  it('AAM/AAD explicit base 0 is a divide error', () => {    for (const m of ['AAM', 'AAD']) {
      const r = assemble(`MOV AL,25\n${m} 0\nHLT`);
      const cpu = new CPU();
      cpu.writeRegister('CS', 0); cpu.writeRegister('IP', 0);
      cpu.writeRegister('SS', 0); cpu.writeRegister('SP', 0xFFFE);
      const map = new Map(r.instructions.map(a => [a.address, a]));
      let threw: Error | null = null;
      let steps = 0;
      while (!cpu.getState().halted && steps < 10) {
        const ip = cpu.getState().IP;
        const ai = map.get(ip);
        if (!ai) break;
        try { cpu.execute(ai.instruction); } catch (e) { threw = e as Error; break; }
        if (cpu.getState().IP === ip) cpu.writeRegister('IP', (ip + ai.instruction.bytes.length) & 0xffff);
        steps++;
      }
      expect(threw?.message).toBe('Division by zero');
      expect(cpu.getState().halted).toBe(true);
    }
  });
});

describe('hardware INT/IRET round-trip + INTO + true-8086 counts', () => {
  it('INT n pushes FLAGS/CS/IP, vectors through 0000:4n, IRET returns with flags intact', () => {
    const cpu = run(`MOV AX,h
MOV [40h],AX
MOV AX,0
MOV [42h],AX
STI
STC
MOV AX,1234h
INT 10h
MOV BX,AX
HLT
h:
MOV AX,7777h
IRET`);
    expect(cpu.getState().AX).toBe(0x7777); // handler ran
    expect(cpu.getState().BX).toBe(0x7777); // returned past the INT
    expect(F(cpu, 'CF')).toBe(true);        // pushed FLAGS restored by IRET
    expect(F(cpu, 'IF')).toBe(true);        // STI state restored (INT clears IF meanwhile)
    expect(cpu.getState().SP).toBe(0xFFFE); // stack balanced
    expect(cpu.getState().CS).toBe(0);
  });
  it('INTO traps to vector 4 on OF=1, falls through on OF=0', () => {
    let cpu = run(`MOV AX,ov
MOV [10h],AX
MOV AX,0
MOV [12h],AX
MOV AL,7Fh
ADD AL,1
INTO
MOV BL,1
HLT
ov:
MOV AX,4242h
IRET`);
    expect(cpu.getState().AX).toBe(0x4242);
    expect(cpu.readRegister8('BL')).toBe(1); // returned to after INTO
    expect(cpu.getState().SP).toBe(0xFFFE);
    cpu = run('MOV AL,1\nADD AL,1\nINTO\nMOV BL,7\nHLT');
    expect(cpu.readRegister8('BL')).toBe(7); // no trap, fell through
  });
  it('INT 21h via step()/decode() runs the handler and lands past the INT', () => {
    // NOTE: hand-encoded machine code — the assembler's `bytes` are
    // (opcode-hint, length) stubs for the direct-execute harness, not
    // fetchable encodings, so decode()/step() tests must load real bytes.
    const stepRun = (bytes: number[], ip: number, setup?: (cpu: CPU) => void) => {
      const cpu = new CPU();
      let out = '';
      cpu.interruptHandler = createInterruptHandler({ writeChar: (c: string) => { out += c; }, readChar: () => null });
      cpu.loadAndJump(bytes, 0, ip);
      cpu.writeRegister('SS', 0); cpu.writeRegister('SP', 0xFFFE);
      if (setup) setup(cpu);
      let guard = 0;
      while (!cpu.getState().halted && guard++ < 40) { if (!cpu.step()) break; }
      return { cpu, out };
    };
    // Serviced vector: MOV AH,02h / MOV DL,'Q' / INT 21h / HLT
    let r = stepRun([0xB4, 0x02, 0xB2, 0x51, 0xCD, 0x21, 0xF4], 0x100);
    expect(r.out).toBe('Q');
    expect(r.cpu.getState().halted).toBe(true);
    // Hardware vector: STC / INT 10h / HLT with a bare-IRET handler at 0:0x200
    const install = (cpu: CPU) => {
      cpu.getMemory().write8(0x200, 0xCF);
      cpu.getMemory().write16(0x40, 0x200); cpu.getMemory().write16(0x42, 0);
      cpu.getMemory().write16(0x10, 0x200); cpu.getMemory().write16(0x12, 0);
    };
    r = stepRun([0xF9, 0xCD, 0x10, 0xF4], 0x300, install);
    expect(r.cpu.getState().halted).toBe(true);
    expect(r.cpu.getState().IP).toBe(0x304);
    expect(F(r.cpu, 'CF')).toBe(true); // pushed FLAGS restored by IRET
    expect(r.cpu.getState().SP).toBe(0xFFFE);
    // INTO with OF=1: MOV AX,7FFFh / INC AX / INTO / HLT → traps to vector 4
    r = stepRun([0xB8, 0xFF, 0x7F, 0x40, 0xCE, 0xF4], 0x400, install);
    expect(r.cpu.getState().halted).toBe(true);
    expect(r.cpu.getState().AX).toBe(0x8000);
    expect(r.cpu.getState().SP).toBe(0xFFFE);
    // INTO with OF=0 falls through to HLT
    r = stepRun([0xB8, 0x00, 0x00, 0x40, 0xCE, 0xF4], 0x500, install);
    expect(r.cpu.getState().halted).toBe(true);
    expect(r.cpu.getState().AX).toBe(1);
  });
  it('shift/rotate use the full 8-bit count (no 286 masking)', () => {
    let cpu = run('MOV AL,0FFh\nMOV CL,32\nSHL AL,CL\nHLT');
    expect(cpu.readRegister8('AL')).toBe(0); // masked impl would leave FFh
    expect(F(cpu, 'CF')).toBe(false);
    cpu = run('MOV AX,0FFFFh\nMOV CL,33\nSHR AX,CL\nHLT');
    expect(cpu.getState().AX).toBe(0); // masked impl would give 7FFFh
    cpu = run('MOV AL,81h\nMOV CL,40\nROL AL,CL\nHLT');
    expect(cpu.readRegister8('AL')).toBe(0x81); // 40 % 8 = 0 rotations
    expect(F(cpu, 'CF')).toBe(true);            // but raw count != 0 still sets CF
    cpu = run('MOV AL,0A5h\nCLC\nMOV CL,9\nRCL AL,CL\nHLT');
    expect(cpu.readRegister8('AL')).toBe(0xA5); // full 9-cycle period identity
    expect(F(cpu, 'CF')).toBe(false);
  });
});
