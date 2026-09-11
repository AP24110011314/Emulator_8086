; Hello World — INT 21h
; Outputs "Hello, World!" using DOS interrupt 21h service 02h (write char)
; Then terminates with service 4Ch

        MOV  AH, 09h        ; Service 09h: write $-terminated string
        MOV  DX, 0100h      ; Offset of our message (below)
        INT  21h             ; Print string
        MOV  AH, 4Ch        ; Service 4Ch: exit
        MOV  AL, 0          ; Return code 0
        INT  21h             ; Exit

; String data (would be at DS:0100h in a real .COM file)
; In this emulator, load the string manually via the UI or use service 02h loop

; Alternative: write char by char
; MOV  CX, 13        ; 13 characters
; MOV  BX, OFFSET msg
; NEXT:
;   MOV  AH, 02h
;   MOV  DL, [BX]
;   INT  21h
;   INC  BX
;   LOOP NEXT
;   MOV  AH, 4Ch
;   INT  21h
