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
