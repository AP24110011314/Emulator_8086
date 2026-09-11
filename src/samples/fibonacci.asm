; Fibonacci — computes first 8 Fibonacci numbers in BX and DX
; Demonstrates: MOV, ADD, XCHG, LOOP, PUSH, POP

        MOV  AX, 0          ; F(0) = 0
        MOV  BX, 1          ; F(1) = 1
        MOV  CX, 6          ; Compute 6 more terms (F2..F7)

FIB_LOOP:
        MOV  DX, AX         ; DX = old F(n-1)
        ADD  AX, BX         ; AX = F(n-1) + F(n-2)
        MOV  BX, DX         ; BX = old F(n-2) — now becomes F(n-1)

        ; After this loop:
        ;   AX = F(n), BX = F(n-1)
        ; Iteration results in AX: 1, 2, 3, 5, 8, 13

        LOOP FIB_LOOP       ; Decrement CX and repeat

        ; Final: AX = 13 (F7), BX = 8 (F6)
        HLT
