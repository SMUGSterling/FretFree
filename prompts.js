'use strict';
/* Writing prompts are original FretFree teaching material, dedicated under CC0 1.0.
   Keys are written pitch: a B♭ clarinet student asked to write "in G" sees G major.
   Goal types: bars (filled bars), lengths (allowed note lengths in whole notes), start/end (scale degree in semitones),
   endBar (degree on the last note of a bar), steps (moves of a whole step or less), range (semitones),
   inKey (major or minor scale; minor allows the raised 6th and 7th), atLeast (count of notes matching a kind).
   Each example is a melody that meets every goal; tests/check.cjs keeps them honest. */
const writingPrompts=[
 {id:'first-melody',example:'C D E F | G2 E2 | F D E D | C2 C2',title:'My first melody',level:'Beginner',meter:'4/4',unit:'1/4',key:'C',tempo:90,bars:4,
  text:'Write 4 bars in C major using quarter and half notes. Start and end on C.',
  goals:[{type:'bars',label:'Fill all 4 bars with notes'},{type:'lengths',allowed:[.25,.5],label:'Use only quarter and half notes'},{type:'start',degree:0,label:'Start on C'},{type:'end',degree:0,label:'End on C'},{type:'inKey',scale:'major',label:'Stay in C major (no sharps or flats)'}]},
 {id:'step-by-step',example:'G A B A | G A B c | d c B A | B A G2',title:'Step by step',level:'Beginner',meter:'4/4',unit:'1/4',key:'G',tempo:90,bars:4,
  text:'Write 4 bars in G major that move only by step (to the next note up or down) or repeat a note. End on G.',
  goals:[{type:'bars',label:'Fill all 4 bars with notes'},{type:'steps',label:'Move only by step or repeat a note'},{type:'end',degree:0,label:'End on G'},{type:'inKey',scale:'major',label:'Stay in G major (F♯ is in the key)'}]},
 {id:'rest-a-moment',example:'C E | G z | E z | C2',title:'Rest a moment',level:'Beginner',meter:'2/4',unit:'1/4',key:'C',tempo:84,bars:4,
  text:'Write 4 bars in 2/4 in C major with at least two rests. Every bar needs at least one note. End on C.',
  goals:[{type:'bars',label:'Put at least one note in all 4 bars'},{type:'atLeast',kind:'rest',count:2,label:'Use at least two rests'},{type:'end',degree:0,label:'End on C'},{type:'inKey',scale:'major',label:'Stay in C major'}]},
 {id:'little-waltz',example:'D F A | d3 | c B A | D3',title:'A little waltz',level:'Beginner',meter:'3/4',unit:'1/4',key:'D',tempo:100,bars:4,
  text:'Write a 4-bar waltz in D major (3 beats per bar). Use at least one dotted half note. End on D.',
  goals:[{type:'bars',label:'Fill all 4 bars with notes'},{type:'lengths',allowed:[.25,.5,.75],label:'Use quarter, half and dotted half notes'},{type:'atLeast',kind:'dotted-half',count:1,label:'Use at least one dotted half note'},{type:'end',degree:0,label:'End on D'},{type:'inKey',scale:'major',label:'Stay in D major (F♯ and C♯ are in the key)'}]},
 {id:'eighth-notes',example:'F2 A2 c2 A2 | B A G F G2 A2 | B2 G2 E2 C2 | F4 F4',title:'Running eighths',level:'Beginner',meter:'4/4',unit:'1/8',key:'F',tempo:84,bars:4,
  text:'Write 4 bars in F major with at least four eighth notes. End on F.',
  goals:[{type:'bars',label:'Fill all 4 bars with notes'},{type:'lengths',allowed:[.125,.25,.5],label:'Use eighth, quarter and half notes'},{type:'atLeast',kind:'eighth',count:4,label:'Use at least four eighth notes'},{type:'end',degree:0,label:'End on F'},{type:'inKey',scale:'major',label:'Stay in F major (B♭ is in the key)'}]},
 {id:'question-answer',example:'G A B c | d2 B2 | c A F A | d4 | B c d e | d B G B | A F A F | G4',title:'Question and answer',level:'Intermediate',meter:'4/4',unit:'1/4',key:'G',tempo:96,bars:8,
  text:'Write an 8-bar melody in G major. Bars 1–4 ask a question that ends on D; bars 5–8 answer it and end on G.',
  goals:[{type:'bars',label:'Fill all 8 bars with notes'},{type:'endBar',bar:4,degree:7,label:'Bar 4 ends on D (the question)'},{type:'end',degree:0,label:'Bar 8 ends on G (the answer)'},{type:'inKey',scale:'major',label:'Stay in G major'}]},
 {id:'minor-mood',example:'A B c d | e2 d2 | c B ^G B | A4',title:'Minor mood',level:'Intermediate',meter:'4/4',unit:'1/4',key:'Am',tempo:80,bars:4,
  text:'Write 4 bars in A minor. Use the raised 7th, G♯, at least once, and end on A.',
  goals:[{type:'bars',label:'Fill all 4 bars with notes'},{type:'atLeast',kind:'degree',degree:11,count:1,label:'Use G♯ (the raised 7th) at least once'},{type:'end',degree:0,label:'End on A'},{type:'inKey',scale:'minor',label:'Stay in A minor'}]},
 {id:'leap-and-land',example:'F A c A | B G E C | F c A F | F4',title:'Leap and land',level:'Intermediate',meter:'4/4',unit:'1/4',key:'F',tempo:88,bars:4,
  text:'Write 4 bars in F major with at least one leap of a 4th or more, staying within one octave. End on F.',
  goals:[{type:'bars',label:'Fill all 4 bars with notes'},{type:'atLeast',kind:'leap',count:1,label:'Leap a 4th or more at least once'},{type:'range',max:12,label:'Stay within one octave'},{type:'end',degree:0,label:'End on F'},{type:'inKey',scale:'major',label:'Stay in F major'}]},
 {id:'little-jig',example:'D3 F2 A | d3 A2 F | G2 E F2 D | E2 C D3',title:'A little jig',level:'Intermediate',meter:'6/8',unit:'1/8',key:'D',tempo:100,bars:4,
  text:'Write a 4-bar jig in D major in 6/8, using dotted quarters, quarters and eighths, with at least one dotted quarter. End on D.',
  goals:[{type:'bars',label:'Fill all 4 bars with notes'},{type:'lengths',allowed:[.375,.25,.125],label:'Use dotted quarters, quarters and eighths'},{type:'atLeast',kind:'dotted-quarter',count:1,label:'Use at least one dotted quarter'},{type:'end',degree:0,label:'End on D'},{type:'inKey',scale:'major',label:'Stay in D major'}]}
];
