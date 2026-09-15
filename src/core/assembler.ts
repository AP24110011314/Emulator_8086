// 8086 Assembler — converts assembly source text to Instruction objects
// Framework-agnostic; no DOM or React dependency.

import type { Instruction, Operand } from './types';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface AssemblerError {
  line: number;
  message: string;
}

export interface AssemblerResult {
  instructions: AssembledInstruction[];
  errors: AssemblerError[];
  /** Raw bytes for the data segment (from DB/DW directives) */
  dataBytes: number[];
  /** Physical paragraph address of the data segment (default 0x1000) */
  dataSegmentParagraph: number;
  /** Program entry address (CS offset) */
  entryAddress: number;
}

export interface AssembledInstruction {
  instruction: Instruction;
  /** Address (offset from code start) at which this instruction sits */
  address: number;
  /** Original source line number (1-based) */
  sourceLine: number;
  /** Original source text */
  sourceText: string;
}

// ─── Register helpers ─────────────────────────────────────────────────────────

const REG16 = new Set(['AX','BX','CX','DX','SP','BP','SI','DI','CS','DS','ES','SS','IP']);
const REG8  = new Set(['AL','BL','CL','DL','AH','BH','CH','DH']);

function isReg16(s: string): boolean { return REG16.has(s.toUpperCase()); }
function isReg8(s: string):  boolean { return REG8.has(s.toUpperCase()); }
function isReg(s: string):   boolean { return isReg16(s) || isReg8(s); }

// ─── Known mnemonics ──────────────────────────────────────────────────────────

const KNOWN_MNEMONICS = new Set([
  // Data transfer
  'MOV','PUSH','POP','XCHG','LEA','LDS','LES','LAHF','SAHF','PUSHF','POPF',
  'IN','OUT','XLAT','XLATB',
  // Arithmetic
  'ADD','ADC','SUB','SBB','INC','DEC','NEG','CMP','MUL','IMUL','DIV','IDIV',
  'CBW','CWD','AAA','AAS','AAM','AAD','DAA','DAS','TEST',
  // Logic
  'AND','OR','XOR','NOT',
  // Shift / rotate
  'SHL','SAL','SHR','SAR','ROL','ROR','RCL','RCR',
  // String ops
  'MOVS','MOVSB','MOVSW',
  'CMPS','CMPSB','CMPSW',
  'SCAS','SCASB','SCASW',
  'LODS','LODSB','LODSW',
  'STOS','STOSB','STOSW',
  // REP prefixes
  'REP','REPE','REPZ','REPNE','REPNZ',
  // Control flow
  'JMP','JE','JZ','JNE','JNZ',
  'JG','JNLE','JL','JNGE','JGE','JNL','JLE','JNG',
  'JA','JNBE','JB','JNAE','JC','JAE','JNB','JNC',
  'JBE','JNA','JS','JNS','JO','JNO','JP','JPE','JNP','JPO','JCXZ',
  'LOOP','LOOPE','LOOPZ','LOOPNE','LOOPNZ',
  'CALL','RET','RETF',
  // Interrupts
  'INT','INTO','IRET',
  // Flag ops
  'CLC','STC','CMC','CLI','STI','CLD','STD',
  // Misc
  'NOP','HLT','WAIT','ESC','LOCK',
]);

// ─── Instruction size estimation ──────────────────────────────────────────────

