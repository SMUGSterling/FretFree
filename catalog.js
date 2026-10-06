/* All new teaching notation and original studies are dedicated under CC0 1.0. */
// Instruments: clef, `shift` (the written part is this many semitones above the concert ABC source) and the sound.
// `sound` is the playback octave against the source (default -12 when shift is -12, else 0), so the part is written
// shift - sound semitones above how it sounds. `partials` are harmonic amplitudes (fundamental first) for a periodic
// wave, with `wave` as the fallback; `env` is attack/decay/sustain/release in seconds, or `pluck`, the time a struck
// or plucked note takes to fade to about a third; `vibrato` is a rate (Hz), depth (cents) and delay (s).
const instruments = {
 'Flute':{family:'Woodwinds',clef:'treble',shift:0,wave:'sine',partials:[1,.3,.12,.05,.03,.01],env:{attack:.04,decay:.1,sustain:.8,release:.025},vibrato:{rate:5,depth:12,delay:.25}},
 'Recorder':{family:'Woodwinds',clef:'treble',shift:0,wave:'sine',partials:[1,.06,.12,.02,.03],env:{attack:.02,decay:.05,sustain:.85,release:.025}},
 'Oboe':{family:'Woodwinds',clef:'treble',shift:0,wave:'sawtooth',partials:[.45,.8,1,.75,.55,.45,.3,.2,.15,.1,.06],env:{attack:.03,decay:.08,sustain:.8,release:.04},vibrato:{rate:5.5,depth:8,delay:.3}},
 'Clarinet in B♭':{family:'Woodwinds',clef:'treble',shift:2,wave:'triangle',partials:[1,.03,.7,.03,.45,.02,.25,.02,.12,.01,.06],env:{attack:.03,decay:.08,sustain:.85,release:.04}},
 'Bassoon':{family:'Woodwinds',clef:'bass',shift:-12,wave:'sawtooth',partials:[.6,1,.85,.6,.45,.3,.2,.12,.08],env:{attack:.04,decay:.1,sustain:.8,release:.05}},
 'Alto sax in E♭':{family:'Woodwinds',clef:'treble',shift:9,wave:'sawtooth',partials:[1,.75,.6,.5,.4,.32,.25,.18,.12,.08,.05],env:{attack:.03,decay:.1,sustain:.75,release:.05},vibrato:{rate:5,depth:10,delay:.35}},
 'Tenor sax in B♭':{family:'Woodwinds',clef:'treble',shift:14,wave:'sawtooth',partials:[1,.95,.6,.4,.3,.18,.12,.07,.04],env:{attack:.035,decay:.1,sustain:.75,release:.05},vibrato:{rate:4.8,depth:10,delay:.35}},
 'Baritone sax in E♭':{family:'Woodwinds',clef:'treble',shift:9,sound:-12,wave:'sawtooth',partials:[1,1,.75,.55,.45,.32,.22,.15,.1],env:{attack:.04,decay:.1,sustain:.75,release:.06}},
 'Trumpet in B♭':{family:'Brass',clef:'treble',shift:2,wave:'sawtooth',partials:[.8,1,.9,.75,.6,.5,.4,.3,.22,.16,.11,.07],env:{attack:.035,decay:.08,sustain:.75,release:.04}},
 'Horn in F':{family:'Brass',clef:'treble',shift:7,wave:'triangle',partials:[1,.5,.25,.12,.06,.03],env:{attack:.06,decay:.1,sustain:.85,release:.08}},
 'Trombone':{family:'Brass',clef:'bass',shift:-12,wave:'sawtooth',partials:[.9,1,.85,.7,.55,.4,.28,.18,.1,.06],env:{attack:.05,decay:.1,sustain:.8,release:.06}},
 'Euphonium':{family:'Brass',clef:'bass',shift:-12,wave:'triangle',partials:[1,.7,.45,.25,.12,.05],env:{attack:.05,decay:.1,sustain:.85,release:.07},vibrato:{rate:5,depth:6,delay:.4}},
 'Tuba':{family:'Brass',clef:'bass',shift:-12,wave:'triangle',partials:[1,.45,.2,.08,.03],env:{attack:.07,decay:.1,sustain:.85,release:.08}},
 'Violin':{family:'Strings',clef:'treble',shift:0,wave:'triangle',partials:[1,.55,.42,.33,.28,.22,.18,.14,.11,.09,.07,.05],env:{attack:.06,decay:.1,sustain:.85,release:.06},vibrato:{rate:5.5,depth:15,delay:.2}},
 'Viola':{family:'Strings',clef:'alto',shift:0,wave:'triangle',partials:[1,.6,.65,.45,.25,.2,.12,.08,.05],env:{attack:.07,decay:.1,sustain:.85,release:.07},vibrato:{rate:5.2,depth:14,delay:.22}},
 'Cello':{family:'Strings',clef:'bass',shift:-12,wave:'triangle',partials:[1,.75,.55,.4,.3,.2,.14,.09,.06],env:{attack:.07,decay:.1,sustain:.85,release:.08},vibrato:{rate:5,depth:15,delay:.25}},
 'Double bass':{family:'Strings',clef:'bass',shift:-12,sound:-24,wave:'triangle',partials:[1,.8,.45,.25,.15,.08],env:{attack:.08,decay:.12,sustain:.8,release:.1},vibrato:{rate:4.5,depth:8,delay:.35}},
 'Guitar':{family:'Guitars',clef:'treble',shift:0,wave:'triangle',partials:[1,.9,.45,.4,.1,.22,.12,.05,.04],env:{pluck:1.1,release:.06}},
 'Ukulele':{family:'Guitars',clef:'treble',shift:0,wave:'triangle',partials:[1,.3,.45,.1,.15,.05],env:{pluck:.5,release:.05}},
 'Bass guitar':{family:'Guitars',clef:'bass',shift:-12,sound:-24,wave:'triangle',partials:[1,.55,.25,.12,.05],env:{pluck:1.6,release:.06}},
 'Piano':{family:'Keyboard and percussion',clef:'treble',shift:0,wave:'triangle',partials:[1,.55,.32,.22,.12,.09,.05,.03],env:{pluck:1.4,release:.08}},
 'Glockenspiel':{family:'Keyboard and percussion',clef:'treble',shift:0,sound:24,wave:'sine',partials:[1,0,.1,.25,0,.08],env:{pluck:.6,release:.05}},
 'Voice':{family:'Voice',clef:'treble',shift:0,wave:'sine',partials:[1,.75,.45,.32,.25,.12,.07,.04],env:{attack:.08,decay:.1,sustain:.9,release:.08},vibrato:{rate:5.5,depth:20,delay:.3}}
};
function tune(title,composer,meter,key,bpm,notes){return `X:1\nT:${title}\nC:${composer}\nM:${meter}\nL:1/4\nQ:1/4=${bpm}\nK:${key}\n${notes}`;}
const catalog = [
 {id:'ode',title:'Ode to Joy',composer:'Ludwig van Beethoven',level:'Beginner',kind:'historic',skill:'Stepwise motion',description:'The familiar theme from Symphony No. 9, arranged as a single melody.',date:'1824',source:'https://www.loc.gov/item/2021668114/',sourceLabel:'Library of Congress · Symphony No. 9 manuscript',rights:'Composition first performed and published in the 1820s. Newly typeset, simplified melody theme; no modern edition or recording is included.',abc:tune('Ode to Joy','Ludwig van Beethoven · teaching melody','4/4','C',100,'E E F G | G F E D | C C D E | E3/2 D/2 D2 |\nE E F G | G F E D | C C D E | D3/2 C/2 C2 |\nD D E C | D E/2 F/2 E C | D E/2 F/2 E D | C D G,2 |\nE E F G | G F E D | C C D E | D3/2 C/2 C2 |]')},
 {id:'mozart',title:'Ah! vous dirai-je, maman',composer:'Traditional French melody',level:'Beginner',kind:'historic',skill:'Repeated notes',description:'The melody also known as Twinkle, Twinkle, Little Star; used by Mozart in K. 265.',date:'18th century',source:'https://imslp.org/wiki/12_Variations_on_%22Ah_vous_dirai-je,_Maman%22,_K.265/300e_(Mozart,_Wolfgang_Amadeus)',sourceLabel:'Historical work reference · Mozart K. 265',rights:'18th-century tune, also used in Mozart’s variations (published 1785). Newly typeset melody only; no lyrics or modern arrangement.',abc:tune('Ah! vous dirai-je, maman','Traditional · teaching melody','4/4','C',96,'C C G G | A A G2 | F F E E | D D C2 |\nG G F F | E E D2 | G G F F | E E D2 |\nC C G G | A A G2 | F F E E | D D C2 |]')},
 {id:'elise',title:'Für Elise · opening',composer:'Ludwig van Beethoven',level:'Intermediate',kind:'historic',skill:'Chromatic notes',description:'A short excerpt of the opening melody, without piano accompaniment.',date:'1867 publication',source:'https://imslp.org/wiki/F%C3%BCr_Elise,_WoO_59_(Beethoven,_Ludwig_van)',sourceLabel:'Historical work reference · WoO 59',rights:'Composed 1810; first published 1867. Newly typeset opening melody excerpt only, not the complete piano work.',abc:tune('Für Elise · opening melody','Ludwig van Beethoven · excerpt','3/4','Am',72,'e/2 ^d/2 | e/2 ^d/2 e/2 B/2 d/2 c/2 | A z/2 C/2 E/2 A/2 | B z/2 E/2 ^G/2 B/2 |\nc z/2 E/2 e/2 ^d/2 | e/2 ^d/2 e/2 B/2 d/2 c/2 | A z/2 C/2 E/2 A/2 |\nB z/2 E/2 c/2 B/2 | A2 |]')},
 {id:'bach',title:'Prelude in C · first four bars',composer:'Johann Sebastian Bach',level:'Intermediate',kind:'historic',skill:'Arpeggios',description:'An opening study based on BWV 846, with the broken-chord pattern in a single voice.',date:'1722',source:'https://imslp.org/wiki/Prelude_and_Fugue_in_C_major,_BWV_846_(Bach,_Johann_Sebastian)',sourceLabel:'Historical work reference · BWV 846',rights:'From The Well-Tempered Clavier, Book I (1722). Newly typeset single-voice teaching reduction of the first four bars; sustained bass voices are omitted.',abc:'X:1\nT:Prelude in C · first four bars\nC:J. S. Bach · single-voice reduction\nM:4/4\nL:1/16\nQ:1/4=60\nK:C\nC E G c e G c e C E G c e G c e |\nC D A d f A d f C D A d f A d f |\nB, D G d f G d f B, D G d f G d f |\nC E G c e G c e C E G c e G c e |]'}
];
const studies = [
 ['first','First steps','Beginner','Stepwise motion','4/4','C',80,'C D E F | G2 G2 | F E D C | D2 C2 |\nE F G A | G F E D | C E G E | D2 C2 |]'],
 ['skipping','Skipping stones','Beginner','Thirds and leaps','4/4','C',88,'C E D F | E G F A | G E F D | E2 C2 |\nC G E C | D A F D | E G F D | C4 |]'],
 ['waltz','A small waltz','Beginner','Triple meter','3/4','G',90,'G B d | c A F | G2 B | A3 |\nB c d | e d c | B A F | G3 |]'],
 ['eighths','Little engine','Beginner','Eighth-note rhythm','3/4','C',90,'C/2 D/2 E E | D/2 E/2 F F | E/2 F/2 G E | D C2 |\nG/2 A/2 G E | F/2 G/2 F D | E/2 F/2 E D | C3 |]'],
 ['minor','After the rain','Beginner','Minor tonality','4/4','Am',76,'A, C E D | C2 A,2 | B, D F E | D2 B,2 |\nC E A G | F E D C | B, C D B, | A,4 |]'],
 ['six','Rolling hills','Intermediate','Compound meter','6/8','D',80,'D/2 E/2 F/2 A/2 F/2 E/2 | D/2 F/2 A/2 d3/2 |\nc/2 B/2 A/2 G/2 F/2 E/2 | F3/2 D3/2 |\nA/2 B/2 c/2 d/2 c/2 B/2 | A/2 G/2 F/2 E3/2 |\nF/2 A/2 d/2 c/2 B/2 A/2 | F3/2 D3/2 |]'],
 ['rests','Room to breathe','Beginner','Rests and phrasing','4/4','F',82,'F A z c | B2 A2 | G z A G | F2 z2 |\nA c z d | c2 A2 | B A G z | F4 |]'],
 ['chords','Three-note colors','Intermediate','Chords and harmony','4/4','C',70,'[CEG]2 z2 | [DFA]2 z2 | [EGB]2 [DFA]2 | [CEG]4 |\n[FAc]2 [CEG]2 | [GBd]2 z2 | [CEG]2 [GBd]2 | [CEG]4 |]']
];
for(const [id,title,level,skill,meter,key,bpm,notes] of studies) catalog.push({id,title,composer:'FretFree original study',level,skill,kind:'original',description:`An original short exercise for ${skill.toLowerCase()}.`,date:'Created for FretFree',rights:'Original exercise and notation created for this project. Dedicated to the public domain under CC0 1.0.',source:'https://creativecommons.org/publicdomain/zero/1.0/',sourceLabel:'CC0 1.0 dedication',abc:tune(title,'FretFree · CC0',meter,key,bpm,notes)});
