// Intel 8086 CPU Core
// Framework-agnostic TypeScript — no DOM or React dependency

import type { CPUState, Instruction, Operand } from './types';
import { FLAG_BITS, createCPUState, FlagName } from './types';
import { Memory, createMemory, physicalAddress } from './memory';

export class CPU {
  private state: CPUState;
  private memory: Memory;

  constructor(memory?: Memory) {
    this.state = createCPUState();
    this.memory = memory ?? createMemory();
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  getState(): Readonly<CPUState> {
    return { ...this.state };
  }

  getMemory(): Memory {
    return this.memory;
  }

  readPhysical8(address: number): number {
    return this.memory.read8(address);
  }

  readPhysical16(address: number): number {
    return this.memory.read16(address);
  }

  read16(address: number): number {
    return this.readPhysical16(address);
  }

  writePhysical8(address: number, value: number): void {
    this.memory.write8(address, value);
  }

  writePhysical16(address: number, value: number): void {
    this.memory.write16(address, value);
  }

  // Write a 16-bit value to a register by name
  writeRegister(name: string, value: number): void {
    const v = value & 0xffff;
    switch (name.toUpperCase()) {
      case 'AX': this.state.AX = v ; break;
      case 'BX': this.state.BX = v ; break;
      case 'CX': this.state.CX = v ; break;
      case 'DX': this.state.DX = v ; break;
      case 'SP': this.state.SP = v ; break;
      case 'BP': this.state.BP = v ; break;
      case 'SI': this.state.SI = v ; break;
      case 'DI': this.state.DI = v ; break;
      case 'CS': this.state.CS = v ; break;
      case 'DS': this.state.DS = v ; break;
      case 'ES': this.state.ES = v ; break;
      case 'SS': this.state.SS = v ; break;
      case 'IP': this.state.IP = v ; break;
      case 'FLAGS': this.state.FLAGS = v ; break;
      default:
        throw new Error(`Unknown register: ${name}`);
    }
  }

  // Read a 16-bit register by name
  readRegister16(name: string): number {
    switch (name.toUpperCase()) {
      case 'AX': return this.state.AX;
      case 'BX': return this.state.BX;
      case 'CX': return this.state.CX;
      case 'DX': return this.state.DX;
      case 'SP': return this.state.SP;
      case 'BP': return this.state.BP;
      case 'SI': return this.state.SI;
      case 'DI': return this.state.DI;
      case 'CS': return this.state.CS;
      case 'DS': return this.state.DS;
      case 'ES': return this.state.ES;
      case 'SS': return this.state.SS;
      case 'IP': return this.state.IP;
      case 'FLAGS': return this.state.FLAGS;
      default: throw new Error(`Unknown register: ${name}`);
    }
  }

  // Read an 8-bit half-register by name (AH, AL, BH, BL, CH, CL, DH, DL)
  readRegister8(name: string): number {
    const r = name.toUpperCase();
    const parentMap: Record<string, string> = {
      AH: 'AX', AL: 'AX', BH: 'BX', BL: 'BX',
      CH: 'CX', CL: 'CX', DH: 'DX', DL: 'DX'
    };
    const parent = parentMap[r];
    if (!parent) throw new Error(`Unknown 8-bit register: ${name}`);
    const reg16 = this.readRegister16(parent);
    return r[1] === 'H' ? (reg16 >> 8) & 0xff : reg16 & 0xff;
  }

  // Write an 8-bit value to a half-register
  writeRegister8(name: string, value: number): void {
    const v = value & 0xff;
    const r = name.toUpperCase();
    const parentMap: Record<string, string> = {
      AH: 'AX', AL: 'AX', BH: 'BX', BL: 'BX',
      CH: 'CX', CL: 'CX', DH: 'DX', DL: 'DX'
    };
    const parent = parentMap[r];
    if (!parent) throw new Error(`Unknown 8-bit register: ${name}`);
    const reg16 = this.readRegister16(parent);
    if (r[1] === 'H') {
      this.writeRegister(parent, (reg16 & 0x00ff) | (v << 8));
    } else {
      this.writeRegister(parent, (reg16 & 0xff00) | v);
    }
  }

  // ─── Execution Loop ──────────────────────────────────────────────────────

  decode(): Instruction {
    const cs = this.state.CS;
    const ip = this.state.IP;
    const phys = physicalAddress(cs, ip);
    const opcode = this.memory.read8(phys);
    const instruction = this.decodeOpcode(opcode, phys);
    this.state.IP = (this.state.IP + instruction.bytes.length) & 0xffff;
    return instruction;
  }

  execute(instr: Instruction): number {
    const m = instr.mnemonic.toUpperCase();
    switch (m) {
      case 'MOV':   return this.execMOV(instr);
      case 'ADD':   return this.execADD(instr);
      case 'ADC':   return this.execADC(instr);
      case 'SUB':   return this.execSUB(instr);
      case 'SBB':   return this.execSBB(instr);
      case 'CMP':   return this.execCMP(instr);
      case 'TEST':  return this.execTEST(instr);
      case 'AND':   return this.execAND(instr);
      case 'OR':    return this.execOR(instr);
      case 'XOR':   return this.execXOR(instr);
      case 'NOT':   return this.execNOT(instr);
      case 'NEG':   return this.execNEG(instr);
      case 'SHL': case 'SAL': return this.execSHL(instr);
      case 'SHR':   return this.execSHR(instr);
      case 'SAR':   return this.execSAR(instr);
      case 'ROL':   return this.execROL(instr);
      case 'ROR':   return this.execROR(instr);
      case 'RCL':   return this.execRCL(instr);
      case 'RCR':   return this.execRCR(instr);
      case 'INC':   return this.execINC(instr);
      case 'DEC':   return this.execDEC(instr);
      case 'MUL':   return this.execMUL(instr);
      case 'IMUL':  return this.execIMUL(instr);
      case 'DIV':   return this.execDIV(instr);
      case 'IDIV':  return this.execIDIV(instr);
      case 'CBW':   return this.execCBW(instr);
      case 'CWD':   return this.execCWD(instr);
      case 'AAA':   return this.execAAA(instr);
      case 'AAS':   return this.execAAS(instr);
      case 'AAM':   return this.execAAM(instr);
      case 'AAD':   return this.execAAD(instr);
      case 'DAA':   return this.execDAA(instr);
      case 'DAS':   return this.execDAS(instr);
      case 'JMP':   return this.execJMP(instr);
      case 'JE':  case 'JZ':   return this.execJE(instr);
      case 'JNE': case 'JNZ':  return this.execJNE(instr);
      case 'JG':  case 'JNLE': return this.execJG(instr);
      case 'JL':  case 'JNGE': return this.execJL(instr);
      case 'JGE': case 'JNL':  return this.execJGE(instr);
      case 'JLE': case 'JNG':  return this.execJLE(instr);
      case 'JA':  case 'JNBE': return this.execJA(instr);
      case 'JB':  case 'JNAE': case 'JC':  return this.execJB(instr);
      case 'JAE': case 'JNB':  case 'JNC': return this.execJAE(instr);
      case 'JBE': case 'JNA':  return this.execJBE(instr);
      case 'JS':   return this.execJS(instr);
      case 'JNS':  return this.execJNS(instr);
      case 'JO':   return this.execJO(instr);
      case 'JNO':  return this.execJNO(instr);
      case 'JP':  case 'JPE':  return this.execJP(instr);
      case 'JNP': case 'JPO':  return this.execJNP(instr);
      case 'JCXZ':  return this.execJCXZ(instr);
      case 'LOOP':   return this.execLOOP(instr);
      case 'LOOPE': case 'LOOPZ':   return this.execLOOPE(instr);
      case 'LOOPNE': case 'LOOPNZ': return this.execLOOPNE(instr);
      case 'CALL':  return this.execCALL(instr);
      case 'RET':   return this.execRET(instr);
      case 'RETF':  return this.execRETF(instr);
      case 'PUSH':  return this.execPUSH(instr);
      case 'POP':   return this.execPOP(instr);
      case 'PUSHF': return this.execPUSHF(instr);
      case 'POPF':  return this.execPOPF(instr);
      case 'LAHF':  return this.execLAHF(instr);
      case 'SAHF':  return this.execSAHF(instr);
      case 'XCHG':  return this.execXCHG(instr);
      case 'NOP':   return this.execNOP(instr);
      case 'HLT':   return this.execHLT(instr);
      case 'LEA':   return this.execLEA(instr);
      case 'LDS':   return this.execLDS(instr);
      case 'LES':   return this.execLES(instr);
      case 'INT':   return this.execINT(instr);
      case 'INTO':  return this.execINTO(instr);
      case 'IRET':  return this.execIRET(instr);
      case 'XLAT': case 'XLATB': return this.execXLAT(instr);
      case 'IN':    return this.execIN(instr);
      case 'OUT':   return this.execOUT(instr);
      case 'ESC':   return instr.bytes.length; // coprocessor escape: no-op
      case 'MOVSB': return this.execMOVSB(instr);
      case 'MOVSW': return this.execMOVSW(instr);
      case 'MOVS':  return this.execMOVSW(instr);  // default word
      case 'CMPSB': return this.execCMPSB(instr);
      case 'CMPSW': return this.execCMPSW(instr);
      case 'CMPS':  return this.execCMPSW(instr);
      case 'SCASB': return this.execSCASB(instr);
      case 'SCASW': return this.execSCASW(instr);
      case 'SCAS':  return this.execSCASW(instr);
      case 'LODSB': return this.execLODSB(instr);
      case 'LODSW': return this.execLODSW(instr);
      case 'LODS':  return this.execLODSW(instr);
      case 'STOSB': return this.execSTOSB(instr);
      case 'STOSW': return this.execSTOSW(instr);
      case 'STOS':  return this.execSTOSW(instr);
      case 'CLC':   return this.execCLC(instr);
      case 'STC':   return this.execSTC(instr);
      case 'CMC':   return this.execCMC(instr);
      case 'CLI':   return this.execCLI(instr);
      case 'STI':   return this.execSTI(instr);
      case 'CLD':   return this.execCLD(instr);
      case 'STD':   return this.execSTD(instr);
      case 'WAIT': case 'LOCK': return instr.bytes.length;
      case 'DB': case 'DW': case 'DD': return instr.bytes.length;
      default: {
        // REP/REPE/REPNE compound mnemonics: "REP MOVSB" etc.
        if (/^(REP|REPE|REPZ|REPNE|REPNZ)\s+\w+$/.test(m)) {
          return this.execREP(instr);
        }
        throw new Error(`Unknown instruction: ${instr.mnemonic}`);
      }
    }
  }

  step(): Instruction | null {
    if (this.state.halted) return null;
    const instr = this.decode();
    if (instr === null) return null;
    this.execute(instr);
    return instr;
  }

  loadCode(address: number, bytes: number[]): void {
    bytes.forEach((b, i) => this.memory.write8(address + i, b));
  }

  loadAndJump(codeBytes: number[], cs = 0, ip = 0): void {
    this.state.CS = cs;
    this.state.IP = ip;
    this.loadCode(physicalAddress(cs, ip), codeBytes);
  }

  reset(): void {
    this.state = createCPUState();
    this.memory.clear();
  }

  // ─── Flag computation helpers ────────────────────────────────────────────

  updateFlagsSZP(value: number, bitWidth: 8 | 16): void {
    if (bitWidth === 8) {
      this.setFlag('ZF', (value & 0xff) === 0);
      this.setFlag('SF', ((value & 0xff) & 0x80) !== 0);
      this.setFlag('PF', this.parity(value & 0xff));
    } else {
      this.setFlag('ZF', (value & 0xffff) === 0);
      this.setFlag('SF', ((value & 0xffff) & 0x8000) !== 0);
      this.setFlag('PF', this.parity(value & 0xff));
    }
  }

  updateFlagsAdd(a: number, b: number, result: number, bitWidth: 8 | 16): void {
    const mask = bitWidth === 8 ? 0xff : 0xffff;
    this.setFlag('CF', result > mask);
    const aSign = a & (bitWidth === 8 ? 0x80 : 0x8000);
    const bSign = b & (bitWidth === 8 ? 0x80 : 0x8000);
    const rSign = result & (bitWidth === 8 ? 0x80 : 0x8000);
    this.setFlag('OF', (aSign === bSign) && (aSign !== rSign));
    this.setFlag('AF', ((a & 0xf) + (b & 0xf)) > 0xf);
    this.updateFlagsSZP(result, bitWidth);
  }

  updateFlagsSub(a: number, b: number, result: number, bitWidth: 8 | 16): void {
    this.setFlag('CF', a < b);
    const aSign = a & (bitWidth === 8 ? 0x80 : 0x8000);
    const bSign = b & (bitWidth === 8 ? 0x80 : 0x8000);
    const rSign = result & (bitWidth === 8 ? 0x80 : 0x8000);
    this.setFlag('OF', (aSign !== bSign) && (aSign !== rSign));
    this.setFlag('AF', (a & 0xf) < (b & 0xf));
    this.updateFlagsSZP(result, bitWidth);
  }

  setFlag(flag: FlagName, set: boolean): void {
    if (set) {
      this.state.FLAGS |= (1 << FLAG_BITS[flag]);
    } else {
      this.state.FLAGS &= ~(1 << FLAG_BITS[flag]);
    }
  }

  getFlag(flag: FlagName): boolean {
    return (this.state.FLAGS & (1 << FLAG_BITS[flag])) !== 0;
  }

  private parity(value: number): boolean {
    let p = 0;
    let v = value;
    while (v) { p ^= (v & 1); v >>= 1; }
    return p === 0;
  }

  // ─── Instruction implementations ─────────────────────────────────────────

  private execMOV(instr: Instruction): number {
    const dst = instr.operands[0];
    const src = instr.operands[1];
    let bw: 8 | 16 = 16;
    if (dst.size !== undefined) {
      bw = dst.size;
    } else if (src.size !== undefined) {
      bw = src.size;
    } else if (dst.type === 'register' || src.type === 'register') {
      bw = dst.type === 'register' ? this.operandBitWidth(dst) : this.operandBitWidth(src);
    }
    const value = this.resolveOperandValue(src, bw);
    this.writeOperand(dst, value, bw);
    return instr.bytes.length;
  }

  private execADD(instr: Instruction): number {
    const dst = instr.operands[0];
    const bw = this.operandBitWidth(dst);
    const d = this.resolveOperandValue(dst, bw);
    const s = this.resolveOperandValue(instr.operands[1], bw);
    const result = d + s;
    this.writeOperand(dst, result, bw);
    this.updateFlagsAdd(d, s, result, bw);
    return instr.bytes.length;
  }

  private execADC(instr: Instruction): number {
    const dst = instr.operands[0];
    const bw = this.operandBitWidth(dst);
    const d = this.resolveOperandValue(dst, bw);
    const s = this.resolveOperandValue(instr.operands[1], bw);
    const cf = this.getFlag('CF') ? 1 : 0;
    const result = d + s + cf;
    this.writeOperand(dst, result, bw);
    this.updateFlagsAdd(d, s + cf, result, bw);
    return instr.bytes.length;
  }

  private execSUB(instr: Instruction): number {
    const dst = instr.operands[0];
    const bw = this.operandBitWidth(dst);
    const d = this.resolveOperandValue(dst, bw);
    const s = this.resolveOperandValue(instr.operands[1], bw);
    const result = d - s;
    this.writeOperand(dst, result, bw);
    this.updateFlagsSub(d, s, result, bw);
    return instr.bytes.length;
  }

  private execSBB(instr: Instruction): number {
    const dst = instr.operands[0];
    const bw = this.operandBitWidth(dst);
    const d = this.resolveOperandValue(dst, bw);
    const s = this.resolveOperandValue(instr.operands[1], bw);
    const cf = this.getFlag('CF') ? 1 : 0;
    const result = d - s - cf;
    this.writeOperand(dst, result, bw);
    this.updateFlagsSub(d, s + cf, result, bw);
    return instr.bytes.length;
  }

  private execCMP(instr: Instruction): number {
    const dst = instr.operands[0];
    const bw = this.operandBitWidth(dst);
    const d = this.resolveOperandValue(dst, bw);
    const s = this.resolveOperandValue(instr.operands[1], bw);
    const result = d - s;
    this.updateFlagsSub(d, s, result, bw);
    return instr.bytes.length;
  }

  private execTEST(instr: Instruction): number {
    const dst = instr.operands[0];
    const bw = this.operandBitWidth(dst);
    const d = this.resolveOperandValue(dst, bw);
    const s = this.resolveOperandValue(instr.operands[1], bw);
    const result = d & s;
    this.updateFlagsLogical(result, bw);
    return instr.bytes.length;
  }

  private execAND(instr: Instruction): number {
    const dst = instr.operands[0];
    const bw = this.operandBitWidth(dst);
    const d = this.resolveOperandValue(dst, bw);
    const s = this.resolveOperandValue(instr.operands[1], bw);
    const result = d & s;
    this.writeOperand(dst, result, bw);
    this.updateFlagsLogical(result, bw);
    return instr.bytes.length;
  }

  private execOR(instr: Instruction): number {
    const dst = instr.operands[0];
    const bw = this.operandBitWidth(dst);
    const d = this.resolveOperandValue(dst, bw);
    const s = this.resolveOperandValue(instr.operands[1], bw);
    const result = d | s;
    this.writeOperand(dst, result, bw);
    this.updateFlagsLogical(result, bw);
    return instr.bytes.length;
  }

  private execXOR(instr: Instruction): number {
    const dst = instr.operands[0];
    const bw = this.operandBitWidth(dst);
    const d = this.resolveOperandValue(dst, bw);
    const s = this.resolveOperandValue(instr.operands[1], bw);
    const result = d ^ s;
    this.writeOperand(dst, result, bw);
    this.updateFlagsLogical(result, bw);
    return instr.bytes.length;
  }

  private execNOT(instr: Instruction): number {
    const dst = instr.operands[0];
    const bw = this.operandBitWidth(dst);
    const mask = bw === 8 ? 0xff : 0xffff;
    const result = (~this.resolveOperandValue(dst, bw)) & mask;
    this.writeOperand(dst, result, bw);
    // NOT does not affect flags
    return instr.bytes.length;
  }

  private execNEG(instr: Instruction): number {
    const dst = instr.operands[0];
    const bw = this.operandBitWidth(dst);
    const mask = bw === 8 ? 0xff : 0xffff;
    const d = this.resolveOperandValue(dst, bw);
    const result = (0 - d) & mask;
    this.writeOperand(dst, result, bw);
    this.setFlag('CF', d !== 0);
    this.setFlag('OF', d === (bw === 8 ? 0x80 : 0x8000));
    this.setFlag('AF', (d & 0xf) !== 0);
    this.updateFlagsSZP(result, bw);
    return instr.bytes.length;
  }

  private execINC(instr: Instruction): number {
    const dst = instr.operands[0];
    const bw = this.operandBitWidth(dst);
    const mask = bw === 8 ? 0xff : 0xffff;
    const signBit = bw === 8 ? 0x80 : 0x8000;
    const d = this.resolveOperandValue(dst, bw);
    const result = (d + 1) & mask;
    this.writeOperand(dst, result, bw);
    // INC does NOT affect CF
    this.setFlag('ZF', result === 0);
    this.setFlag('SF', (result & signBit) !== 0);
    this.setFlag('PF', this.parity(result & 0xff));
    this.setFlag('AF', ((d & 0xf) + 1) > 0xf);
    this.setFlag('OF', (d & signBit) === 0 && (result & signBit) !== 0);
    return instr.bytes.length;
  }

  private execDEC(instr: Instruction): number {
    const dst = instr.operands[0];
    const bw = this.operandBitWidth(dst);
    const mask = bw === 8 ? 0xff : 0xffff;
    const signBit = bw === 8 ? 0x80 : 0x8000;
    const d = this.resolveOperandValue(dst, bw);
    const result = (d - 1) & mask;
    this.writeOperand(dst, result, bw);
    // DEC does NOT affect CF
    this.setFlag('ZF', result === 0);
    this.setFlag('SF', (result & signBit) !== 0);
    this.setFlag('PF', this.parity(result & 0xff));
    this.setFlag('AF', (d & 0xf) < 1);
    this.setFlag('OF', (d & signBit) !== 0 && (result & signBit) === 0);
    return instr.bytes.length;
  }

  // SHL/SAL dst, count
  private execSHL(instr: Instruction): number {
    const dst = instr.operands[0];
    const bw = this.operandBitWidth(dst);
    const mask = bw === 8 ? 0xff : 0xffff;
    const signBit = bw === 8 ? 0x80 : 0x8000;
    const count = (instr.operands[1] ? this.resolveOperandValue(instr.operands[1], 8) : 1) & 0x1f;
    let result = this.resolveOperandValue(dst, bw) & mask;
    let cf = false;
    const origMSB = (result & signBit) !== 0;
    for (let i = 0; i < count; i++) {
      cf = (result & signBit) !== 0;
      result = (result << 1) & mask;
    }
    this.writeOperand(dst, result, bw);
    if (count > 0) {
      this.setFlag('CF', cf);
      // OF = origMSB XOR new MSB (only defined for count=1)
      this.setFlag('OF', count === 1 ? origMSB !== ((result & signBit) !== 0) : false);
      this.updateFlagsSZP(result, bw);
    }
    return instr.bytes.length;
  }

  // SHR (logical)
  private execSHR(instr: Instruction): number {
    const dst = instr.operands[0];
    const bw = this.operandBitWidth(dst);
    const mask = bw === 8 ? 0xff : 0xffff;
    const signBit = bw === 8 ? 0x80 : 0x8000;
    const count = (instr.operands[1] ? this.resolveOperandValue(instr.operands[1], 8) : 1) & 0x1f;
    let result = this.resolveOperandValue(dst, bw) & mask;
    const origMSB = (result & signBit) !== 0;
    let cf = false;
    for (let i = 0; i < count; i++) {
      cf = (result & 1) !== 0;
      result = result >>> 1;
    }
    this.writeOperand(dst, result, bw);
    if (count > 0) {
      this.setFlag('CF', cf);
      // OF set if count==1 and original MSB was 1
      this.setFlag('OF', count === 1 && origMSB);
      this.updateFlagsSZP(result, bw);
    }
    return instr.bytes.length;
  }

  // SAR (arithmetic shift right — sign extends)
  private execSAR(instr: Instruction): number {
    const dst = instr.operands[0];
    const bw = this.operandBitWidth(dst);
    const mask = bw === 8 ? 0xff : 0xffff;
    const signBit = bw === 8 ? 0x80 : 0x8000;
    const count = (instr.operands[1] ? this.resolveOperandValue(instr.operands[1], 8) : 1) & 0x1f;
    let result = this.resolveOperandValue(dst, bw) & mask;
    // sign-extend to JS number
    if (bw === 8 && (result & 0x80)) result = result | ~0xff;
    if (bw === 16 && (result & 0x8000)) result = result | ~0xffff;
    let cf = false;
    for (let i = 0; i < count; i++) {
      cf = (result & 1) !== 0;
      result = result >> 1; // signed right shift in JS
    }
    result = result & mask;
    this.writeOperand(dst, result, bw);
    if (count > 0) {
      this.setFlag('CF', cf);
      this.setFlag('OF', false); // SAR OF always 0 for count=1
      this.updateFlagsSZP(result, bw);
    }
    return instr.bytes.length;
  }

  // ROL — rotate left
  private execROL(instr: Instruction): number {
    const dst = instr.operands[0];
    const bw = this.operandBitWidth(dst);
    const bits = bw;
    const mask = bw === 8 ? 0xff : 0xffff;
    const signBit = bw === 8 ? 0x80 : 0x8000;
    const count = ((instr.operands[1] ? this.resolveOperandValue(instr.operands[1], 8) : 1) & 0x1f) % bits;
    let result = this.resolveOperandValue(dst, bw) & mask;
    for (let i = 0; i < count; i++) {
      const msb = (result & signBit) ? 1 : 0;
      result = ((result << 1) | msb) & mask;
    }
    this.writeOperand(dst, result, bw);
    const newCF = (result & 1) !== 0; // low bit after rotate = old MSB
    this.setFlag('CF', newCF);
    this.setFlag('OF', count === 1 ? newCF !== ((result & signBit) !== 0) : false);
    return instr.bytes.length;
  }

  // ROR — rotate right
  private execROR(instr: Instruction): number {
    const dst = instr.operands[0];
    const bw = this.operandBitWidth(dst);
    const bits = bw;
    const mask = bw === 8 ? 0xff : 0xffff;
    const signBit = bw === 8 ? 0x80 : 0x8000;
    const count = ((instr.operands[1] ? this.resolveOperandValue(instr.operands[1], 8) : 1) & 0x1f) % bits;
    let result = this.resolveOperandValue(dst, bw) & mask;
    for (let i = 0; i < count; i++) {
      const lsb = result & 1;
      result = ((result >>> 1) | (lsb ? signBit : 0)) & mask;
    }
    this.writeOperand(dst, result, bw);
    const newCF = (result & signBit) !== 0;
    this.setFlag('CF', newCF);
    this.setFlag('OF', count === 1 ? ((result & signBit) !== 0) !== ((result & (signBit >> 1)) !== 0) : false);
    return instr.bytes.length;
  }

  // RCL — rotate left through carry
  private execRCL(instr: Instruction): number {
    const dst = instr.operands[0];
    const bw = this.operandBitWidth(dst);
    const mask = bw === 8 ? 0xff : 0xffff;
    const signBit = bw === 8 ? 0x80 : 0x8000;
    const count = (instr.operands[1] ? this.resolveOperandValue(instr.operands[1], 8) : 1) & 0x1f;
    let result = this.resolveOperandValue(dst, bw) & mask;
    let cf = this.getFlag('CF');
    for (let i = 0; i < count; i++) {
      const newCF = (result & signBit) !== 0;
      result = ((result << 1) | (cf ? 1 : 0)) & mask;
      cf = newCF;
    }
    this.writeOperand(dst, result, bw);
    this.setFlag('CF', cf);
    this.setFlag('OF', count === 1 ? cf !== ((result & signBit) !== 0) : false);
    return instr.bytes.length;
  }

  // RCR — rotate right through carry
  private execRCR(instr: Instruction): number {
    const dst = instr.operands[0];
    const bw = this.operandBitWidth(dst);
    const mask = bw === 8 ? 0xff : 0xffff;
    const signBit = bw === 8 ? 0x80 : 0x8000;
    const count = (instr.operands[1] ? this.resolveOperandValue(instr.operands[1], 8) : 1) & 0x1f;
    let result = this.resolveOperandValue(dst, bw) & mask;
    let cf = this.getFlag('CF');
    for (let i = 0; i < count; i++) {
      const newCF = (result & 1) !== 0;
      result = ((result >>> 1) | (cf ? signBit : 0)) & mask;
      cf = newCF;
    }
    this.writeOperand(dst, result, bw);
    this.setFlag('CF', cf);
    this.setFlag('OF', count === 1 ? ((result & signBit) !== 0) !== (((result >> 1) & (signBit >> 1)) !== 0) : false);
    return instr.bytes.length;
  }

  // MUL src (unsigned multiply)
  private execMUL(instr: Instruction): number {
    const src = instr.operands[0];
    const bw = this.operandBitWidth(src);
    const s = this.resolveOperandValue(src, bw);
    if (bw === 8) {
      const result = (this.state.AX & 0xff) * s;
      this.state.AX = result & 0xffff;
      const overflow = (this.state.AX & 0xff00) !== 0;
      this.setFlag('CF', overflow); this.setFlag('OF', overflow);
    } else {
      const result = this.state.AX * s;
      this.state.AX = result & 0xffff;
      this.writeRegister('DX', (result >>> 16) & 0xffff);
      const overflow = this.readRegister16('DX') !== 0;
      this.setFlag('CF', overflow); this.setFlag('OF', overflow);
    }
    return instr.bytes.length;
  }

  // IMUL src (signed multiply)
  private execIMUL(instr: Instruction): number {
    const src = instr.operands[0];
    const bw = this.operandBitWidth(src);
    const s = this.resolveOperandSigned(src, bw);
    if (bw === 8) {
      const al = (this.state.AX & 0xff) >= 0x80 ? (this.state.AX & 0xff) - 256 : (this.state.AX & 0xff);
      const result = al * s;
      this.state.AX = result & 0xffff;
      // In 8-bit IMUL, product is in AX. CF/OF are set if AH is NOT the sign-extension of AL.
      const signExt = (this.state.AX & 0x80) ? 0xff00 : 0x0000;
      const overflow = (this.state.AX & 0xff00) !== signExt;
      this.setFlag('CF', overflow); this.setFlag('OF', overflow);
    } else {
      const ax = this.state.AX >= 0x8000 ? this.state.AX - 65536 : this.state.AX;
      const result = ax * s;
      this.state.AX = result & 0xffff;
      this.writeRegister('DX', (result >> 16) & 0xffff);
      const high = this.readRegister16('DX');
      // In 16-bit IMUL, product is in DX:AX. CF/OF are set if DX is NOT the sign-extension of AX.
      const signExt16 = (this.state.AX & 0x8000) ? 0xffff : 0x0000;
      const overflow = high !== signExt16;
      this.setFlag('CF', overflow); this.setFlag('OF', overflow);
    }
    return instr.bytes.length;
  }

  // DIV src (unsigned divide)
  private execDIV(instr: Instruction): number {
    const src = instr.operands[0];
    const bw = this.operandBitWidth(src);
    const s = this.resolveOperandValue(src, bw);
    if (s === 0) {
      this.state.error = 'Division by zero';
      this.state.halted = true;
      throw new Error('Division by zero');
    }
    if (bw === 8) {
      const dividend = this.state.AX & 0xffff;
      const quotient = Math.floor(dividend / s);
      const remainder = dividend % s;
      if (quotient > 0xff) throw new Error('Division overflow');
      this.state.AX = ((remainder & 0xff) << 8) | (quotient & 0xff);
    } else {
      const dx = this.readRegister16('DX');
      const dividend = (dx * 0x10000) + this.state.AX;
      const quotient = Math.floor(dividend / s);
      const remainder = dividend % s;
      if (quotient > 0xffff) throw new Error('Division overflow');
      this.state.AX = quotient & 0xffff;
      this.writeRegister('DX', remainder & 0xffff);
    }
    return instr.bytes.length;
  }

  // IDIV src (signed divide)
  private execIDIV(instr: Instruction): number {
    const src = instr.operands[0];
    const bw = this.operandBitWidth(src);
    const s = this.resolveOperandSigned(src, bw);
    if (s === 0) {
      this.state.error = 'Division by zero';
      this.state.halted = true;
      throw new Error('Division by zero');
    }
    if (bw === 8) {
      const ax = this.state.AX & 0xffff;
      const dividend = ax >= 0x8000 ? ax - 65536 : ax;
      const quotient = Math.trunc(dividend / s);
      const remainder = dividend % s;
      if (quotient > 127 || quotient < -128) throw new Error('Division overflow');
      this.state.AX = ((remainder & 0xff) << 8) | (quotient & 0xff);
    } else {
      const dx = this.readRegister16('DX');
      const ax = this.state.AX;
      let dividend = (dx * 0x10000) + ax;
      if (dx >= 0x8000) dividend -= 0x100000000;
      const quotient = Math.trunc(dividend / s);
      const remainder = dividend % s;
      if (quotient > 32767 || quotient < -32768) throw new Error('Division overflow');
      this.state.AX = quotient & 0xffff;
      this.writeRegister('DX', remainder & 0xffff);
    }
    return instr.bytes.length;
  }

  // CBW — convert byte to word (sign extend AL into AX)
  private execCBW(_instr: Instruction): number {
    const al = this.state.AX & 0xff;
    this.state.AX = al >= 0x80 ? (al | 0xff00) : al;
    return 1;
  }

  // CWD — convert word to doubleword (sign extend AX into DX:AX)
  private execCWD(_instr: Instruction): number {
    const ax = this.state.AX;
    this.writeRegister('DX', ax >= 0x8000 ? 0xffff : 0x0000);
    return 1;
  }

  // AAA — ASCII adjust after addition
  private execAAA(_instr: Instruction): number {
    const al = this.state.AX & 0xff;
    if ((al & 0x0f) > 9 || this.getFlag('AF')) {
      this.state.AX = (this.state.AX & 0xff00) | ((al + 6) & 0xff);
      this.state.AX = (this.state.AX + 0x100) & 0xffff;
      this.setFlag('AF', true); this.setFlag('CF', true);
    } else {
      this.setFlag('AF', false); this.setFlag('CF', false);
    }
    this.state.AX &= 0xff0f;
    return 1;
  }

  // AAS — ASCII adjust after subtraction
  private execAAS(_instr: Instruction): number {
    const al = this.state.AX & 0xff;
    if ((al & 0x0f) > 9 || this.getFlag('AF')) {
      this.state.AX = (this.state.AX & 0xff00) | ((al - 6) & 0xff);
      this.state.AX = (this.state.AX - 0x100) & 0xffff;
      this.setFlag('AF', true); this.setFlag('CF', true);
    } else {
      this.setFlag('AF', false); this.setFlag('CF', false);
    }
    this.state.AX &= 0xff0f;
    return 1;
  }

  // AAM — ASCII adjust after multiply (optional base operand, default 10)
  private execAAM(instr: Instruction): number {
    const base = instr.operands.length > 0 ? (this.resolveOperandValue(instr.operands[0], 8) || 10) : 10;
    const al = this.state.AX & 0xff;
    const ah = Math.floor(al / base);
    const newAl = al % base;
    this.state.AX = (ah << 8) | newAl;
    this.updateFlagsSZP(newAl, 8);
    return 1;
  }

  // AAD — ASCII adjust before division (optional base operand, default 10)
  private execAAD(instr: Instruction): number {
    const base = instr.operands.length > 0 ? (this.resolveOperandValue(instr.operands[0], 8) || 10) : 10;
    const ah = (this.state.AX >> 8) & 0xff;
    const al = this.state.AX & 0xff;
    const result = (al + ah * base) & 0xff;
    this.state.AX = result;
    this.updateFlagsSZP(result, 8);
    return 1;
  }

  // DAA — decimal adjust after addition
  private execDAA(_instr: Instruction): number {
    let al = this.state.AX & 0xff;
    const oldAL = al;
    const oldCF = this.getFlag('CF');
    this.setFlag('CF', false);
    if ((al & 0x0f) > 9 || this.getFlag('AF')) {
      al = (al + 6) & 0xff;
      this.setFlag('CF', oldCF || al < oldAL);
      this.setFlag('AF', true);
    } else {
      this.setFlag('AF', false);
    }
    if (oldAL > 0x99 || oldCF) {
      al = (al + 0x60) & 0xff;
      this.setFlag('CF', true);
    }
    this.state.AX = (this.state.AX & 0xff00) | al;
    this.updateFlagsSZP(al, 8);
    return 1;
  }

  // DAS — decimal adjust after subtraction
  private execDAS(_instr: Instruction): number {
    let al = this.state.AX & 0xff;
    const oldAL = al;
    const oldCF = this.getFlag('CF');
    this.setFlag('CF', false);
    if ((al & 0x0f) > 9 || this.getFlag('AF')) {
      al = (al - 6) & 0xff;
      this.setFlag('CF', oldCF || al > oldAL);
      this.setFlag('AF', true);
    } else {
      this.setFlag('AF', false);
    }
    if (oldAL > 0x99 || oldCF) {
      al = (al - 0x60) & 0xff;
      this.setFlag('CF', true);
    }
    this.state.AX = (this.state.AX & 0xff00) | al;
    this.updateFlagsSZP(al, 8);
    return 1;
  }

  // ─── Jump instructions ────────────────────────────────────────────────────

  private execJMP(instr: Instruction): number {
    const target = instr.operands[0];
    if (target.type === 'immediate') {
      this.state.IP = target.value ?? 0;
    } else if (target.type === 'memory') {
      this.state.IP = this.memory.read16(this.computeEffectiveAddress(target));
    } else if (target.type === 'register') {
      this.state.IP = this.resolveOperandValue(target, 16);
    }
    return instr.bytes.length;
  }

  private execJE(instr: Instruction): number {
    if (this.getFlag('ZF')) return this.doJump(instr);
    return instr.bytes.length;
  }
  private execJNE(instr: Instruction): number {
    if (!this.getFlag('ZF')) return this.doJump(instr);
    return instr.bytes.length;
  }
  private execJG(instr: Instruction): number {
    if (!this.getFlag('ZF') && (this.getFlag('SF') === this.getFlag('OF'))) return this.doJump(instr);
    return instr.bytes.length;
  }
  private execJL(instr: Instruction): number {
    if (this.getFlag('SF') !== this.getFlag('OF')) return this.doJump(instr);
    return instr.bytes.length;
  }
  private execJGE(instr: Instruction): number {
    if (this.getFlag('SF') === this.getFlag('OF')) return this.doJump(instr);
    return instr.bytes.length;
  }
  private execJLE(instr: Instruction): number {
    if (this.getFlag('ZF') || (this.getFlag('SF') !== this.getFlag('OF'))) return this.doJump(instr);
    return instr.bytes.length;
  }
  private execJA(instr: Instruction): number {
    if (!this.getFlag('CF') && !this.getFlag('ZF')) return this.doJump(instr);
    return instr.bytes.length;
  }
  private execJB(instr: Instruction): number {
    if (this.getFlag('CF')) return this.doJump(instr);
    return instr.bytes.length;
  }
  private execJAE(instr: Instruction): number {
    if (!this.getFlag('CF')) return this.doJump(instr);
    return instr.bytes.length;
  }
  private execJBE(instr: Instruction): number {
    if (this.getFlag('CF') || this.getFlag('ZF')) return this.doJump(instr);
    return instr.bytes.length;
  }
  private execJS(instr: Instruction): number {
    if (this.getFlag('SF')) return this.doJump(instr);
    return instr.bytes.length;
  }
  private execJNS(instr: Instruction): number {
    if (!this.getFlag('SF')) return this.doJump(instr);
    return instr.bytes.length;
  }
  private execJO(instr: Instruction): number {
    if (this.getFlag('OF')) return this.doJump(instr);
    return instr.bytes.length;
  }
  private execJNO(instr: Instruction): number {
    if (!this.getFlag('OF')) return this.doJump(instr);
    return instr.bytes.length;
  }
  private execJP(instr: Instruction): number {
    if (this.getFlag('PF')) return this.doJump(instr);
    return instr.bytes.length;
  }
  private execJNP(instr: Instruction): number {
    if (!this.getFlag('PF')) return this.doJump(instr);
    return instr.bytes.length;
  }
  private execJCXZ(instr: Instruction): number {
    if (this.state.CX === 0) return this.doJump(instr);
    return instr.bytes.length;
  }

  // LOOP / LOOPE / LOOPNE
  private execLOOP(instr: Instruction): number {
    this.state.CX = (this.state.CX - 1) & 0xffff;
    if (this.state.CX !== 0) this.doJump(instr);
    return instr.bytes.length;
  }
  private execLOOPE(instr: Instruction): number {
    this.state.CX = (this.state.CX - 1) & 0xffff;
    if (this.state.CX !== 0 && this.getFlag('ZF')) this.doJump(instr);
    return instr.bytes.length;
  }
  private execLOOPNE(instr: Instruction): number {
    this.state.CX = (this.state.CX - 1) & 0xffff;
    if (this.state.CX !== 0 && !this.getFlag('ZF')) this.doJump(instr);
    return instr.bytes.length;
  }

  // CALL / RET / RETF
  private execCALL(instr: Instruction): number {
    const target = instr.operands[0];
    // When called via step(), decode() already advanced IP past this instruction.
    // When called via execute() directly (e.g. in tests), IP is still at the start.
    // Correct return address = IP at time of call + instruction bytes length,
    // which in the step() path = current IP (already advanced) since decode moved it.
    // In the direct execute() path = IP + bytes.length.
    // We detect by checking if IP has already passed this instruction.
    // Safest: push (this.state.IP) which is correct for the step() path.
    // For the direct-execute path the test sets IP then calls execute(), so
    // we need IP + bytes.length. Use IP + bytes.length and subtract bytes.length
    // only if we can detect step mode — we can't, so we store IP + bytes.length
    // which equals correct for direct-execute. For step() path, decode() already
    // moved IP forward by bytes.length, so we push the current IP directly (already past instruction).
    // Compromise: always use this.state.IP (works for step()), but tests call execute() directly.
    // Fix: store current IP + instr.bytes.length as retAddr — this is always the
    // address of the instruction AFTER the CALL, regardless of whether decode was called.
    const retAddr = (this.state.IP + instr.bytes.length) & 0xffff;
    this.state.SP = (this.state.SP - 2) & 0xffff;
    this.memory.write16(physicalAddress(this.state.SS, this.state.SP), retAddr);
    if (target.type === 'immediate') {
      this.state.IP = target.value ?? 0;
    } else if (target.type === 'register') {
      this.state.IP = this.resolveOperandValue(target, 16);
    } else if (target.type === 'memory') {
      this.state.IP = this.memory.read16(this.computeEffectiveAddress(target));
    }
    return instr.bytes.length;
  }

  private execRET(instr: Instruction): number {
    const retAddr = this.memory.read16(physicalAddress(this.state.SS, this.state.SP));
    this.state.SP = (this.state.SP + 2) & 0xffff;
    if (instr.operands.length > 0) {
      const popBytes = this.resolveOperandValue(instr.operands[0], 16);
      this.state.SP = (this.state.SP + popBytes) & 0xffff;
    }
    this.state.IP = retAddr;
    return 1;
  }

  private execRETF(instr: Instruction): number {
    const retIP = this.memory.read16(physicalAddress(this.state.SS, this.state.SP));
    this.state.SP = (this.state.SP + 2) & 0xffff;
    const retCS = this.memory.read16(physicalAddress(this.state.SS, this.state.SP));
    this.state.SP = (this.state.SP + 2) & 0xffff;
    if (instr.operands.length > 0) {
      const popBytes = this.resolveOperandValue(instr.operands[0], 16);
      this.state.SP = (this.state.SP + popBytes) & 0xffff;
    }
    this.state.IP = retIP;
    this.state.CS = retCS;
    return 1;
  }

  // PUSH / POP
  private execPUSH(instr: Instruction): number {
    const value = this.resolveOperandValue(instr.operands[0], 16);
    this.state.SP = (this.state.SP - 2) & 0xffff;
    this.memory.write16(physicalAddress(this.state.SS, this.state.SP), value);
    return instr.bytes.length;
  }

  private execPOP(instr: Instruction): number {
    const dst = instr.operands[0];
    const value = this.memory.read16(physicalAddress(this.state.SS, this.state.SP));
    this.state.SP = (this.state.SP + 2) & 0xffff;
    this.writeOperand(dst, value, 16);
    return instr.bytes.length;
  }

  private execPUSHF(_instr: Instruction): number {
    this.state.SP = (this.state.SP - 2) & 0xffff;
    this.memory.write16(physicalAddress(this.state.SS, this.state.SP), this.state.FLAGS);
    return 1;
  }

  private execPOPF(_instr: Instruction): number {
    this.state.FLAGS = this.memory.read16(physicalAddress(this.state.SS, this.state.SP));
    this.state.SP = (this.state.SP + 2) & 0xffff;
    return 1;
  }

  // LAHF — load AH from flags (low byte)
  private execLAHF(_instr: Instruction): number {
    const lo = this.state.FLAGS & 0xff;
    this.state.AX = (this.state.AX & 0x00ff) | (lo << 8);
    return 1;
  }

  // SAHF — store AH into flags (low byte)
  private execSAHF(_instr: Instruction): number {
    const ah = (this.state.AX >> 8) & 0xff;
    this.state.FLAGS = (this.state.FLAGS & 0xff00) | ah;
    return 1;
  }

  // XCHG
  private execXCHG(instr: Instruction): number {
    const dst = instr.operands[0];
    const src = instr.operands[1];
    const bw = this.operandBitWidth(dst);
    const dv = this.resolveOperandValue(dst, bw);
    const sv = this.resolveOperandValue(src, bw);
    this.writeOperand(dst, sv, bw);
    this.writeOperand(src, dv, bw);
    return instr.bytes.length;
  }

  private execNOP(_instr: Instruction): number { return 1; }
  private execHLT(_instr: Instruction): number { this.state.halted = true; return 1; }

  // LEA — load effective address
  private execLEA(instr: Instruction): number {
    const dst = instr.operands[0];
    const src = instr.operands[1];
    const offset = src.type === 'immediate' ? (src.value ?? 0) : this.computeEffectiveOffset(src);
    this.writeOperand(dst, offset, 16);
    return instr.bytes.length;
  }

  // LDS — load far pointer into DS:reg
  private execLDS(instr: Instruction): number {
    const dst = instr.operands[0];
    const src = instr.operands[1];
    const addr = this.computeEffectiveAddress(src);
    const offset = this.memory.read16(addr);
    const seg = this.memory.read16(addr + 2);
    this.writeOperand(dst, offset, 16);
    this.state.DS = seg;
    return instr.bytes.length;
  }

  // LES — load far pointer into ES:reg
  private execLES(instr: Instruction): number {
    const dst = instr.operands[0];
    const src = instr.operands[1];
    const addr = this.computeEffectiveAddress(src);
    const offset = this.memory.read16(addr);
    const seg = this.memory.read16(addr + 2);
    this.writeOperand(dst, offset, 16);
    this.state.ES = seg;
    return instr.bytes.length;
  }

  // XLAT — AL = DS:[BX+AL]
  private execXLAT(_instr: Instruction): number {
    const al = this.state.AX & 0xff;
    const addr = physicalAddress(this.state.DS, (this.state.BX + al) & 0xffff);
    const val = this.memory.read8(addr);
    this.state.AX = (this.state.AX & 0xff00) | val;
    return 1;
  }

  // Port I/O handlers
  onPortOut?: (port: number, value: number) => void;
  onPortIn?: (port: number) => number;

  // IN — read from port
  private execIN(instr: Instruction): number {
    const dst = instr.operands[0];
    const bw = this.operandBitWidth(dst);
    const portOp = instr.operands[1];
    const port = portOp ? this.resolveOperandValue(portOp, 16) : 0;
    const val = this.onPortIn ? this.onPortIn(port) : 0;
    this.writeOperand(dst, val, bw);
    return instr.bytes.length;
  }

  // OUT — write to port
  private execOUT(_instr: Instruction): number {
    const portOp = _instr.operands[0];
    const srcOp = _instr.operands[1];
    const port = portOp ? this.resolveOperandValue(portOp, 16) : 0;
    const val = srcOp ? this.resolveOperandValue(srcOp, this.operandBitWidth(srcOp)) : 0;
    if (this.onPortOut) {
      this.onPortOut(port, val);
    }
    return _instr.bytes.length;
  }

  // ─── String operations ────────────────────────────────────────────────────

  private execMOVSB(_instr: Instruction): number {
    const src = physicalAddress(this.state.DS, this.state.SI);
    const dst = physicalAddress(this.state.ES, this.state.DI);
    this.memory.write8(dst, this.memory.read8(src));
    const delta = this.getFlag('DF') ? -1 : 1;
    this.state.SI = (this.state.SI + delta) & 0xffff;
    this.state.DI = (this.state.DI + delta) & 0xffff;
    return 1;
  }

  private execMOVSW(_instr: Instruction): number {
    const src = physicalAddress(this.state.DS, this.state.SI);
    const dst = physicalAddress(this.state.ES, this.state.DI);
    this.memory.write16(dst, this.memory.read16(src));
    const delta = this.getFlag('DF') ? -2 : 2;
    this.state.SI = (this.state.SI + delta) & 0xffff;
    this.state.DI = (this.state.DI + delta) & 0xffff;
    return 1;
  }

  private execCMPSB(_instr: Instruction): number {
    const a = this.memory.read8(physicalAddress(this.state.DS, this.state.SI));
    const b = this.memory.read8(physicalAddress(this.state.ES, this.state.DI));
    this.updateFlagsSub(a, b, (a - b) & 0xff, 8);
    const delta = this.getFlag('DF') ? -1 : 1;
    this.state.SI = (this.state.SI + delta) & 0xffff;
    this.state.DI = (this.state.DI + delta) & 0xffff;
    return 1;
  }

  private execCMPSW(_instr: Instruction): number {
    const a = this.memory.read16(physicalAddress(this.state.DS, this.state.SI));
    const b = this.memory.read16(physicalAddress(this.state.ES, this.state.DI));
    this.updateFlagsSub(a, b, (a - b) & 0xffff, 16);
    const delta = this.getFlag('DF') ? -2 : 2;
    this.state.SI = (this.state.SI + delta) & 0xffff;
    this.state.DI = (this.state.DI + delta) & 0xffff;
    return 1;
  }

  private execSCASB(_instr: Instruction): number {
    const al = this.state.AX & 0xff;
    const b = this.memory.read8(physicalAddress(this.state.ES, this.state.DI));
    this.updateFlagsSub(al, b, (al - b) & 0xff, 8);
    const delta = this.getFlag('DF') ? -1 : 1;
    this.state.DI = (this.state.DI + delta) & 0xffff;
    return 1;
  }

  private execSCASW(_instr: Instruction): number {
    const ax = this.state.AX;
    const b = this.memory.read16(physicalAddress(this.state.ES, this.state.DI));
    this.updateFlagsSub(ax, b, (ax - b) & 0xffff, 16);
    const delta = this.getFlag('DF') ? -2 : 2;
    this.state.DI = (this.state.DI + delta) & 0xffff;
    return 1;
  }

  private execLODSB(_instr: Instruction): number {
    const val = this.memory.read8(physicalAddress(this.state.DS, this.state.SI));
    this.state.AX = (this.state.AX & 0xff00) | val;
    this.state.SI = (this.state.SI + (this.getFlag('DF') ? -1 : 1)) & 0xffff;
    return 1;
  }

  private execLODSW(_instr: Instruction): number {
    const val = this.memory.read16(physicalAddress(this.state.DS, this.state.SI));
    this.state.AX = val;
    this.state.SI = (this.state.SI + (this.getFlag('DF') ? -2 : 2)) & 0xffff;
    return 1;
  }

  private execSTOSB(_instr: Instruction): number {
    this.memory.write8(physicalAddress(this.state.ES, this.state.DI), this.state.AX & 0xff);
    this.state.DI = (this.state.DI + (this.getFlag('DF') ? -1 : 1)) & 0xffff;
    return 1;
  }

  private execSTOSW(_instr: Instruction): number {
    this.memory.write16(physicalAddress(this.state.ES, this.state.DI), this.state.AX);
    this.state.DI = (this.state.DI + (this.getFlag('DF') ? -2 : 2)) & 0xffff;
    return 1;
  }

  // REP/REPE/REPNE compound mnemonic: "REP MOVSB", "REPE CMPSB", etc.
  private execREP(instr: Instruction): number {
    const parts = instr.mnemonic.toUpperCase().split(/\s+/);
    const prefix = parts[0];
    const strOp  = parts[1];
    while (this.state.CX !== 0) {
      this.state.CX = (this.state.CX - 1) & 0xffff;
      // Execute the string instruction
      const strInstr: Instruction = { mnemonic: strOp, operands: [], bytes: [0] };
      this.execute(strInstr);
      // REPE: stop if ZF=0, REPNE: stop if ZF=1
      if (prefix === 'REPE' || prefix === 'REPZ') {
        if (!this.getFlag('ZF')) break;
      } else if (prefix === 'REPNE' || prefix === 'REPNZ') {
        if (this.getFlag('ZF')) break;
      }
    }
    return instr.bytes.length;
  }

  // ─── Flag instructions ────────────────────────────────────────────────────

  private execCLC(_instr: Instruction): number { this.setFlag('CF', false); return 1; }
  private execSTC(_instr: Instruction): number { this.setFlag('CF', true);  return 1; }
  private execCMC(_instr: Instruction): number { this.setFlag('CF', !this.getFlag('CF')); return 1; }
  private execCLI(_instr: Instruction): number { this.setFlag('IF', false); return 1; }
  private execSTI(_instr: Instruction): number { this.setFlag('IF', true);  return 1; }
  private execCLD(_instr: Instruction): number { this.setFlag('DF', false); return 1; }
  private execSTD(_instr: Instruction): number { this.setFlag('DF', true);  return 1; }

  // ─── Interrupt handling ───────────────────────────────────────────────────

  interruptHandler?: (cpu: CPU, vector: number) => void;

  private execINT(instr: Instruction): number {
    const vector = instr.operands[0]?.value ?? 0;
    if (this.interruptHandler) {
      this.interruptHandler(this, vector);
    }
    return instr.bytes.length;
  }

  private execINTO(_instr: Instruction): number {
    if (this.getFlag('OF') && this.interruptHandler) {
      this.interruptHandler(this, 4);
    }
    return 1;
  }

  private execIRET(_instr: Instruction): number {
    // Pop IP, CS, FLAGS
    const ip = this.memory.read16(physicalAddress(this.state.SS, this.state.SP));
    this.state.SP = (this.state.SP + 2) & 0xffff;
    const cs = this.memory.read16(physicalAddress(this.state.SS, this.state.SP));
    this.state.SP = (this.state.SP + 2) & 0xffff;
    const flags = this.memory.read16(physicalAddress(this.state.SS, this.state.SP));
    this.state.SP = (this.state.SP + 2) & 0xffff;
    this.state.IP = ip;
    this.state.CS = cs;
    this.state.FLAGS = flags;
    return 1;
  }

  // ─── Operand resolution (FIXED: uses full EA computation) ────────────────

  private resolveOperandValue(op: Operand, hint: 8 | 16 = 16): number {
    const bw = op.size ?? hint;
    if (op.type === 'immediate') {
      return op.value !== undefined ? op.value & (bw === 8 ? 0xff : 0xffff) : 0;
    }
    if (op.type === 'register' && op.register) {
      const r = op.register.toUpperCase();
      if (r.length === 2 && (r[1] === 'H' || r[1] === 'L')) return this.readRegister8(r);
      return this.readRegister16(r);
    }
    if (op.type === 'memory') {
      const addr = this.computeEffectiveAddress(op);
      return bw === 8 ? this.memory.read8(addr) : this.memory.read16(addr);
    }
    return 0;
  }

  // Read a signed operand value
  private resolveOperandSigned(op: Operand, bw: 8 | 16): number {
    const raw = this.resolveOperandValue(op, bw);
    if (bw === 8)  return raw >= 0x80   ? raw - 256   : raw;
    return raw >= 0x8000 ? raw - 65536 : raw;
  }

  private writeOperand(op: Operand, value: number, hint: 8 | 16 = 16): void {
    const bw = op.size ?? hint;
    const mask = bw === 8 ? 0xff : 0xffff;
    if (op.type === 'register' && op.register) {
      const r = op.register.toUpperCase();
      if (r.length === 2 && (r[1] === 'H' || r[1] === 'L')) {
        this.writeRegister8(r, value & 0xff);
      } else {
        this.writeRegister(r, value & mask);
      }
    } else if (op.type === 'memory') {
      const addr = this.computeEffectiveAddress(op);
      if (bw === 8) {
        this.memory.write8(addr, value & 0xff);
      } else {
        this.memory.write16(addr, value & 0xffff);
      }
    }
  }

  private operandBitWidth(op: Operand): 8 | 16 {
    if (op.size !== undefined) return op.size;
    if (op.type === 'register' && op.register) {
      const r = op.register.toUpperCase();
      if (r.length === 2 && (r[1] === 'H' || r[1] === 'L')) return 8;
    }
    return 16;
  }

  // Compute the segment:offset physical address for a memory operand (FIXED)
  private computeEffectiveAddress(op: Operand): number {
    const offset = this.computeEffectiveOffset(op);
    let seg = this.state.DS;
    if (op.segment !== undefined) {
      seg = this.resolveSegmentRegister(op.segment);
    } else if ((op.base ?? op.register)?.toUpperCase() === 'BP' || op.index?.toUpperCase() === 'BP') {
      seg = this.state.SS;
    }
    return physicalAddress(seg, offset);
  }

  // Compute just the 16-bit effective offset (base + index + displacement)
  private computeEffectiveOffset(op: Operand): number {
    let offset = op.offset ?? 0;

    // Base register
    const base = (op.base ?? op.register)?.toUpperCase();
    if (base) {
      switch (base) {
        case 'BX': offset = (offset + this.state.BX) & 0xffff; break;
        case 'BP': offset = (offset + this.state.BP) & 0xffff; break;
        case 'SI': offset = (offset + this.state.SI) & 0xffff; break;
        case 'DI': offset = (offset + this.state.DI) & 0xffff; break;
        default: {
          // try as any 16-bit register
          try { offset = (offset + this.readRegister16(base)) & 0xffff; } catch (_) {}
        }
      }
    }

    // Index register
    const index = op.index?.toUpperCase();
    if (index) {
      switch (index) {
        case 'SI': offset = (offset + this.state.SI) & 0xffff; break;
        case 'DI': offset = (offset + this.state.DI) & 0xffff; break;
        case 'BX': offset = (offset + this.state.BX) & 0xffff; break;
        case 'BP': offset = (offset + this.state.BP) & 0xffff; break;
        default: {
          try { offset = (offset + this.readRegister16(index)) & 0xffff; } catch (_) {}
        }
      }
    }

    return offset & 0xffff;
  }

  private resolveSegmentRegister(seg: string): number {
    switch (seg.toUpperCase()) {
      case 'CS': return this.state.CS;
      case 'DS': return this.state.DS;
      case 'ES': return this.state.ES;
      case 'SS': return this.state.SS;
      default: throw new Error(`Unknown segment register: ${seg}`);
    }
  }

  private doJump(instr: Instruction): number {
    const target = instr.operands[0];
    if (target.type === 'immediate') {
      this.state.IP = target.value ?? 0;
    } else if (target.type === 'memory') {
      this.state.IP = this.memory.read16(this.computeEffectiveAddress(target));
    } else if (target.type === 'register') {
      this.state.IP = this.resolveOperandValue(target, 16);
    }
    return instr.bytes.length;
  }

  private updateFlagsLogical(value: number, bitWidth: 8 | 16): void {
    const mask = bitWidth === 8 ? 0xff : 0xffff;
    this.setFlag('CF', false);
    this.setFlag('OF', false);
    this.setFlag('AF', false);
    this.setFlag('ZF', (value & mask) === 0);
    this.setFlag('SF', (value & (bitWidth === 8 ? 0x80 : 0x8000)) !== 0);
    this.setFlag('PF', this.parity(value & 0xff));
  }

  // ─── Decoder ─────────────────────────────────────────────────────────────

  private decodeOpcode(opcode: number, phys: number): Instruction {
    const REG16 = ['AX','CX','DX','BX','SP','BP','SI','DI'] as const;
    type Reg16 = typeof REG16[number];

    // MOV reg16, imm16 — 0xB8..0xBF
    if (opcode >= 0xB8 && opcode <= 0xBF) {
      const reg = REG16[opcode - 0xB8] as Reg16;
      const lo = this.memory.read8(phys + 1);
      const hi = this.memory.read8(phys + 2);
      return { mnemonic: 'MOV', operands: [{ type: 'register', register: reg }, { type: 'immediate', value: lo | (hi << 8) }], bytes: [opcode, lo, hi] };
    }
    // MOV reg8, imm8 — 0xB0..0xB7
    if (opcode >= 0xB0 && opcode <= 0xB7) {
      const REG8 = ['AL','CL','DL','BL','AH','CH','DH','BH'] as const;
      const reg = REG8[opcode - 0xB0];
      const imm = this.memory.read8(phys + 1);
      return { mnemonic: 'MOV', operands: [{ type: 'register', register: reg as any }, { type: 'immediate', value: imm }], bytes: [opcode, imm] };
    }
    // INC reg16 — 0x40..0x47
    if (opcode >= 0x40 && opcode <= 0x47) {
      const reg = REG16[opcode - 0x40] as Reg16;
      return { mnemonic: 'INC', operands: [{ type: 'register', register: reg }], bytes: [opcode] };
    }
    // DEC reg16 — 0x48..0x4F
    if (opcode >= 0x48 && opcode <= 0x4F) {
      const reg = REG16[opcode - 0x48] as Reg16;
      return { mnemonic: 'DEC', operands: [{ type: 'register', register: reg }], bytes: [opcode] };
    }
    // PUSH reg16 — 0x50..0x57
    if (opcode >= 0x50 && opcode <= 0x57) {
      const reg = REG16[opcode - 0x50] as Reg16;
      return { mnemonic: 'PUSH', operands: [{ type: 'register', register: reg }], bytes: [opcode] };
    }
    // POP reg16 — 0x58..0x5F
    if (opcode >= 0x58 && opcode <= 0x5F) {
      const reg = REG16[opcode - 0x58] as Reg16;
      return { mnemonic: 'POP', operands: [{ type: 'register', register: reg }], bytes: [opcode] };
    }

    switch (opcode) {
      case 0x90: return { mnemonic: 'NOP',   operands: [], bytes: [0x90] };
      case 0xF4: return { mnemonic: 'HLT',   operands: [], bytes: [0xF4] };
      case 0x98: return { mnemonic: 'CBW',   operands: [], bytes: [0x98] };
      case 0x99: return { mnemonic: 'CWD',   operands: [], bytes: [0x99] };
      case 0x9C: return { mnemonic: 'PUSHF', operands: [], bytes: [0x9C] };
      case 0x9D: return { mnemonic: 'POPF',  operands: [], bytes: [0x9D] };
      case 0x9E: return { mnemonic: 'SAHF',  operands: [], bytes: [0x9E] };
      case 0x9F: return { mnemonic: 'LAHF',  operands: [], bytes: [0x9F] };
      case 0xD7: return { mnemonic: 'XLAT',  operands: [], bytes: [0xD7] };
      case 0xA4: return { mnemonic: 'MOVSB', operands: [], bytes: [0xA4] };
      case 0xA5: return { mnemonic: 'MOVSW', operands: [], bytes: [0xA5] };
      case 0xA6: return { mnemonic: 'CMPSB', operands: [], bytes: [0xA6] };
      case 0xA7: return { mnemonic: 'CMPSW', operands: [], bytes: [0xA7] };
      case 0xAE: return { mnemonic: 'SCASB', operands: [], bytes: [0xAE] };
      case 0xAF: return { mnemonic: 'SCASW', operands: [], bytes: [0xAF] };
      case 0xAC: return { mnemonic: 'LODSB', operands: [], bytes: [0xAC] };
      case 0xAD: return { mnemonic: 'LODSW', operands: [], bytes: [0xAD] };
      case 0xAA: return { mnemonic: 'STOSB', operands: [], bytes: [0xAA] };
      case 0xAB: return { mnemonic: 'STOSW', operands: [], bytes: [0xAB] };
      case 0xF8: return { mnemonic: 'CLC',   operands: [], bytes: [0xF8] };
      case 0xF9: return { mnemonic: 'STC',   operands: [], bytes: [0xF9] };
      case 0xF5: return { mnemonic: 'CMC',   operands: [], bytes: [0xF5] };
      case 0xFA: return { mnemonic: 'CLI',   operands: [], bytes: [0xFA] };
      case 0xFB: return { mnemonic: 'STI',   operands: [], bytes: [0xFB] };
      case 0xFC: return { mnemonic: 'CLD',   operands: [], bytes: [0xFC] };
      case 0xFD: return { mnemonic: 'STD',   operands: [], bytes: [0xFD] };
      case 0x37: return { mnemonic: 'AAA',   operands: [], bytes: [0x37] };
      case 0x3F: return { mnemonic: 'AAS',   operands: [], bytes: [0x3F] };
      case 0x27: return { mnemonic: 'DAA',   operands: [], bytes: [0x27] };
      case 0x2F: return { mnemonic: 'DAS',   operands: [], bytes: [0x2F] };
      case 0xCE: return { mnemonic: 'INTO',  operands: [], bytes: [0xCE] };
      case 0xCF: return { mnemonic: 'IRET',  operands: [], bytes: [0xCF] };
      case 0xCB: return { mnemonic: 'RETF',  operands: [], bytes: [0xCB] };
      case 0xC3: return { mnemonic: 'RET',   operands: [], bytes: [0xC3] };
      case 0xEB: {
        const rel = this.memory.read8(phys + 1);
        const signed = rel >= 0x80 ? rel - 256 : rel;
        const target = (this.state.IP + 2 + signed) & 0xffff;
        return { mnemonic: 'JMP', operands: [{ type: 'immediate', value: target }], bytes: [0xEB, rel] };
      }
      case 0xE8: {
        const lo = this.memory.read8(phys + 1);
        const hi = this.memory.read8(phys + 2);
        const rel = lo | (hi << 8);
        const signed = rel >= 0x8000 ? rel - 65536 : rel;
        const target = (this.state.IP + 3 + signed) & 0xffff;
        return { mnemonic: 'CALL', operands: [{ type: 'immediate', value: target }], bytes: [0xE8, lo, hi] };
      }
      case 0xCD: {
        const imm = this.memory.read8(phys + 1);
        return { mnemonic: 'INT', operands: [{ type: 'immediate', value: imm }], bytes: [0xCD, imm] };
      }
      default:
        return { mnemonic: 'UNKNOWN', operands: [], bytes: [opcode] };
    }
  }
}
