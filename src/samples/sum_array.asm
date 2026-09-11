; Sum Array — adds 5 numbers and stores the result in AX
; Demonstrates: MOV, ADD, LOOP, INC, memory access

        MOV  AX, 0          ; AX = accumulator (sum = 0)
        MOV  CX, 5          ; CX = loop counter (5 elements)
        MOV  BX, 0          ; BX = array index

SUM_LOOP:
        ADD  AX, BX         ; AX += BX (simulate loading array[BX])
        INC  BX             ; Next element (value 0,1,2,3,4)
        LOOP SUM_LOOP       ; Decrement CX and jump if CX != 0

        ; Result: AX = 0+1+2+3+4 = 10 = 0x000A
        HLT
