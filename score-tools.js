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
function playbackSlice(data,from,percent){
 const speed=percent/100;
 return {duration:Math.max(0,(data.duration-from)/speed),notes:data.notes.filter(n=>n.start+n.duration>from).map(n=>({...n,start:Math.max(0,n.start-from)/speed,duration:(n.start+n.duration-Math.max(from,n.start))/speed}))};
}
