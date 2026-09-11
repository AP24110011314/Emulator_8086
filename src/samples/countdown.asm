; Countdown — counts from 10 down to 0 and prints each digit via INT 21h
; Demonstrates: MOV, DEC, CMP, JL, INT 21h service 02h

        MOV  CX, 10         ; Start counter at 10

COUNTDOWN:
        MOV  AX, CX         ; Copy counter to AX
        ADD  AL, 30h        ; Convert digit to ASCII ('0' = 0x30)
        MOV  AH, 02h        ; Service 02h: write character
        MOV  DL, AL         ; Character to print
        INT  21h             ; Print digit

        MOV  AH, 02h        ; Print newline (CR)
        MOV  DL, 0Dh
        INT  21h
        MOV  AH, 02h        ; Print newline (LF)
        MOV  DL, 0Ah
        INT  21h

        DEC  CX             ; Decrement counter
        CMP  CX, 0          ; Compare with 0
        JNE  COUNTDOWN      ; If not zero, loop

        MOV  AH, 4Ch        ; Exit
        INT  21h
