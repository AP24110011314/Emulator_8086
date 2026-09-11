// Sample 8086 assembly programs for the emulator

export interface SampleProgram {
  id: string;
  name: string;
  description: string;
  code: string;
}

export const SAMPLES: SampleProgram[] = [
  {
    id: 'sum_array',
    name: 'Sum Array',
    description: 'Adds numbers 0–4 using LOOP. Result in AX.',
    code: `; Sum Array — adds values 0 through 4
; Demonstrates: MOV, ADD, INC, LOOP
; Result: AX = 0+1+2+3+4 = 10 (0x000A)

        MOV  AX, 0          ; Accumulator = 0
        MOV  CX, 5          ; Loop 5 times
        MOV  BX, 0          ; BX = current value

SUM_LOOP:
        ADD  AX, BX         ; AX += BX
        INC  BX             ; BX++
        LOOP SUM_LOOP       ; CX--; if CX!=0 jump

        HLT                 ; Done — AX = 10`
  },
  {
    id: 'fibonacci',
    name: 'Fibonacci',
    description: 'Computes Fibonacci numbers. Final: AX=13, BX=8.',
    code: `; Fibonacci sequence — F(0)=0, F(1)=1, F(2)=1 ...
; Demonstrates: MOV, ADD, XCHG, LOOP
; After 6 iterations: AX = F(7) = 13, BX = F(6) = 8

        MOV  AX, 0          ; F(n-2) = 0
        MOV  BX, 1          ; F(n-1) = 1
        MOV  CX, 6          ; Compute 6 more terms

FIB_LOOP:
        MOV  DX, AX         ; Save F(n-2)
        ADD  AX, BX         ; AX = new F(n)
        MOV  BX, DX         ; BX = old F(n-2) becomes new F(n-1)
        LOOP FIB_LOOP

        ; AX = 13, BX = 8
        HLT`
  },
  {
    id: 'countdown',
    name: 'Countdown',
    description: 'Counts down from 10, prints digits via INT 21h.',
    code: `; Countdown from 10 to 1 using INT 21h service 02h
; Demonstrates: MOV, DEC, CMP, JNE, INT 21h

        MOV  CX, 10         ; Counter = 10

COUNTDOWN:
        MOV  AH, 02h        ; Service 02h: print char
        MOV  AL, CX         ; Current count
        ADD  AL, 30h        ; ASCII digit ('0'=0x30)
        MOV  DL, AL         ; Character to print
        INT  21h             ; Output digit

        MOV  AH, 02h
        MOV  DL, 0Ah        ; Newline
        INT  21h

        DEC  CX             ; CX--
        CMP  CX, 0
        JNE  COUNTDOWN      ; Loop if CX != 0

        MOV  AH, 4Ch        ; Exit
        INT  21h`
  },
  {
    id: 'hello_world',
    name: 'Hello World',
    description: 'Prints "Hello, World!" using INT 21h service 09h.',
    code: `; Hello World — prints "Hello, World!" via INT 21h service 09h
; Demonstrates: .DATA segment, DB string, MOV, INT 21h

.DATA
    msg DB 'Hello, World!$'

.CODE
    MOV  AX, @DATA
    MOV  DS, AX         ; Set DS to point to data segment

    MOV  AH, 09h        ; Service 09h: print '$'-terminated string
    MOV  DX, msg        ; Offset of msg
    INT  21h            ; DOS interrupt

    MOV  AH, 4Ch        ; Service 4Ch: exit to DOS
    INT  21h`
  },
  {
    id: 'register_demo',
    name: 'Register Demo',
    description: 'Shows register operations: PUSH, POP, XCHG.',
    code: `; Register Demo — shows PUSH, POP, XCHG, arithmetic
; Watch how registers change at each step!

        MOV  AX, 0x1234     ; AX = 0x1234
        MOV  BX, 0x5678     ; BX = 0x5678
        XCHG AX, BX         ; Swap AX and BX

        PUSH AX             ; Push AX onto stack
        PUSH BX             ; Push BX onto stack

        MOV  AX, 0          ; Clear AX
        MOV  BX, 0          ; Clear BX

        POP  AX             ; Pop into AX (gets 0x1234)
        POP  BX             ; Pop into BX (gets 0x5678)

        ADD  AX, BX         ; AX = 0x1234 + 0x5678 = 0x68AC
        MOV  CX, AX         ; Save result in CX

        HLT`
  },
  {
    id: 'led_counter',
    name: 'LED Counter (Port 2)',
    description: 'Outputs binary counts to Port 2 LEDs.',
    code: `; LED Binary Counter — writes to Port 2
; Watch the circular LED output display count up in real-time!

        MOV  AL, 0          ; Start counter at 0
LED_LOOP:
        OUT  2, AL          ; Output to Port 2 LEDs
        INC  AL             ; Increment count
        CMP  AL, 255        ; Count up
        JNE  LED_LOOP

        HLT`
  },
  {
    id: 'io_port_demo',
    name: 'I/O Port Echo (Port 1 → 2)',
    description: 'Reads Input Port 1 and writes inverted to Port 2 LEDs.',
    code: `; I/O Port Echo — reads Port 1 and displays on Port 2 LEDs
; Change the "Input Port 1" hex value in the UI to see the LEDs update!

        IN   AL, 1          ; Read byte from Input Port 1
        NOT  AL             ; Invert all bits
        OUT  2, AL          ; Output inverted byte to Port 2 LEDs
        HLT`
  },
  {
    id: 'string_ops',
    name: 'String Operations (REP MOVSB, LODSB)',
    description: 'String copy and conversion using SI/DI, DF, and REP.',
    code: `; String Operations Demo
; Demonstrates: .DATA, DB, OFFSET, CLD, REP MOVSB, LODSB, STOSB
.DATA
    SRC_STR DB '8086 ARCHITECTURE$'
    DST_STR DB 20 DUP(?)

.CODE
    MOV AX, @DATA
    MOV DS, AX
    MOV ES, AX

    ; Copy 17 bytes from SRC_STR to DST_STR
    CLD
    MOV SI, OFFSET SRC_STR
    MOV DI, OFFSET DST_STR
    MOV CX, 17
    REP MOVSB

    ; Print copied string via INT 21h
    MOV AH, 09h
    MOV DX, OFFSET DST_STR
    INT 21h

    MOV AH, 4Ch
    INT 21h`
  },
  {
    id: 'procedures_demo',
    name: 'Procedures & Stack (PROC / RET n)',
    description: 'Demonstrates modular subroutines, parameter passing, and RET n.',
    code: `; Procedures & Stack Frame Demo
; Demonstrates: PROC, ENDP, CALL, RET n, stack parameters

.CODE
    ; Push two parameters onto the stack
    PUSH 15h
    PUSH 25h
    CALL ADD_NUMS       ; Call subroutine

    ; Result returned in AX (15h + 25h = 3Ah = 58)
    HLT

ADD_NUMS PROC
    PUSH BP
    MOV  BP, SP

    MOV  AX, [BP+6]     ; First argument (15h)
    ADD  AX, [BP+4]     ; Second argument (25h)

    POP  BP
    RET  4              ; Return and clean up 4 bytes of arguments
ADD_NUMS ENDP`
  }
];

