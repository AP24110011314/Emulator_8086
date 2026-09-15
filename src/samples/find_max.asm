; Find Maximum — largest number in an array
; Demonstrates: DB data, OFFSET, [SI] addressing, CMP, JAE, LOOP
; Result: AL = 09H (largest of 3, 9, 2, 7, 5)
;
; NOTE: the array MUST be defined with DB. [SI] reads real memory, so
; pointing SI at code (e.g. MOV SI, 0000H with no data) scans the
; program's own bytes and gives a meaningless result.

        ORG 100h
arr     DB 3, 9, 2, 7, 5
        MOV  CX, 4          ; 4 comparisons for 5 elements
        MOV  SI, OFFSET arr
        MOV  AL, [SI]       ; AL = first element

NEXT:
        INC  SI
        CMP  AL, [SI]
        JAE  SKIP           ; AL >= [SI]? keep current maximum
        MOV  AL, [SI]       ; new maximum found

SKIP:
        LOOP NEXT

        HLT                 ; Done — AL = 09H