function estimateSize(mnemonic: string, operands: string[]): number {
  const m = mnemonic.toUpperCase();
  switch (m) {
    case 'NOP': case 'HLT': case 'RET': case 'RETF':
    case 'CBW': case 'CWD':
    case 'AAA': case 'AAS': case 'AAM': case 'AAD': case 'DAA': case 'DAS':
    case 'PUSHF': case 'POPF': case 'LAHF': case 'SAHF':
    case 'XLAT': case 'XLATB': case 'INTO': case 'IRET': case 'WAIT': case 'LOCK':
    case 'MOVSB': case 'MOVSW': case 'MOVS':
    case 'CMPSB': case 'CMPSW': case 'CMPS':
    case 'SCASB': case 'SCASW': case 'SCAS':
    case 'LODSB': case 'LODSW': case 'LODS':
    case 'STOSB': case 'STOSW': case 'STOS':
    case 'CLC': case 'STC': case 'CMC': case 'CLI': case 'STI':
    case 'CLD': case 'STD': case 'ESC':
      return 1;

    case 'REP': case 'REPE': case 'REPZ': case 'REPNE': case 'REPNZ':
      return 1 + estimateSize(operands[0] || 'NOP', []);

    case 'NOT': case 'NEG': case 'MUL': case 'IMUL': case 'DIV': case 'IDIV': {
      const op = operands[0] || '';
      if (isReg16(op)) return 1;
      return 2;
    }
    case 'INC': case 'DEC': {
      const op = operands[0] || '';
      if (isReg16(op)) return 1;
      return 2;
    }
    case 'PUSH': case 'POP': {
      const op = operands[0] || '';
      if (isReg16(op)) return 1;
      if (isImmediate(op)) return 3;
      return 2;
    }
    case 'MOV': {
      const dst = operands[0] || '';
      const src = operands[1] || '';
      if (isReg16(dst) && isImmediate(src)) return 3;
      if (isReg8(dst)  && isImmediate(src)) return 2;
      return 2;
    }
    case 'ADC': case 'SBB':
    case 'ADD': case 'SUB': case 'CMP': case 'AND': case 'OR': case 'XOR':
    case 'TEST':
      return isImmediate(operands[1] || '') ? 3 : 2;
    case 'SHL': case 'SAL': case 'SHR': case 'SAR':
    case 'ROL': case 'ROR': case 'RCL': case 'RCR':
      return 2;
    case 'IN': case 'OUT':
      return 2;
    case 'JMP': return 2;
    case 'JE': case 'JZ': case 'JNE': case 'JNZ':
    case 'JG': case 'JL': case 'JGE': case 'JLE':
    case 'JA': case 'JB': case 'JAE': case 'JBE':
    case 'JS': case 'JNS': case 'JO': case 'JNO':
    case 'JP': case 'JNP': case 'JNLE': case 'JNGE':
    case 'JNL': case 'JNG': case 'JNBE': case 'JNAE':
    case 'JC': case 'JNC': case 'JPE': case 'JPO':
    case 'LOOP': case 'LOOPE': case 'LOOPNE':
    case 'LOOPZ': case 'LOOPNZ': case 'JCXZ':
      return 2;
    case 'CALL': return 3;
    case 'INT': return 2;
    case 'LEA': return 3;
    case 'XCHG': return 2;
    case 'LDS': case 'LES': return 3;
    default: return 1;
  }
}

function isImmediate(s: string): boolean {
  const trimmed = s.trim();
  return /^-?[0-9]/.test(trimmed) ||
         /^0x[0-9a-fA-F]+$/i.test(trimmed) ||
         /^[0-9a-fA-F]+h$/i.test(trimmed) ||
         /^[0-9]+[bBoOdD]?$/.test(trimmed) ||
         /^'.'$/.test(trimmed) ||
         /^\".\"$/.test(trimmed);
}

// ─── Immediate parsing ────────────────────────────────────────────────────────

