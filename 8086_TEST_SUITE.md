# 8086 Emulator Test Suite

A set of self-contained assembly snippets to validate your emulator.
Each test is small and isolated so a failure points at exactly one
instruction/feature. Every test lists **expected register/flag state
after execution** — compare that against what your emulator produces.

Feed these to your emulator one at a time (or hand this whole file to a
model and ask it to run each block and report mismatches). Register
values are hex, flags are 0/1.

---

## 1. Data Transfer

### 1.1 MOV — register to register, immediate to register
```asm
MOV AX, 1234h
MOV BX, AX
MOV CL, 5
MOV DH, CL
```
Expected: `AX=1234 BX=1234 CL=05 DH=05`

### 1.2 MOV — memory addressing (all modes)
```asm
ORG 100h
MOV [200h], AX        ; direct memory
MOV AX, [200h]
MOV BX, 200h
MOV AX, [BX]           ; register indirect
MOV AX, [BX+4]         ; based
MOV SI, 10h
MOV AX, [SI]            ; indexed
MOV AX, [BX+SI]         ; based + indexed
MOV AX, [BX+SI+4]       ; based + indexed + displacement
```
Expected: no crash on any addressing form; each `MOV AX, [...]` reads
the byte/word actually stored at the computed effective address
(segment default DS unless BX/BP+SI/DI implies SS).

### 1.3 PUSH / POP / stack integrity
```asm
MOV SP, 0FFFEh
MOV AX, 1111h
MOV BX, 2222h
PUSH AX
PUSH BX
POP AX
POP BX
```
Expected: `AX=2222 BX=1111`, `SP` back to `0FFFE` (stack balanced —
LIFO order verified).

### 1.4 XCHG
```asm
MOV AX, 000Ah
MOV BX, 0014h
XCHG AX, BX
```
Expected: `AX=0014 BX=000A`

### 1.5 LEA vs MOV (effective address, not value)
```asm
MOV BX, 100h
MOV [BX], WORD PTR 9999h
LEA AX, [BX+2]
MOV DX, [BX+2]
```
Expected: `AX=0102` (the address), `DX` = whatever garbage/zero was at
that memory location (not 9999h) — proves LEA loads the address, MOV
loads the value.

### 1.6 PUSHF / POPF / LAHF / SAHF
```asm
MOV AX, 0
ADD AX, 0FFFFh    ; sets CF, ZF? (FFFF+0=FFFF, no carry) use next line
MOV AX, 0FFFFh
ADD AX, 1          ; wraps to 0000, sets CF and ZF
PUSHF
MOV BX, 0
POP BX             ; BX now holds flags word
LAHF
MOV CL, AH         ; CL should reflect same flag bits as low byte of BX
```
Expected: `CF=1 ZF=1` after the wrapping ADD; `BX` low byte and `CL`
carry matching CF/ZF bits.

### 1.7 XLAT
```asm
MOV BX, 300h
MOV BYTE PTR [BX+5], 77h
MOV AL, 5
XLAT
```
Expected: `AL=77h` (table lookup at DS:BX+AL)

---

## 2. Arithmetic

### 2.1 ADD / flag generation
```asm
MOV AX, 7FFFh
ADD AX, 1        ; signed overflow: 32767 + 1
```
Expected: `AX=8000 OF=1 SF=1 ZF=0 CF=0`

### 2.2 ADD — unsigned carry
```asm
MOV AX, 0FFFFh
ADD AX, 1
```
Expected: `AX=0000 CF=1 ZF=1 OF=0`

### 2.3 ADC (add with carry, chained 32-bit add via two 16-bit adds)
```asm
MOV AX, 0FFFFh
MOV BX, 0001h
MOV CX, 0000h
MOV DX, 0001h
ADD AX, BX
ADC CX, DX
```
Expected: `AX=0000 CX=0002` (carry from low word propagated into high word)

### 2.4 SUB / borrow
```asm
MOV AX, 0003h
SUB AX, 0005h
```
Expected: `AX=FFFE CF=1 SF=1 ZF=0`

### 2.5 SBB
```asm
MOV AX, 0000h
MOV BX, 0001h
SUB AX, BX      ; AX=FFFF, CF=1
MOV CX, 0001h
MOV DX, 0000h
SBB CX, DX       ; CX = 1 - 0 - CF(1) = 0
```
Expected: `AX=FFFF CX=0000`

### 2.6 INC / DEC (do NOT affect CF)
```asm
STC              ; set carry manually
MOV AX, 5
INC AX
DEC AX
```
Expected: `AX=5 CF=1` (still set — INC/DEC leave CF untouched, unlike ADD/SUB)

