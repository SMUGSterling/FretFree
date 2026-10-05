'use strict';
// Match musical events, never character offsets in the altered display string.
function scoreEvents(tune){
 const counts=new Map(),bars=new Map(),occupied=new Map(),out=[];
 for(const line of tune.lines||[])for(const [s,staff] of (line.staff||[]).entries())for(const [v,voice] of staff.voices.entries()){
  const id=s+':'+v;
  for(const element of voice){
   if(!['note','bar'].includes(element.el_type))continue;
   const ordinal=counts.get(id)||0;counts.set(id,ordinal+1);
   const measure=bars.get(id)||1;
   out.push({element,key:id+':'+ordinal,measure});
   if(element.el_type==='note')occupied.set(id,true);
   if(element.el_type==='bar'&&occupied.get(id)){bars.set(id,measure+1);occupied.set(id,false)}
  }
 }
 return out;
}
// Sounding length of each note in whole notes. abcjs puts a tuplet's multiplier only on its first note,
// so carry it per voice until the note marked endTriplet.
function effectiveDurations(events){
 const out=new Map(),tuplet=new Map();
 for(const {element,key} of events){
  if(element.el_type!=='note')continue;
  const voice=key.split(':').slice(0,2).join(':');
  if(element.startTriplet)tuplet.set(voice,element.tripletMultiplier||1);
  out.set(element,(element.duration||0)*(tuplet.get(voice)||1));
  if(element.endTriplet)tuplet.delete(voice);
 }
 return out;
}
function sourceMap(original,display){
 const originals=new Map(scoreEvents(original).map(e=>[e.key,e]));
 return new Map(scoreEvents(display).map(e=>[e.element.startChar,originals.get(e.key)]));
}
function pitchToken(pitch){
 const names='CDEFGAB',octave=Math.floor(pitch/7),letter=names[((pitch%7)+7)%7];
 return octave<=0?letter+','.repeat(-octave):letter.toLowerCase()+"'".repeat(octave-1);
}
// Shift a note or chord diatonically; keep rhythm, ties, explicit accidentals and decorations.
function moveNoteText(text,steps){
 let result='',i=0;
 while(i<text.length){
  const c=text[i];let end;
  if(['"','!','+'].includes(c)){end=text.indexOf(c,i+1);if(end<0)end=text.length-1;result+=text.slice(i,end+1);i=end+1;continue}
  if(c==='{'){end=text.indexOf('}',i+1);if(end<0)end=text.length-1;result+=text.slice(i,end+1);i=end+1;continue}
  if(c==='['&&/^[A-Za-z]:/.test(text.slice(i+1))){end=text.indexOf(']',i+1);if(end<0)end=text.length-1;result+=text.slice(i,end+1);i=end+1;continue}
  const match=text.slice(i).match(/^(\^{1,2}|_{1,2}|=)?([A-Ga-g])([,']*)/);
  if(match){const pitch='CDEFGAB'.indexOf(match[2].toUpperCase())+(match[2]===match[2].toLowerCase()?7:0)+[...match[3]].reduce((n,c)=>n+(c==="'"?7:-7),0);result+=(match[1]||'')+pitchToken(pitch+steps);i+=match[0].length}
  else{result+=c;i++}
 }
 return result;
}
// Notes sounding between from and until (score seconds), rebased to 0 and scaled to the playback speed.
function playbackSlice(data,from,percent,until=data.duration){
 const speed=percent/100;
 return {duration:Math.max(0,(until-from)/speed),notes:data.notes.filter(n=>n.start+n.duration>from&&n.start<until-1e-9).map(n=>({...n,start:Math.max(0,n.start-from)/speed,duration:(Math.min(n.start+n.duration,until)-Math.max(from,n.start))/speed}))};
}
// ABC lengths are multiples of L:, written as a reduced fraction. 1 -> '', 2 -> '2', .5 -> '/2', 1.5 -> '3/2', 2/3 -> '2/3'.
function lengthText(value){
 let q=1;while(q<96&&Math.abs(value*q-Math.round(value*q))>1e-9)q++;
 const p=Math.round(value*q);return q===1?(p===1?'':String(p)):(p===1?'/'+q:p+'/'+q);
}
function lengthValue(text){
 const m=String(text).match(/^(\d*)(\/*)(\d*)$/);if(!m)return 1;
 const num=m[1]?+m[1]:1;return m[2]?num/(m[3]?+m[3]:2**m[2].length):num;
}
// Decorations/annotations, then a note, chord or rest, then its length, then ties or broken rhythm.
const NOTE_PARTS=/^((?:"[^"]*"|![^!]*!|\+[^+]*\+|\{[^}]*\}|[.~HLMOPSTuv]|\s)*)(\[[^\]]*\]|(?:\^{1,2}|_{1,2}|=)?[A-Ga-g][,']*|[zx])(\d*\/*\d*)([^]*)$/;
function noteParts(text){const m=String(text).match(NOTE_PARTS);return m&&{pre:m[1],core:m[2],length:lengthValue(m[3]),post:m[4]}}
// Set the accidental ('^', '_', '=', or '' for none) and/or length (multiple of L:) on every pitch of a note or chord.
// A new length replaces any per-pitch chord lengths; unbroken drops a trailing > or < broken-rhythm marker; tie adds or removes the tie (-).
function editNoteText(text,{accidental,length,unbroken,tie}={}){
 const m=String(text).match(NOTE_PARTS);if(!m)return text;
 let [,pre,core,len,post]=m;
 if(accidental!=null)core=core.replace(/(\^{1,2}|_{1,2}|=)?([A-Ga-g])/g,(_,a,letter)=>accidental+letter);
 if(length!=null){len=lengthText(length);if(core[0]==='[')core=core.replace(/([A-Ga-g][,']*)\d*\/*\d*/g,'$1')}
 if(unbroken)post=post.replace(/[<>]+/g,'');
 if(tie===true&&!/^-/.test(post))post='-'+post;
 if(tie===false)post=post.replace(/^-/,'');
 return pre+core+len+post;
}
// Bar-length check. Measures are numbered as in scoreEvents (a bar line ends a measure only once it holds notes).
const SECTION_END=/repeat|thin_thin|thin_thick|thick_thin|dbl/;
// A time signature as {length (whole notes), den, label}; 'free' for M:none, null when absent.
function meterInfo(meter){
 if(!meter||!meter.type)return null;
 if(meter.type==='common_time')return {length:1,den:4,label:'4/4'};
 if(meter.type==='cut_time')return {length:1,den:2,label:'2/2'};
 const v=meter.value?.[0];if(meter.type!=='specified'||!v)return 'free';
 const num=String(v.num).split('+').reduce((a,b)=>a+ +b,0);return {length:num/+v.den,den:+v.den,label:num+'/'+v.den};
}
function barLengths(tune){
 const out=[],states=new Map();let header=null;
 for(const line of tune.lines||[])for(const [s,staff] of (line.staff||[]).entries()){
  header??=meterInfo(staff.meter);
  for(const [v,voice] of staff.voices.entries()){
   const id=s+':'+v;let st=states.get(id);
   if(!st){st={measure:1,length:0,meter:meterInfo(staff.meter)??header??'free',notes:[],tuplet:1,multi:false,ending:null};states.set(id,st)}
   for(const e of voice){
    if(e.el_type==='meter'){const m=meterInfo(e);if(m)st.meter=m;continue}
    if(e.el_type==='note'){
     if(e.startTriplet)st.tuplet=e.tripletMultiplier||1;
     if(e.rest?.type==='multimeasure')st.multi=true;
     st.length+=(e.duration||0)*st.tuplet;st.notes.push({element:e,at:st.length});
     if(e.endTriplet)st.tuplet=1;continue;
    }
    if(e.el_type!=='bar')continue;
    if(st.notes.length){out.push({voice:id,measure:st.measure,length:st.length,meter:st.meter,expected:st.meter.length,multi:st.multi||st.meter==='free',notes:st.notes,bar:e,sectionEnd:SECTION_END.test(e.type)||!!e.startEnding,ending:st.ending});st.measure++}
    st.length=0;st.notes=[];st.multi=false;st.ending=e.startEnding||(e.endEnding?null:st.ending);
   }
  }
 }
 for(const [id,st] of states)if(st.notes.length)out.push({voice:id,measure:st.measure,length:st.length,meter:st.meter,expected:st.meter.length,multi:st.multi||st.meter==='free',notes:st.notes,bar:null,sectionEnd:true,ending:st.ending});
 return out;
}
// Measures whose length doesn't match the time signature. A short opening bar (pickup) is fine, and so is a short
// bar that closes a section when it completes a pickup: the section's, the next section's, or the tune's.
function barProblems(tune){
 const problems=[],byVoice=new Map(),near=(a,b)=>Math.abs(a-b)<1e-6;
 for(const m of barLengths(tune)){if(!byVoice.has(m.voice))byVoice.set(m.voice,[]);byVoice.get(m.voice).push(m)}
 for(const measures of byVoice.values()){
  const sections=[[]];
  for(const m of measures){sections.at(-1).push(m);if(m.sectionEnd)sections.push([])}
  if(!sections.at(-1).length)sections.pop();
  const tunePickup=measures[0]&&measures[0].length<measures[0].expected-1e-6?measures[0].length:0;
  for(const [i,section] of sections.entries()){
   const first=section[0],pickup=first.length<first.expected-1e-6?first.length:0,nextFirst=sections[i+1]?.[0];
   for(const [j,m] of section.entries()){
    if(m.multi||near(m.length,m.expected))continue;
    const short=m.length<m.expected;
    if(short&&j===0)continue;
    if(short&&j===section.length-1&&[pickup,tunePickup,nextFirst&&nextFirst.length<nextFirst.expected?nextFirst.length:0].some(p=>p&&near(m.length+p,m.expected)))continue;
    problems.push(m);
   }
  }
 }
 return problems;
}
// The first voice as written, bar by bar: each note's MIDI pitch (null for rests) and sounding length. Accidentals
// follow ABC rules: the key signature, inline key changes, and accidentals carried to the end of the bar.
const LETTER_SEMIS=[0,2,4,5,7,9,11],ALTER={sharp:1,flat:-1,natural:0,dblsharp:2,dblflat:-2};
function keyAlters(key){const alters={};for(const a of key?.accidentals||[])alters[a.note.toUpperCase()]=ALTER[a.acc]??0;return alters}
function melodyBars(tune){
 const bars=[],lengths=barLengths(tune).filter(m=>m.voice==='0:0');let key={},bar=null,carried={},tuplet=1;
 const close=()=>{if(bar?.notes.length){const m=lengths[bars.length];bars.push({...bar,expected:m?.expected??bar.length})}bar=null;carried={}};
 for(const line of tune.lines||[]){
  const staff=line.staff?.[0];if(!staff)continue;if(staff.key)key=keyAlters(staff.key);
  for(const e of staff.voices[0]||[]){
   if(e.el_type==='key'){key=keyAlters(e);continue}
   if(e.el_type==='bar'){close();continue}
   if(e.el_type!=='note')continue;
   bar??={notes:[],length:0,measure:bars.length+1};
   if(e.startTriplet)tuplet=e.tripletMultiplier||1;
   const duration=(e.duration||0)*tuplet;let midi=null;
   if(e.pitches?.length&&!e.rest){
    const p=e.pitches[0],letter=((p.pitch%7)+7)%7,name='CDEFGAB'[letter];
    if(p.accidental)carried[p.pitch]=ALTER[p.accidental]??0;
    midi=60+12*Math.floor(p.pitch/7)+LETTER_SEMIS[letter]+(carried[p.pitch]??key[name]??0);
   }
   bar.notes.push({midi,duration,rest:midi==null&&e.rest?.type!=='invisible'});bar.length+=duration;
   if(e.endTriplet)tuplet=1;
  }
 }
 close();return bars;
}
// Check a writing prompt's goals against the melody. Returns [{label, ok}].
const SCALES={major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,9,10,11]};
function promptTonic(key){const m=String(key).match(/^([A-G])([#b]?)/);return m?(LETTER_SEMIS['CDEFGAB'.indexOf(m[1])]+(m[2]==='#'?1:m[2]==='b'?-1:0)+12)%12:0}
function checkPrompt(prompt,bars){
 const near=(a,b)=>Math.abs(a-b)<1e-6,tonic=promptTonic(prompt.key),degree=n=>((n.midi-tonic)%12+12)%12,promptBar=prompt.meter.split('/').reduce((n,d)=>n/d);
 const notes=bars.flatMap(b=>b.notes),pitched=notes.filter(n=>n.midi!=null),moves=pitched.slice(1).map((n,i)=>Math.abs(n.midi-pitched[i].midi));
 const kinds={rest:n=>n.rest,eighth:n=>n.midi!=null&&near(n.duration,.125),'dotted-half':n=>n.midi!=null&&near(n.duration,.75),'dotted-quarter':n=>n.midi!=null&&near(n.duration,.375)};
 return prompt.goals.map(g=>{
  let ok=false;
  // Bars must match the prompt's own meter, so changing the time signature can't satisfy the goal.
  if(g.type==='bars')ok=bars.length===prompt.bars&&bars.every(b=>near(b.length,promptBar)&&near(b.expected,promptBar)&&b.notes.some(n=>n.midi!=null));
  else if(g.type==='lengths')ok=pitched.length>0&&pitched.every(n=>g.allowed.some(a=>near(a,n.duration)));
  else if(g.type==='start')ok=!!pitched.length&&degree(pitched[0])===g.degree;
  else if(g.type==='end')ok=!!pitched.length&&degree(pitched.at(-1))===g.degree;
  else if(g.type==='endBar'){const b=bars[g.bar-1]?.notes.filter(n=>n.midi!=null);ok=!!b?.length&&degree(b.at(-1))===g.degree}
  else if(g.type==='steps')ok=pitched.length>1&&moves.every(m=>m<=2);
  else if(g.type==='range')ok=pitched.length>1&&Math.max(...pitched.map(n=>n.midi))-Math.min(...pitched.map(n=>n.midi))<=g.max;
  else if(g.type==='inKey')ok=pitched.length>0&&pitched.every(n=>SCALES[g.scale].includes(degree(n)));
  else if(g.type==='atLeast'){
   const count=g.kind==='leap'?moves.filter(m=>m>=5).length:g.kind==='degree'?pitched.filter(n=>degree(n)===g.degree).length:notes.filter(kinds[g.kind]).length;
   ok=count>=g.count;
  }
  return {label:g.label,ok};
 });
}
// ABC for a writing prompt: the prompt's headers and key (pass the concert key for transposing instruments) and a
// body, by default one whole-bar rest per bar for the student to write over.
function promptSource(prompt,key=prompt.key,body=null){
 const [n,d]=prompt.meter.split('/').map(Number),[un,ud]=prompt.unit.split('/').map(Number),rest='z'+lengthText((n/d)/(un/ud));
 return `X:1\nT:${prompt.title}\nC:\nM:${prompt.meter}\nL:${prompt.unit}\nQ:1/4=${prompt.tempo}\nK:${key}\n${body??Array(prompt.bars).fill(rest).join(' | ')} |]`;
}
// Note-name labels for every voice, as written: letters (F♯) or movable-do solfège (do-based major,
// la-based minor; notes raised against the key signature use sharp syllables, lowered ones flat syllables).
// Each voice keeps its own key and bar accidentals.
const SOLFEGE_SHARP=['do','di','re','ri','mi','fa','fi','sol','si','la','li','ti'],SOLFEGE_FLAT=['do','ra','re','me','mi','fa','se','sol','le','la','te','ti'];
function noteLabels(tune,mode){
 const labels=[],voices=new Map();
 const keyState=k=>{const state={key:keyAlters(k),doPc:0};if(k?.root&&k.root!=='none'){const root=(LETTER_SEMIS['CDEFGAB'.indexOf(k.root)]+(k.acc==='#'?1:k.acc==='b'?-1:0)+12)%12;state.doPc=/^m(in)?$/i.test(k.mode||'')?(root+3)%12:root}return state};
 for(const line of tune.lines||[])for(const [s,staff] of (line.staff||[]).entries())for(const [v,voice] of (staff.voices||[]).entries()){
  const id=s+':'+v,state=voices.get(id)||{carried:{}};voices.set(id,state);
  if(staff.key)Object.assign(state,keyState(staff.key));
  for(const e of voice){
   if(e.el_type==='key'){Object.assign(state,keyState(e));continue}
   if(e.el_type==='bar'){state.carried={};continue}
   if(e.el_type!=='note'||!e.pitches?.length||e.rest)continue;
   const p=e.pitches[0],letter=((p.pitch%7)+7)%7,name='CDEFGAB'[letter],key=state.key||{};
   if(p.accidental)state.carried[p.pitch]=ALTER[p.accidental]??0;
   const alter=state.carried[p.pitch]??key[name]??0,pc=(LETTER_SEMIS[letter]+alter+12)%12;
   // Lowered against the key signature (a flat, or a natural on a sharp) takes the flat syllable.
   const text=mode==='solfege'?(alter<(key[name]??0)?SOLFEGE_FLAT:SOLFEGE_SHARP)[(pc-(state.doPc||0)+12)%12]:name+({1:'♯',2:'𝄪','-1':'♭','-2':'𝄫'}[alter]||'');
   labels.push({at:e.startChar,text,midi:60+12*Math.floor(p.pitch/7)+LETTER_SEMIS[letter]+alter});
  }
 }
 return labels;
}
// Add the labels to an ABC source as annotations below each note.
function labelSource(source,mode){
 if(!mode||mode==='off')return source;
 let out=source;
 for(const {at,text} of noteLabels(ABCJS.parseOnly(source)[0],mode).sort((a,b)=>b.at-a.at))out=out.slice(0,at)+`"_${text}"`+out.slice(at);
 return out;
}
// Baroque soprano recorder fingerings by written MIDI pitch: [thumb, 1, 2, 3, 4, 5, 6, 7], 1 = covered.
// Limited to the beginner range (C to D', with F♯ and B♭) where school charts agree.
const RECORDER_FINGERING={60:[1,1,1,1,1,1,1,1],62:[1,1,1,1,1,1,1,0],64:[1,1,1,1,1,1,0,0],65:[1,1,1,1,1,0,1,1],66:[1,1,1,1,0,1,1,0],67:[1,1,1,1,0,0,0,0],69:[1,1,1,0,0,0,0,0],70:[1,1,0,1,1,0,0,0],71:[1,1,0,0,0,0,0,0],72:[1,0,1,0,0,0,0,0],74:[0,0,1,0,0,0,0,0]};

// Skill tags, worked out from the music itself so every score can be found by what it teaches.
// Written in the words students use. Keep the list in this order: it's the order of the Skill filter.
const SKILLS=['Steps','Skips','Leaps','Repeated notes','Eighth notes','Sixteenth notes','Dotted rhythms','Triplets','Triple meter','Compound meter','Minor key','Accidentals','Chords','Rests','Wide range','Repeats'];
// MIDI number of a parsed pitch: the key signature applies unless the bar already carried an accidental for that note.
function pitchMidi(p,alters,carried){
 const letter='CDEFGAB'[((p.pitch%7)+7)%7],explicit=p.accidental&&p.accidental!=='none';
 if(explicit)carried.set(p.pitch,ALTER[p.accidental]??0);
 return 60+Math.floor(p.pitch/7)*12+LETTER_SEMIS['CDEFGAB'.indexOf(letter)]+(carried.has(p.pitch)?carried.get(p.pitch):alters[letter]||0);
}
function skillTags(tune){
 const tags=new Set();let steps=0,skips=0,leaps=0,same=0,intervals=0,notes=0,rests=0,accidentals=0,lo=Infinity,hi=-Infinity;
 for(const line of tune.lines)for(const staff of line.staff||[]){
  const meter=staff.meter?.value?.[0],num=+meter?.num,den=+meter?.den;
  if(num===3)tags.add('Triple meter');if(den===8&&num>3&&num%3===0)tags.add('Compound meter');
  if(/^(m|min|minor|aeo|aeolian|dor|dorian|phr|phrygian)/i.test(staff.key?.mode||''))tags.add('Minor key');
  const alters=keyAlters(staff.key);
  for(const voice of staff.voices||[]){
   let last=null,carried=new Map();
   for(const e of voice){
    if(e.el_type==='bar'){if(/repeat/.test(e.type))tags.add('Repeats');carried=new Map();continue}
    if(e.el_type!=='note')continue;
    if(e.startTriplet)tags.add('Triplets');
    const d=e.duration;
    if(d>0){if(d<1/8+1e-9&&d>1/16+1e-9)tags.add('Eighth notes');if(d<=1/16+1e-9)tags.add('Sixteenth notes');
     for(const base of [1/4,1/8,1/16,1/2])if(Math.abs(d-base*1.5)<1e-9)tags.add('Dotted rhythms')}
    if(!e.pitches?.length){rests++;last=null;continue}
    notes++;if(e.pitches.length>1)tags.add('Chords');
    let pitch=null;
    for(const p of e.pitches){if(p.accidental&&p.accidental!=='none')accidentals++;const midi=pitchMidi(p,alters,carried);pitch??=midi;lo=Math.min(lo,midi);hi=Math.max(hi,midi)}
    // Intervals in semitones: steps are seconds, skips thirds, leaps a fourth or more.
    if(last!=null){const gap=Math.abs(pitch-last);intervals++;if(gap===0)same++;else if(gap<=2)steps++;else if(gap<=4)skips++;else leaps++}
    last=pitch;
   }
  }
 }
 if(intervals>=6){
  if(steps/intervals>=.6)tags.add('Steps');if(skips/intervals>=.25)tags.add('Skips');if(leaps/intervals>=.2)tags.add('Leaps');if(same/intervals>=.3)tags.add('Repeated notes');
 }
 if(accidentals>=2)tags.add('Accidentals');if(rests>=3&&rests/(notes+rests)>=.08)tags.add('Rests');if(hi-lo>=17)tags.add('Wide range');
 return SKILLS.filter(s=>tags.has(s));
}
// catalog-skills.js stores each score's tags as a bit mask over SKILLS, to keep the file small.
const skillMask=tags=>tags.reduce((m,t)=>m|1<<SKILLS.indexOf(t),0),skillsFromMask=mask=>SKILLS.filter((s,i)=>mask>>i&1);