function parseImmediate(s: string): number | null {
  const t = s.trim();
  const tu = t.toUpperCase();
  if (/^'.'$/.test(t) || /^\".\"$/.test(t)) return t.charCodeAt(1);
  if (t.startsWith('-')) {
    const v = parseImmediate(t.slice(1));
    return v !== null ? ((-v) & 0xffff) : null;
  }
  if (/^0X[0-9A-F]+$/.test(tu)) return parseInt(tu.slice(2), 16);
  if (/^[0-9A-F]+H$/.test(tu)) return parseInt(tu.slice(0, -1), 16);
  if (/^[01]+B$/.test(tu)) return parseInt(tu.slice(0, -1), 2);
  if (/^[0-7]+[OQ]$/.test(tu)) return parseInt(tu.slice(0, -1), 8);
  if (/^[0-9]+D?$/.test(tu)) return parseInt(tu.replace(/D$/, ''), 10);
  return null;
}

// ─── Label arithmetic (e.g. `NAME + 2`, `ARR-1`) ─────────────────────────────
// Standard MASM idiom: label ± constant resolves to (label address ± constant),
// e.g. `MOV DX, OFFSET NAME + 2` skips a DOS input buffer's max-length and
// actual-length bytes to reach the string data. Spacing around the operator
// is insignificant (`NAME+2`, `NAME + 2`, `NAME +2` all parse identically).
// The constant goes through parseImmediate, so hex (`+ 0FFH`) etc. work too.
function resolveLabelArithmetic(
  expr: string,
  labels: Map<string, number>
): { value: number } | { unknownLabel: string } | null {
  const m = expr.match(/^([@A-Za-z_][A-Za-z0-9_]*)\s*([+-])\s*(.+)$/);
  if (!m) return null;
  const base = labels.get(m[1].toUpperCase());
  if (base === undefined) return { unknownLabel: m[1] };
  const c = parseImmediate(m[3].trim());
  if (c === null) return null;
  return { value: m[2] === '+' ? (base + c) & 0xffff : (base - c) & 0xffff };
}

// ─── Operand parsing ──────────────────────────────────────────────────────────

function parseOperand(raw: string, labels: Map<string, number>): Operand | null {
  const s = raw.trim();
  if (!s) return null;

  // BYTE PTR / WORD PTR / DWORD PTR prefix
  let sizeOverride: 8 | 16 | undefined;
  let inner = s;
  const ptrMatch = s.match(/^(BYTE|WORD|DWORD)\s+PTR\s+(.+)$/i);
  if (ptrMatch) {
    sizeOverride = ptrMatch[1].toUpperCase() === 'BYTE' ? 8 : 16;
    inner = ptrMatch[2].trim();
  }

  // Segment prefix before bracket or label (e.g. ES:[BX], DS:[SI], ES:var)
  let segmentOverride: string | undefined;
  const segPrefixMatch = inner.match(/^([A-Za-z]{2})\s*:\s*(.+)$/);
  if (segPrefixMatch && /^(CS|DS|ES|SS)$/i.test(segPrefixMatch[1])) {
    segmentOverride = segPrefixMatch[1].toUpperCase();
    inner = segPrefixMatch[2].trim();
  }

  // Register
  if (isReg(inner)) {
    const r = inner.toUpperCase();
    return { type: 'register', register: r as any, size: sizeOverride };
  }

  // OFFSET <label> keyword (also <label> +/- constant, e.g. OFFSET NAME + 2)
  const offsetMatch = inner.match(/^OFFSET\s+(.+)$/i);
  if (offsetMatch) {
    const expr = offsetMatch[1].trim();
    const addr = labels.get(expr.toUpperCase());
    if (addr !== undefined) return { type: 'immediate', value: addr };
    const arith = resolveLabelArithmetic(expr, labels);
    if (arith !== null) {
      if ('value' in arith) return { type: 'immediate', value: arith.value };
      return { type: 'immediate', value: 0, register: arith.unknownLabel as any };
    }
    return { type: 'immediate', value: 0, register: expr.toUpperCase() as any };
  }

  // SEG <label> keyword
  const segOpMatch = inner.match(/^SEG\s+(.+)$/i);
  if (segOpMatch) {
    return { type: 'immediate', value: DATA_SEGMENT_PARAGRAPH };
  }

  // Memory: [...]
  const memMatch = inner.match(/^\[(.+)\]$/);
  if (memMatch) {
    const op = parseMemoryOperand(memMatch[1].trim(), labels, segmentOverride);
    if (sizeOverride !== undefined) op.size = sizeOverride;
    return op;
  }

  // Immediate (number)
  const imm = parseImmediate(inner);
  if (imm !== null) {
    return { type: 'immediate', value: imm };
  }

  // Label as immediate (allow @ prefix for MASM pseudo-vars like @DATA, @CODE)
  if (/^@?[A-Za-z_][A-Za-z0-9_]*$/.test(inner)) {
    const addr = labels.get(inner.toUpperCase());
    if (addr !== undefined) return { type: 'immediate', value: addr };
    return { type: 'immediate', value: 0, register: inner as any };
  }

  // Bare label arithmetic without OFFSET: `MOV DX, NAME + 2`
  // ([...] brackets already tokenise +/- in parseMemoryOperand.)
  const bareArith = resolveLabelArithmetic(inner, labels);
  if (bareArith !== null) {
    if ('value' in bareArith) return { type: 'immediate', value: bareArith.value };
    return { type: 'immediate', value: 0, register: bareArith.unknownLabel as any };
  }

  return null;
}

function parseMemoryOperand(inner: string, labels: Map<string, number>, segmentOverride?: string): Operand {
  // Strip segment prefix inside bracket (e.g. CS:1234, ES:BX)
  let segmentStr: string | undefined = segmentOverride;
  const segMatch = inner.match(/^([A-Za-z]{2}):(.+)$/);
  if (segMatch) {
    segmentStr = segMatch[1].toUpperCase();
    inner = segMatch[2].trim();
  }
  if (segmentStr !== undefined && !/^(CS|DS|ES|SS)$/.test(segmentStr)) {
    throw new Error(`Unknown segment register: "${segmentStr}"`);
  }

  // Tokenise: split on + and -, keeping sign
  const tokens: { sign: number; value: string }[] = [];
  const re = /([+\-]?)\s*([^+\-]+)/g;
  let match;
  while ((match = re.exec(inner)) !== null) {
    const sign = match[1] === '-' ? -1 : 1;
    tokens.push({ sign, value: match[2].trim() });
  }

  let base: string | undefined;
  let index: string | undefined;
  let offset = 0;

  for (const tok of tokens) {
    if (!tok.value) continue;
    const v = tok.value.toUpperCase();
    if (isReg(v)) {
      if (!base) base = v;
      else index = v;
    } else {
      const n = parseImmediate(tok.value);
      if (n !== null) {
        offset = (offset + tok.sign * n) & 0xffff;
      } else {
        const lblVal = labels.get(v);
        if (lblVal !== undefined) {
          offset = (offset + tok.sign * lblVal) & 0xffff;
        } else {
          // Unknown identifier inside brackets used to assemble silently as
          // [0] — report it so it can't masquerade as a valid address.
          throw new Error(`Undefined label: "${tok.value}"`);
        }
      }
    }
  }

  return {
    type: 'memory',
    register: base as any,
    base: base,
    index: index,
    offset: offset & 0xffff,
    segment: segmentStr as any,
  };
}

// ─── Directives to silently skip ─────────────────────────────────────────────

const SKIP_DIRECTIVES = new Set([
  '.MODEL', '.STACK', '.CODE', '.DATA', '.DATA?',
  'ASSUME', 'SEGMENT', 'ENDS', 'END',
  'PROC', 'ENDP', 'PUBLIC', 'EXTRN', 'INCLUDE',
  'DOSSEG', '.DOSSEG', '.286', '.386', '.486', '.8086',
  'MACRO', 'ENDM',
  'TITLE', 'PAGE', 'NAME', 'SUBTTL', 'ALIGN', 'EVEN', 'COMMENT', 'LOCALS',
]);

// EQU constants map: populated during pass 1
const equConstants = new Map<string, number>();

const DATA_SEGMENT_PARAGRAPH = 0x1000;

// ─── DB/DW string / byte list parser ─────────────────────────────────────────

/**
 * Expand `N DUP(value)` patterns in DB/DW argument strings.
 * Supports decimal or hex count and ? uninitialized values.
 * e.g. "10 DUP(0)" → "0,0,..." or "10h DUP(?)" → "0,0,..."
 */
function expandDup(args: string): string {
  // Loop until fixpoint so nested DUP (e.g. `2 DUP(3 DUP(7))`) expands fully:
  // each pass expands the innermost DUP whose (...) contains no parens.
  let prev = args;
  for (let pass = 0; pass < 10; pass++) {
    const next = prev.replace(/([0-9a-fA-F]+h?|\d+)\s+DUP\s*\(([^()]+)\)/gi, (_m, countStr, val) => {
      const count = parseImmediate(countStr) ?? parseInt(countStr, 10) ?? 1;
      const cleanVal = val.trim() === '?' ? '0' : val.trim();
      return Array(Math.max(0, count)).fill(cleanVal).join(',');
    });
    if (next === prev) return next;
    prev = next;
  }
  return prev;
}

function parseDbArgs(args: string): number[] {
  const expanded = expandDup(args);
  const bytes: number[] = [];
  let i = 0;
  while (i < expanded.length) {
    const ch = expanded[i];
    if (ch === '\'' || ch === '"') {
      const quote = ch;
      i++;
      while (i < expanded.length && expanded[i] !== quote) {
        bytes.push(expanded.charCodeAt(i));
        i++;
      }
      i++;
    } else if (ch === ',' || ch === ' ' || ch === '\t') {
      i++;
    } else {
      let tok = '';
      while (i < expanded.length && expanded[i] !== ',') {
        tok += expanded[i];
        i++;
      }
      tok = tok.trim();
      if (tok) {
        // resolve EQU constant
        const eqVal = equConstants.get(tok.toUpperCase());
        const v = eqVal !== undefined ? eqVal : parseImmediate(tok);
        bytes.push(v !== null && v !== undefined ? v & 0xFF : 0);
      }
    }
  }
  return bytes;
}

function parseDwArgs(args: string): number[] {
  const words: number[] = [];
  for (const tok of expandDup(args).split(',')) {
    const t = tok.trim();
    const eqVal = equConstants.get(t.toUpperCase());
    const v = eqVal !== undefined ? eqVal : (parseImmediate(t) ?? 0);
    words.push(v & 0xFF);
    words.push((v >> 8) & 0xFF);
  }
  return words;
}

function parseDdArgs(args: string): number[] {
  const dwords: number[] = [];
  for (const tok of expandDup(args).split(',')) {
    const t = tok.trim();
    const eqVal = equConstants.get(t.toUpperCase());
    const v = eqVal !== undefined ? eqVal : (parseImmediate(t) ?? 0);
    dwords.push(v & 0xFF);
    dwords.push((v >> 8) & 0xFF);
    dwords.push((v >> 16) & 0xFF);
    dwords.push((v >> 24) & 0xFF);
  }
  return dwords;
}

// ─── Main assembler ───────────────────────────────────────────────────────────

export function assemble(source: string): AssemblerResult {
  const lines = source.split('\n');
  const errors: AssemblerError[] = [];
  const assembled: AssembledInstruction[] = [];

  // Clear EQU constants from any previous assembly
  equConstants.clear();

  // Detect MASM-style segmented programs:
  //   - .DATA / .CODE section markers
  //   - "name PROC" / "name SEGMENT" patterns
  const hasSegments = /^\s*(\.|\w+\s+(PROC|SEGMENT))/im.test(source) &&
    /(\.MODEL|PROC|SEGMENT|\.DATA|\.CODE|\.STACK)/i.test(source);

  const dataBytes: number[] = [];
  const dataLabels = new Map<string, number>();
  let inDataSegment = false;

  const labels = new Map<string, number>();
  // Pre-seed @DATA so it resolves in pass 1 as well as pass 2
  labels.set('@DATA', DATA_SEGMENT_PARAGRAPH);
  let address = 0;
  let entryAddress = 0;
  let hasExplicitEntry = false;
  let endEntryLabel: string | undefined = undefined;
  let inMacroDefinition = false;

  interface RawLine {
    lineNum: number;
    text: string;
    mnemonic: string;
    operandStrings: string[];
    address: number;
    dataBytes?: number[];
  }
  const rawLines: RawLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    let text = lines[i];

    const commentIdx = text.indexOf(';');
    if (commentIdx >= 0) text = text.slice(0, commentIdx);
    text = text.trim();
    if (!text) continue;

    // Multi-line MACRO definition block skipping
    if (inMacroDefinition) {
      if (/^\s*ENDM\b/i.test(text)) {
        inMacroDefinition = false;
      }
      continue;
    }
    if (/\bMACRO\b/i.test(text)) {
      inMacroDefinition = true;
      continue;
    }

    // Global EQU directive anywhere in source
    const equLine = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+EQU\s+(.+)$/i);
    if (equLine) {
      const v = parseImmediate(equLine[2].trim());
      if (v !== null) {
        equConstants.set(equLine[1].toUpperCase(), v);
        labels.set(equLine[1].toUpperCase(), v);
      }
      continue;
    }

    // END directive with optional start symbol
    const endMatch = text.match(/^\s*END(\s+([A-Za-z_][A-Za-z0-9_]*))?\s*$/i);
    if (endMatch) {
      if (endMatch[2]) {
        endEntryLabel = endMatch[2].toUpperCase();
      }
      continue;
    }

    // Segment directives
    if (/^\.DATA\b/i.test(text)) { inDataSegment = true; continue; }
    if (/^\.CODE\b/i.test(text)) { inDataSegment = false; continue; }

    // Data definition directive with optional label: e.g. "arr DB 1, 2, 3", "str DB 'ABC'", "DB 10"
    const dataDefMatch = text.match(/^(([A-Za-z_][A-Za-z0-9_]*):?\s+)?(DB|DW|DD)\s+(.+)$/i);
    if (dataDefMatch) {
      const lbl = dataDefMatch[2];
      const dir = dataDefMatch[3].toUpperCase();
      const args = dataDefMatch[4];

      if (inDataSegment) {
        if (lbl) dataLabels.set(lbl.toUpperCase(), dataBytes.length);
        if (dir === 'DB') dataBytes.push(...parseDbArgs(args));
        else if (dir === 'DW') dataBytes.push(...parseDwArgs(args));
        else if (dir === 'DD') dataBytes.push(...parseDdArgs(args));
      } else {
        if (lbl) labels.set(lbl.toUpperCase(), address);
        let bytes: number[] = [];
        if (dir === 'DB') bytes = parseDbArgs(args);
        else if (dir === 'DW') bytes = parseDwArgs(args);
        else if (dir === 'DD') bytes = parseDdArgs(args);

        rawLines.push({
          lineNum,
          text: lines[i],
          mnemonic: dir,
          operandStrings: [],
          address,
          dataBytes: bytes
        });
        address += bytes.length;
      }
      continue;
    }

    if (hasSegments) {
      const upperText = text.toUpperCase();
      if (/^\.DATA\b/i.test(text)) { inDataSegment = true; continue; }
      if (/^\.CODE\b/i.test(text)) { inDataSegment = false; continue; }
      if (/\bPROC\b/i.test(text) || /\bSEGMENT\b/i.test(text)) { inDataSegment = false; }
      const firstToken = upperText.split(/\s+/)[0].replace(/^\./,'');
      if (SKIP_DIRECTIVES.has(text.split(/\s+/)[0].toUpperCase()) ||
          SKIP_DIRECTIVES.has('.' + firstToken) ||
          /^\.(MODEL|STACK|CODE|DATA)/i.test(text) ||
          /\b(ENDP|ENDS|END|PROC|ASSUME|DOSSEG)\b/i.test(text)) {
        const lblMatch = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+(PROC|SEGMENT)\b/i);
        if (lblMatch) {
          labels.set(lblMatch[1].toUpperCase(), address);
        }
        if (!inDataSegment) { continue; }
      }
    }

    if (inDataSegment) {
      const dbMatch = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+DB\s+(.+)$/i);
      const dwMatch = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+DW\s+(.+)$/i);
      const ddMatch = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+DD\s+(.+)$/i);
      if (dbMatch) {
        dataLabels.set(dbMatch[1].toUpperCase(), dataBytes.length);
        dataBytes.push(...parseDbArgs(dbMatch[2]));
        continue;
      } else if (dwMatch) {
        dataLabels.set(dwMatch[1].toUpperCase(), dataBytes.length);
        dataBytes.push(...parseDwArgs(dwMatch[2]));
        continue;
      } else if (ddMatch) {
        dataLabels.set(ddMatch[1].toUpperCase(), dataBytes.length);
        dataBytes.push(...parseDdArgs(ddMatch[2]));
        continue;
      }
      const bareDb = text.match(/^DB\s+(.+)$/i);
      const bareDw = text.match(/^DW\s+(.+)$/i);
      const bareDd = text.match(/^DD\s+(.+)$/i);
      if (bareDb) { dataBytes.push(...parseDbArgs(bareDb[1])); continue; }
      if (bareDw) { dataBytes.push(...parseDwArgs(bareDw[1])); continue; }
      if (bareDd) { dataBytes.push(...parseDdArgs(bareDd[1])); continue; }
      continue;
    }

    let mnemonic_and_rest = text;
    const labelMatch = text.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)?$/);
    if (labelMatch) {
      labels.set(labelMatch[1].toUpperCase(), address);
      mnemonic_and_rest = (labelMatch[2] || '').trim();
      if (!mnemonic_and_rest) continue;
    } else {
      // "NAME PROC" / "NAME ENDP" / "NAME SEGMENT" / "NAME ENDS" — register label, skip line
      const procMatch = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+(PROC|ENDP|SEGMENT|ENDS)\b/i);
      if (procMatch) {
        labels.set(procMatch[1].toUpperCase(), address);
        if (/\bPROC\b/i.test(text) || /\bSEGMENT\b/i.test(text)) inDataSegment = false;
        continue;
      }
      // Handle ".CODE" / ".DATA" appearing without hasSegments being set
      if (/^\.DATA\b/i.test(text)) { inDataSegment = true; continue; }
      if (/^\.CODE\b/i.test(text)) { inDataSegment = false; continue; }
    }

    const tokens = mnemonic_and_rest.split(/\s+/, 2);
    const mnemonic = tokens[0].toUpperCase();
    const rest = mnemonic_and_rest.slice(tokens[0].length).trim();

    if (SKIP_DIRECTIVES.has(mnemonic)) continue;
    if (/^(PROC|ENDP|ENDS|END|MACRO|ENDM)$/i.test(mnemonic)) continue;

    // ORG directive — set current assembly address
    if (mnemonic === 'ORG') {
      const v = parseImmediate(rest.trim());
      if (v !== null) {
        address = v;
        if (!hasExplicitEntry) {
          entryAddress = v;
          hasExplicitEntry = true;
        }
      }
      continue;
    }

    // DB/DW/DD in code segment
    if (mnemonic === 'DB') { dataBytes.push(...parseDbArgs(rest)); continue; }
    if (mnemonic === 'DW') { dataBytes.push(...parseDwArgs(rest)); continue; }
    if (mnemonic === 'DD') { dataBytes.push(...parseDdArgs(rest)); continue; }

    const operandStrings = splitOperands(rest);

    rawLines.push({ lineNum, text: lines[i], mnemonic, operandStrings, address });
    address += estimateSize(mnemonic, operandStrings);
  }

  for (const [name, offset] of dataLabels) {
    labels.set(name, offset);
  }
  labels.set('@DATA', DATA_SEGMENT_PARAGRAPH);

  for (const raw of rawLines) {
    if (raw.dataBytes) {
      assembled.push({
        instruction: { mnemonic: raw.mnemonic, operands: [], bytes: raw.dataBytes },
        address: raw.address,
        sourceLine: raw.lineNum,
        sourceText: raw.text
      });
      continue;
    }
    try {
      const instr = buildInstruction(raw.mnemonic, raw.operandStrings, labels, raw.address, errors, raw.lineNum);
      if (instr) {
        assembled.push({
          instruction: instr,
          address: raw.address,
          sourceLine: raw.lineNum,
          sourceText: raw.text
        });
      }
    } catch (e: unknown) {
      errors.push({ line: raw.lineNum, message: e instanceof Error ? e.message : String(e) });
    }
  }

  if (endEntryLabel && labels.has(endEntryLabel)) {
    entryAddress = labels.get(endEntryLabel)!;
    hasExplicitEntry = true;
  }

  if (!hasExplicitEntry && assembled.length > 0) {
    const firstCode = assembled.find(a => !/^(DB|DW|DD)$/i.test(a.instruction.mnemonic));
    entryAddress = firstCode ? firstCode.address : assembled[0].address;
  }

  return {
    instructions: assembled,
    errors,
    dataBytes,
    dataSegmentParagraph: DATA_SEGMENT_PARAGRAPH,
    entryAddress
  };
}