### 2.7 NEG
```asm
MOV AX, 0005h
NEG AX
```
Expected: `AX=FFFB CF=1` (CF set for any nonzero operand)

### 2.8 CMP (flags only, operand unchanged)
```asm
MOV AX, 10h
MOV BX, 10h
CMP AX, BX
```
Expected: `AX=10 BX=10 ZF=1 CF=0` (values unchanged, flags reflect AX-BX)

### 2.9 MUL (unsigned)
```asm
MOV AL, 10h
MOV BL, 10h
MUL BL
```
Expected: `AX=0100h CF=0 OF=0` (0x10*0x10=0x100, fits in AL so CF/OF clear... actually result 0100h means AH!=0 -> CF=1). Verify: AL*BL=256=0x100 → AH=01, AL=00 → since AH≠0, `CF=1 OF=1`.

### 2.10 MUL — 16-bit into DX:AX
```asm
MOV AX, 0FFFFh
MOV BX, 0002h
MUL BX
```
Expected: `DX=0001 AX=FFFE` (0xFFFF * 2 = 0x1FFFE), `CF=1 OF=1` (DX≠0)

### 2.11 IMUL (signed)
```asm
MOV AL, -2       ; FEh
MOV BL, 5
IMUL BL
```
Expected: `AX=FFF6h` (-10 in two's complement), `CF=1 OF=1`? — for signed byte result -10 fits in AL as signed, so CF=OF=0 (sign-extension into AH matches). Verify against a reference emulator if unsure — this is a common IMUL edge case.

### 2.12 DIV (unsigned) — normal case
```asm
MOV AX, 000Ah
MOV BL, 0003h
DIV BL
```
Expected: `AL=03 (quotient) AH=01 (remainder)`

### 2.13 DIV — divide by zero (must trigger interrupt 0 / error handling)
```asm
MOV AX, 000Ah
MOV BL, 0
DIV BL
```
Expected: emulator raises a divide-error (INT 0) or halts with a clear
error — it must NOT silently produce garbage or crash the whole app.

### 2.14 IDIV (signed)
```asm
MOV AX, 0FFF6h    ; -10
MOV BL, 3
IDIV BL
```
Expected: `AL=FDh (-3, quotient)` `AH=FFh (-1, remainder)` — verify sign of remainder matches sign of dividend (C convention truncation).

### 2.15 CBW / CWD (sign extension)
```asm
MOV AL, 0FFh      ; -1 as byte
CBW
MOV AX, 0FFFFh    ; -1 as word
CWD
```
Expected: after CBW `AX=FFFF`; after CWD `DX=FFFF AX=FFFF`

### 2.16 DAA (BCD adjust after addition)
```asm
MOV AL, 15h        ; BCD 15
MOV BL, 27h        ; BCD 27
ADD AL, BL          ; binary sum = 3Ch
DAA
```
Expected: `AL=42h` (BCD for 15+27=42), `CF`/`AF` set as needed during adjust

### 2.17 AAA (ASCII adjust after addition)
```asm
MOV AL, 08h
MOV BL, 07h
ADD AL, BL         ; AL=0Fh
AAA
```
Expected: `AL=05h AH incremented by 1 CF=1 AF=1` (08+07=15 → ASCII adjust to AL=5, carry into AH)

---

## 3. Logic / Bit Manipulation

### 3.1 AND / OR / XOR / NOT
```asm
MOV AX, 0F0F0h
AND AX, 0FF00h
MOV BX, 0F0F0h
OR BX, 000Fh
MOV CX, 0FFFFh
XOR CX, 0F0F0h
MOV DX, 0000h
NOT DX
```
Expected: `AX=F000 BX=F0FF CX=0F0F DX=FFFF`

### 3.2 TEST (flags only)
```asm
MOV AX, 000Fh
TEST AX, 00F0h
```
Expected: `AX=000F ZF=1` (0F AND F0 = 0, AX unchanged)

### 3.3 SHL / SHR
```asm
MOV AL, 01h
SHL AL, 1
MOV BL, 80h
SHR BL, 1
```
Expected: `AL=02 CF=0`; `BL=40 CF=0` (bit shifted out captured in CF each time — verify with a case that sets CF, e.g. shift 81h right once → BL=40 CF=1)

### 3.4 SAR (arithmetic, sign-preserving)
```asm
MOV AL, 80h        ; -128 signed
SAR AL, 1
```
Expected: `AL=C0h` (sign bit replicated, -64 signed) — distinguishes from SHR which would give `AL=40h`

### 3.5 ROL / ROR
```asm
MOV AL, 81h
ROL AL, 1
MOV BL, 81h
ROR BL, 1
```
Expected: `AL=03h CF=1` (bit7 wraps to bit0 and CF); `BL=C0h CF=1`

### 3.6 RCL / RCR (through carry)
```asm
STC
MOV AL, 40h
RCL AL, 1
```
Expected: `AL=81h CF=0` (old carry shifted into bit0, bit7 shifted out to CF)

---

## 4. Control Flow

### 4.1 Unconditional JMP
```asm
JMP skip
MOV AX, 1111h   ; must be skipped
skip:
MOV AX, 2222h
```
Expected: `AX=2222` only (first MOV never executes)

### 4.2 Every conditional jump — build a table
For each pair below, set flags via CMP, then verify the jump is/isn't taken:

```asm
MOV AX, 5
CMP AX, 5
JE  equal_taken        ; ZF=1 → must jump
MOV BX, 1               ; must NOT execute
equal_taken:
MOV BX, 2

CMP AX, 3
JG  greater_taken       ; 5>3 → must jump
MOV CX, 1
greater_taken:
MOV CX, 2

CMP AX, 10
JL  less_taken           ; 5<10 → must jump
MOV DX, 1
less_taken:
MOV DX, 2
```
Expected: `BX=2 CX=2 DX=2` in all three cases (jumps taken correctly).
Repeat this pattern for JNE, JGE, JLE, JA, JAE, JB, JBE, JC, JNC, JO,
JNO, JS, JNS, JP, JNP — each needs one "taken" and one "not taken" case.

### 4.3 LOOP
```asm
MOV CX, 5
MOV AX, 0
top:
INC AX
LOOP top
```
Expected: `AX=05 CX=00` (loop runs exactly 5 times, CX decremented each time, stops at 0)

### 4.4 LOOPE / LOOPNE
```asm
MOV CX, 5
MOV AX, 0
MOV BX, 3
top2:
INC AX
CMP AX, BX
LOOPNE top2       ; loop while CX!=0 AND ZF=0 (not equal)
```
Expected: loop exits when AX==BX (ZF=1) OR CX hits 0, whichever first — trace both termination paths.

### 4.5 JCXZ
```asm
MOV CX, 0
JCXZ was_zero
MOV AX, 1
was_zero:
MOV AX, 2
```
Expected: `AX=2` (jump taken because CX=0)

### 4.6 CALL / RET (near, with stack check)
```asm
MOV SP, 0FFFEh
CALL myproc
MOV AX, 100h
JMP end
myproc:
MOV BX, 200h
RET
end:
```
Expected: `BX=200 AX=100 SP=0FFFE` (return address correctly pushed/popped, SP balanced)

### 4.7 Nested CALL
```asm
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
```
Expected: `AX=42 SP=0FFFE` — verifies stack handles nested return addresses correctly.

### 4.8 INT / IRET with flags preserved
```asm
MOV AX, 1234h
INT 21h          ; whatever your emulator implements (e.g. AH=4Ch exit, or a no-op test vector)
```
Expected: interrupt vector correctly invoked; if IRET is used, flags/CS/IP restored exactly as before the INT.

---

## 5. String Instructions

### 5.1 MOVSB with REP
```asm
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
```
Expected: bytes at `200h..204h` equal `1,2,3,4,5`; `SI=105h DI=205h CX=0`

### 5.2 MOVSB with DF set (direction reversed)
```asm
STD
MOV SI, 104h
MOV DI, 204h
MOV CX, 5
REP MOVSB
```
Expected: copy proceeds backward, SI/DI decrement each iteration instead of increment.

### 5.3 CMPSB with REPE
```asm
MOV SI, 100h
MOV DI, 200h
MOV CX, 3
CLD
REPE CMPSB
```
Expected: compares byte by byte while equal; stops early on first mismatch or after CX exhausted; ZF reflects the last comparison.

### 5.4 SCASB with REPNE
```asm
MOV DI, 100h
MOV CX, 10
MOV AL, 5AH   ; value to search for
CLD
REPNE SCASB
```
Expected: DI stops just past the matching byte (or exhausts CX if not found); ZF=1 if found.

### 5.5 LODSB / STOSB (no REP, single step verification)
```asm
MOV SI, 100h
MOV BYTE PTR [100h], 99h
LODSB
MOV DI, 200h
STOSB
```
Expected: `AL=99h`, byte at `200h`=99h, `SI=101h DI=201h`

---

## 6. Addressing Mode Coverage (explicit, isolated)

```asm
; direct
MOV AX, [1000h]

; register indirect
MOV BX, 1000h
MOV AX, [BX]

; register indirect via SI/DI
MOV SI, 1000h
MOV AX, [SI]
MOV DI, 1000h
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
```
Expected: each form resolves to the correct physical address
(`segment*16 + offset`), with `[BP+...]` defaulting to the SS segment
unless overridden, and everything else defaulting to DS unless overridden.

---

## 7. Processor Control

```asm
CLC
STC
CMC
CLD
STD
CLI
STI
NOP
HLT
```
Expected: each flag bit toggles exactly as named (`CLC`→CF=0, `STC`→CF=1,
`CMC`→CF flips, `CLD`→DF=0, `STD`→DF=1, `CLI`→IF=0, `STI`→IF=1); `NOP`
advances IP with no state change; `HLT` stops execution cleanly (not a crash).

---

## 8. Assembler Directive Coverage

```asm
ORG 100h

message DB 'Hello$'
count   DW 10
buffer  DB 20 DUP(0)
MAX     EQU 100

start:
    MOV CX, MAX
    MOV AX, count
    LEA DX, message
    MOV AH, 09h
    INT 21h
    MOV AH, 4Ch
    INT 21h

END start
```
Expected: assembler correctly resolves `message`/`count`/`buffer` labels
to addresses, expands `20 DUP(0)` into 20 zero bytes, substitutes `MAX`
with `100` wherever used, and treats `END start` as program entry point.

### 8.1 Label arithmetic (`OFFSET NAME + 2`)

Operands support `label + constant` and `label - constant` (spacing around
the operator is insignificant), both bare and with `OFFSET`, plus inside
`[...]` memory references. This is the standard MASM idiom for reaching
into a DOS `INT 21h AH=0Ah` input buffer past its max-length and
actual-length bytes:

```asm
.DATA
NAME DB 20
     DB ?
     DB 20 DUP('$')
.CODE
MOV DX, OFFSET NAME + 2
HLT
```
Expected: `DX` = address of `NAME` + 2 (no "Undefined label" error).
Covered by the "Label arithmetic in operands" tests in
`tests/core/user_reported.test.ts` (spacing variants, bare form,
subtraction, `[NAME + 2]` byte read, undefined-label errors preserved).

---

## 9. Full Integration Programs

These exercise many features together — use them as smoke tests once
individual instructions pass.

### 9.1 Sum of an array
```asm
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
HLT
```
Expected: `AX=000Fh` (1+2+3+4+5=15)
*(Note: If using DOS exit `MOV AH, 4Ch; INT 21h`, AH is set to 4Ch so AX=4C0Fh with exit code AL=0Fh).*

### 9.2 Factorial (iterative, CX=5)
```asm
ORG 100h
MOV CX, 5
MOV AX, 1
fact_loop:
    MOV BX, CX
    MUL BX
    LOOP fact_loop
HLT
```
Expected: `AX=0078h` (5!=120)
*(Note: If using DOS exit `MOV AH, 4Ch; INT 21h`, AH is set to 4Ch so AX=4C78h with exit code AL=78h).*

### 9.3 String reverse (in-place)
```asm
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
HLT
```
Expected: `str` becomes `'EDCBA'` (view memory in Memory Viewer at row 00100)

### 9.4 Find max in an array
```asm
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
HLT
```
Expected: `AL=09h` (max of the array)

### 9.5 Fibonacci sequence (first 8 terms into memory)
```asm
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
HLT
```
Expected: `fib` = `0,1,1,2,3,5,8,13` (view in Memory Viewer at row 00100: `00 01 01 02 03 05 08 0D`)

---

## How to use this suite

1. Run each numbered test independently (reset CPU/memory between tests).
2. Compare final register/flag state to the "Expected" line.
3. For the conditional-jump table (4.2), generate the mirror case for
   every listed mnemonic (both "taken" and "not taken") — that's the
   single highest-value area to get exhaustive, since jump-flag logic
   errors are the most common emulator bug.
4. Once all individual tests pass, run section 9 end-to-end — if any
   integration test fails while the isolated tests passed, the bug is
   likely in flag propagation across instructions or in loop/pointer
   arithmetic (SI/DI increment/decrement direction, wraparound at
   segment boundaries, etc.).
5. Deliberately test failure paths too: divide by zero (2.13), stack
   overflow (push past SP=0000), and an unknown/invalid opcode — your
   emulator should report a clear error rather than silently
   misbehaving or crashing the whole page.