// ─── Operand string splitter ──────────────────────────────────────────────────

function splitOperands(s: string): string[] {
  if (!s.trim()) return [];
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// ─── Instruction builder ──────────────────────────────────────────────────────

function buildInstruction(
  mnemonic: string,
  operandStrings: string[],
  labels: Map<string, number>,
  _currentAddress: number,
  errors: AssemblerError[],
  lineNum: number
): Instruction | null {
  const ops: Operand[] = [];

  // REP/REPE/REPNE: string op mnemonic is operandStrings[0]
  if (/^(REP|REPE|REPZ|REPNE|REPNZ)$/i.test(mnemonic)) {
    const strOp = operandStrings[0]?.toUpperCase();
    if (!strOp) {
      errors.push({ line: lineNum, message: `${mnemonic} requires a string instruction operand` });
      return null;
    }
    const size = 1 + estimateSize(strOp, []);
    const bytes = new Array(size).fill(0);
    bytes[0] = opcodeFor(mnemonic, []);
    bytes[1] = opcodeFor(strOp, []);
    return { mnemonic: `${mnemonic} ${strOp}`, operands: [], bytes };
  }

  for (const os of operandStrings) {
    let op: Operand | null;
    try {
      op = parseOperand(os, labels);
    } catch (e: unknown) {
      // parseMemoryOperand throws precise errors (undefined label inside
      // [...], bad segment override) — surface them instead of a generic
      // "cannot parse" message.
      errors.push({ line: lineNum, message: e instanceof Error ? e.message : String(e) });
      return null;
    }
    if (op === null) {
      errors.push({ line: lineNum, message: `Cannot parse operand: "${os}"` });
      return null;
    }
    if (op.type === 'immediate' && op.register !== undefined && op.value === 0) {
      const addr = labels.get((op.register as string).toUpperCase());
      if (addr !== undefined) {
        op.value = addr;
      } else {
        errors.push({ line: lineNum, message: `Undefined label: "${op.register}"` });
        return null;
      }
      delete op.register;
    }
    ops.push(op);
  }

  if (SKIP_DIRECTIVES.has(mnemonic) || /^(PROC|ENDP|ENDS|END|DB|DW|DD)$/.test(mnemonic)) {
    return null;
  }

  if (!KNOWN_MNEMONICS.has(mnemonic)) {
    errors.push({ line: lineNum, message: `Unknown mnemonic: "${mnemonic}"` });
    return null;
  }

  const size = estimateSize(mnemonic, operandStrings);
  const bytes = new Array(size).fill(0);
  bytes[0] = opcodeFor(mnemonic, ops);

  return { mnemonic, operands: ops, bytes };
}

// ─── Opcode lookup ────────────────────────────────────────────────────────────
// CONTRACT (execution model): `bytes` are NOT fetchable machine code — only
// bytes[0] (base-opcode hint, used by the MemoryViewer) and bytes.length (used
// for IP advance) are meaningful. Operand bytes (ModRM, immediates,
// displacements, rel offsets) are left as zeros. Programs run by dispatching
// decoded operands via cpu.execute(), never via decode()/step() on these
// bytes. A real encoder (ModRM + label-rel fixups) is a separate project;
// until then, decode()/step() tests must hand-encode with loadAndJump().

function opcodeFor(mnemonic: string, _ops: Operand[]): number {
  const map: Record<string, number> = {
    NOP: 0x90, HLT: 0xF4, RET: 0xC3, RETF: 0xCB,
    MOV: 0x88, ADD: 0x00, ADC: 0x10, SUB: 0x28, SBB: 0x18,
    CMP: 0x38, TEST: 0x84,
    AND: 0x20, OR: 0x08, XOR: 0x30, NOT: 0xF6, NEG: 0xF6,
    SHL: 0xD0, SAL: 0xD0, SHR: 0xD0, SAR: 0xD0,
    ROL: 0xD0, ROR: 0xD0, RCL: 0xD0, RCR: 0xD0,
    INC: 0x40, DEC: 0x48,
    MUL: 0xF6, IMUL: 0xF6, DIV: 0xF6, IDIV: 0xF6,
    CBW: 0x98, CWD: 0x99,
    AAA: 0x37, AAS: 0x3F, AAM: 0xD4, AAD: 0xD5, DAA: 0x27, DAS: 0x2F,
    PUSH: 0x50, POP: 0x58, PUSHF: 0x9C, POPF: 0x9D,
    LAHF: 0x9F, SAHF: 0x9E,
    XCHG: 0x86, LEA: 0x8D, LDS: 0xC5, LES: 0xC4,
    XLAT: 0xD7, IN: 0xE4, OUT: 0xE6,
    MOVSB: 0xA4, MOVSW: 0xA5, MOVS: 0xA4,
    CMPSB: 0xA6, CMPSW: 0xA7, CMPS: 0xA6,
    SCASB: 0xAE, SCASW: 0xAF, SCAS: 0xAE,
    LODSB: 0xAC, LODSW: 0xAD, LODS: 0xAC,
    STOSB: 0xAA, STOSW: 0xAB, STOS: 0xAA,
    REP: 0xF3, REPE: 0xF3, REPZ: 0xF3, REPNE: 0xF2, REPNZ: 0xF2,
    JMP: 0xEB,
    JE: 0x74, JZ: 0x74, JNE: 0x75, JNZ: 0x75,
    JG: 0x7F, JNLE: 0x7F, JL: 0x7C, JNGE: 0x7C,
    JGE: 0x7D, JNL: 0x7D, JLE: 0x7E, JNG: 0x7E,
    JA: 0x77, JNBE: 0x77, JB: 0x72, JNAE: 0x72, JC: 0x72,
    JAE: 0x73, JNB: 0x73, JNC: 0x73,
    JBE: 0x76, JNA: 0x76,
    JS: 0x78, JNS: 0x79, JO: 0x70, JNO: 0x71,
    JP: 0x7A, JPE: 0x7A, JNP: 0x7B, JPO: 0x7B, JCXZ: 0xE3,
    LOOP: 0xE2, LOOPE: 0xE1, LOOPZ: 0xE1, LOOPNE: 0xE0, LOOPNZ: 0xE0,
    CALL: 0xE8, INT: 0xCD, INTO: 0xCE, IRET: 0xCF,
    CLC: 0xF8, STC: 0xF9, CMC: 0xF5,
    CLI: 0xFA, STI: 0xFB, CLD: 0xFC, STD: 0xFD,
    WAIT: 0x9B, LOCK: 0xF0,
  };
  return map[mnemonic] ?? 0x90;
}

export function assembleToInstructions(source: string): AssemblerResult {
  return assemble(source);
}
