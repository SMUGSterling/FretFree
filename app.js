'use strict';
const $=id=>document.getElementById(id), esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let renderedSource=null,renderedTune=null,noteSources=new Map(),measureStarts=new Map(),selectedRange=null,playOrigin=0,playClock=0,playSpeed=1;
let staffClefs=[];let libraryPage=0;const PAGE_SIZE=24;
let current=null,savedId=null,dirty=false,renderTimer,storageOK=true,audio=null,playing=false,playTimer=null,nodes=[],playGeneration=0;
const storage={get(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}},set(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true}catch{storageOK=false;return false}}};
let saved=storage.get('commonnote-scores-v1',[]),favorites=storage.get('commonnote-favorites-v1',[]);
if(!Array.isArray(saved))saved=[];if(!Array.isArray(favorites))favorites=[];
function toast(msg){$('toast').textContent=msg;$('toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').style.display='none',3500)}
function show(view){document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==view);document.querySelectorAll('.nav').forEach(el=>el.classList.toggle('active',el.dataset.view===view));if(view==='saved')renderSaved();if(view!=='studio')stop();history.replaceState(null,'','#'+view);window.scrollTo({top:0,behavior:'smooth'})}
function allowReplace(){return !dirty||confirm('Replace your unsaved changes? Save or export first if you want to keep them.');}
function openScore(item,id=null){if(!allowReplace())return;stop();current=item;savedId=id;dirty=false;selectedRange=null;$('selection-status').textContent='Click a note to select its ABC text and starting measure. Drag up/down to change pitch; chords move together.';$('start-measure').value=1;$('abc').value=item.abc;$('instrument').value=item.instrument||($('instrument-filter').value==='all'?'Flute':$('instrument-filter').value);syncFields();render();$('save-status').textContent='';show('studio')}
function newScore(){openScore({title:'Untitled melody',composer:'',kind:'personal',abc:tune('Untitled melody','','4/4','C',100,'C D E F | G2 G2 | F E D C | C4 |]')})}
function filteredCatalog(){const q=$('search').value.toLowerCase(),level=$('level-filter').value,kind=$('kind-filter').value,genre=$('genre-filter').value,collection=$('collection-filter').value,license=$('license-filter').value;const list=catalog.filter(x=>(collection==='all'||scoreCollection(x)===collection)&&(license==='all'||scoreLicense(x)===license)&&(level==='all'||x.level===level)&&(kind==='all'||x.kind===kind)&&(genre==='all'||(x.genre||'Teaching melodies')===genre)&&`${x.title} ${x.composer} ${x.skill} ${x.originalInstrument||''} ${x.aliases||''} ${x.attribution||''} ${scoreCollection(x)}`.toLowerCase().includes(q));const order=$('sort-filter').value;if(order==='title')list.sort((a,b)=>a.title.localeCompare(b.title));if(order==='composer')list.sort((a,b)=>a.composer.localeCompare(b.composer)||a.title.localeCompare(b.title));return list}
function renderCards(){const list=filteredCatalog();const pages=Math.max(1,Math.ceil(list.length/PAGE_SIZE));libraryPage=Math.min(libraryPage,pages-1);const visible=list.slice(libraryPage*PAGE_SIZE,(libraryPage+1)*PAGE_SIZE);$('result-count').textContent=`${list.length} scores · curated collection`;$('empty').hidden=list.length>0;$('pagination').hidden=list.length<=PAGE_SIZE;$('prev-page').disabled=libraryPage===0;$('next-page').disabled=libraryPage>=pages-1;$('page-status').textContent=`Page ${libraryPage+1} of ${pages} · ${list.length} scores`;$('cards').innerHTML=visible.map(x=>`<article class="card"><div class="mini-score" id="mini-${x.id}" aria-hidden="true"></div><div class="card-body"><div class="card-top"><span class="tag">${esc(licenseLabel(x))}</span><button class="favorite" data-favorite="${x.id}" aria-label="${favorites.includes(x.id)?'Unfavorite':'Favorite'} ${esc(x.title)}" aria-pressed="${favorites.includes(x.id)}">${favorites.includes(x.id)?'★':'☆'}</button></div><h3>${esc(x.title)}</h3><span class="small">${esc(x.composer)}</span><p>${esc(x.description)}</p>${x.pdf?`<a class="pdf-link" href="${esc(x.pdf)}" target="_blank" rel="noopener">Complete PDF · ${esc(x.originalInstrument)} ↗</a>`:''}<div class="card-bottom"><span>${x.level} · ${esc(x.skill)}</span><button data-open="${x.id}">${x.pdf?'Practice part':'Open score'} ↗</button></div></div></article>`).join('');for(const x of visible){const lines=x.abc.split('\n'),k=lines.findIndex(l=>l.startsWith('K:'));ABCJS.renderAbc(`mini-${x.id}`,lines.slice(0,k+1).filter(l=>!/^T:|^C:/.test(l)).join('\n')+'\n'+lines[k+1],{staffwidth:380,scale:.7,responsive:'resize',paddingtop:15});}}

function renderSaved(){const fav=catalog.filter(x=>favorites.includes(x.id));$('saved-cards').innerHTML=(saved.length||fav.length)?saved.map(x=>`<article class="card"><div class="card-body"><span class="tag">SAVED ON THIS DEVICE</span><h3>${esc(x.title)}</h3><p>${esc(x.composer||'Your composition')}<br>${new Date(x.updated).toLocaleDateString()}</p><div class="card-bottom"><button data-saved="${esc(x.id)}">Open score ↗</button><button data-delete="${esc(x.id)}">Delete</button></div></div></article>`).join('')+fav.map(x=>`<article class="card"><div class="card-body"><span class="tag">FAVORITE</span><h3>${esc(x.title)}</h3><p>${esc(x.composer)}</p><div class="card-bottom"><button data-open="${x.id}">Open score ↗</button><button data-favorite="${x.id}">Remove favorite</button></div></div></article>`).join(''):'<div class="empty">Your collection starts here.<br>Save a composition or tap a star in the library.</div>'}
function field(name,defaultValue=''){const match=$('abc').value.match(new RegExp('^'+name+':(.*)$','m'));return match?match[1].trim():defaultValue}
function assignSelect(id,value){const select=$(id);if(![...select.options].some(o=>o.value===value))select.add(new Option(value,value));select.value=value}
function syncFields(){$('title').value=field('T','Untitled');$('composer').value=field('C');assignSelect('meter',field('M','4/4'));assignSelect('key',field('K','C').split(/\s/)[0]);const m=field('Q','100').match(/(\d+)\s*$/);$('bpm').value=m?Math.max(40,Math.min(200,+m[1])):100;$('bpm-value').textContent=$('bpm').value}
function setHeader(name,value){const lines=$('abc').value.split('\n'),i=lines.findIndex(x=>x.startsWith(name+':'));const text=name+':'+String(value).replace(/[\r\n]/g,' ');if(i>=0)lines[i]=text;else lines.splice(Math.max(0,lines.findIndex(x=>x.startsWith('K:'))),0,text);$('abc').value=lines.join('\n')}
function writtenABC(){let source=$('abc').value;const config=instruments[$('instrument').value];if(config.shift)source=ABCJS.strTranspose(source,ABCJS.parseOnly(source),config.shift);source=source.replace(/^K:(.*)$/m,(_,key)=>'K:'+key.replace(/\s+clef=\S+/g,'')+' clef='+config.clef);return source}
function scoreClick(element,tuneNumber,classes,analysis,drag){
 if(renderedSource!==$('abc').value){clearTimeout(renderTimer);render();toast('Score updated. Select the note again.');return}
 const entry=noteSources.get(element.startChar);if(!entry)return;
 const area=$('abc'),start=entry.element.startChar,end=entry.element.endChar;
 if(start==null||end==null)return;
 let nextEnd=end;
 // Bundled abcjs 6.5.2 reports SVG Y steps: negative is upward.
 if(drag?.step&&entry.element.pitches?.length){
  const old=area.value.slice(start,end),replacement=moveNoteText(old,-drag.step);
  area.setRangeText(replacement,start,end,'select');nextEnd=start+replacement.length;
  dirty=true;$('save-status').textContent='Unsaved changes';clearTimeout(renderTimer);
  selectedRange=[start,nextEnd];render();
 }
 selectedRange=[start,nextEnd];area.focus({preventScroll:true});area.setSelectionRange(start,nextEnd);
 $('start-measure').value=entry.measure;
 $('selection-status').textContent=`Measure ${entry.measure} selected · drag up/down to change pitch`;
}
function updateMeasures(){
 measureStarts=new Map();
 if(renderedTune?.engraver){
  renderedTune.setTiming();
  for(const event of renderedTune.noteTimings||[]){
   if(event.type!=='event')continue;
   const entries=(event.startCharArray||[]).map(c=>noteSources.get(c)).filter(Boolean);
   for(const entry of entries)if(!measureStarts.has(entry.measure))measureStarts.set(entry.measure,event.milliseconds/1000);
  }
 }
 const total=Math.max(1,...[...noteSources.values()].filter(Boolean).filter(e=>e.element.el_type==='note').map(e=>e.measure));
 $('start-measure').max=total;$('start-measure').value=Math.max(1,Math.min(total,+$('start-measure').value||1));
 $('measure-count').textContent=`of ${total}`;
}
function render(){stop();try{const source=writtenABC();renderedSource=$('abc').value;const original=ABCJS.parseOnly(renderedSource)[0];const display=ABCJS.parseOnly(source)[0];noteSources=sourceMap(original,display);const tunes=ABCJS.renderAbc('notation',source,{responsive:'resize',staffwidth:740,add_classes:true,dragging:true,selectTypes:['note','bar'],selectionColor:'#317761',dragColor:'#ba663d',clickListener:scoreClick});renderedTune=tunes[0];noteDurations=new Map(scoreEvents(display).map(e=>[e.element.startChar,(e.element.duration||0)*(e.element.tripletMultiplier||1)]));staffClefs=display.lines.filter(l=>l.staff).map(l=>l.staff.map(st=>st.clef?.verticalPos||0));updateMeasures();if(selectedRange&&renderedTune?.engraver){const match=[...noteSources.entries()].find(([,e])=>e?.element.startChar===selectedRange[0]);if(match){const shown=scoreEvents(display).find(e=>e.element.startChar===match[0]);if(shown)renderedTune.engraver.rangeHighlight(shown.element.startChar,shown.element.endChar)}}$('warnings').textContent=(tunes[0]?.warnings||[]).map(x=>String(x).replace(/<[^>]+>/g,'')).join(' · ');$('workspace-heading').textContent=field('T','Untitled melody');const config=instruments[$('instrument').value];$('score-caption').textContent=`${$('instrument').value} · ${config.clef} clef · ${config.shift===2||config.shift===9?'Written pitch shown; ABC source and MIDI are concert pitch.':config.shift===-12?'Melody lowered one octave for bass range.':'Concert pitch melody part.'}`;const edition=$('source-edition');edition.hidden=!(current?.pdf||current?.originalSource);if(current?.pdf){edition.innerHTML=`<strong>Complete source edition</strong><p>The editor shows an extracted upper-part study, up to 32 bars. The original PDF below includes the complete score for ${esc(current.originalInstrument)}.</p><div class="source-actions"><a class="button-link" href="${esc(current.pdf)}" target="_blank" rel="noopener">Open complete PDF ↗</a><a class="button-link" href="${esc(current.pdf)}" download>Download PDF</a><a class="button-link" href="${esc(current.originalMidi)}" download>Original MIDI</a>${current.originalSource?`<a class="button-link" href="${esc(current.originalSource)}" download>Original editable source</a>`:''}</div>`}else if(current?.originalSource){edition.innerHTML=`<strong>Complete original ABC source</strong><p>${esc(current.studyTransform)} License: ${esc(scoreLicense(current))}. See the credit notice below before sharing.</p><a class="button-link" href="${esc(current.originalSourceDownload||current.originalSource)}" download>${current.originalSourceDownload?'Download original ABC + license bundle':'Download complete original ABC'}</a>`}const r=current?.rights;if(r){$('rights').innerHTML=`<strong>${esc(licenseLabel(current))} · ${esc(scoreCollection(current))}</strong>${esc(r)}<br>${current.attribution?`Credit: ${esc(current.attribution)}<br>`:''}${current.licenseURL?`<a href="${esc(current.licenseURL)}" target="_blank" rel="noopener">License terms ↗</a><br>`:''}<a href="${esc(current.source)}" target="_blank" rel="noopener">${esc(current.sourceLabel)} ↗</a><br><span class="small">${dirty?'Your edits stay private. Export or save a copy to preserve them.':'Use, print, practice, and adapt this teaching version.'}</span>`}else{$('rights').innerHTML='<strong>Your private workspace</strong>Your work stays on this device. Imported music keeps its original rights; importing or editing a file does not make it public domain.'}}catch(e){$('warnings').textContent='Could not render this score: '+e.message}}
function changed(){stop();selectedRange=null;dirty=true;$('save-status').textContent='Unsaved changes';clearTimeout(renderTimer);renderTimer=setTimeout(render,220)}
function noteLength(){const match=field('L','1/8').match(/^(\d+)\/(\d+)$/);const base=match?+match[1]/+match[2]:.125;const beats=({'1':1,'/2':.5,'2':2,'4':4})[$('duration').value];const length=beats/4/base;return length===1?'':Number.isInteger(length)?String(length):'/'+String(Math.round(1/length))}
function insertToken(token){const area=$('abc'),start=area.selectionStart,end=area.selectionEnd;const keyLine=area.value.match(/^K:.*(?:\n|$)/m);if(!keyLine){toast('Add a K: key header before writing notes.');return}const musicStart=keyLine.index+keyLine[0].length;if(start<musicStart){toast('Place the cursor after the K: line to add notes.');area.focus();area.setSelectionRange(area.value.length,area.value.length);return}const prefix=['^','_','='].includes(token);let text=token;if(/^[A-G]$/.test(token)){if($('octave').value==='upper')text=token.toLowerCase();if($('octave').value==='lower')text=token+',';text+=noteLength()}if(token==='z')text+=noteLength();if(!prefix)text+=' ';area.setRangeText(text,start,end,'end');area.focus();changed()}
function safeName(){return field('T','score').replace(/[^a-z0-9_-]+/gi,'-').slice(0,80)||'score'}
function download(data,name,type){const blob=new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function midiBytes(source){const result=ABCJS.synth.getMidiFile(source,{midiOutputType:'encoded'});const uri=Array.isArray(result)?result[0]:result;if(typeof uri!=='string'||!uri.startsWith('data:'))throw new Error('MIDI could not be generated. Check your notation.');const [meta,body]=uri.split(',');return meta.includes(';base64')?Uint8Array.from(atob(body),c=>c.charCodeAt(0)):Uint8Array.from(body.match(/%[0-9a-f]{2}|[^%]/gi)||[],t=>t[0]==='%'?parseInt(t.slice(1),16):t.charCodeAt(0))}
// Decode MIDI note and tempo events generated by abcjs, including polyphonic voices.
function parseMidi(bytes){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),division=v.getUint16(12);if(division&0x8000)throw new Error('SMPTE MIDI timing is not supported');let pos=14,events=[];const vlq=()=>{let n=0,b;do{b=bytes[pos++];n=(n<<7)|(b&127)}while(b&128);return n};while(pos+8<=bytes.length){const tag=String.fromCharCode(...bytes.slice(pos,pos+4)),len=v.getUint32(pos+4);pos+=8;const end=pos+len;if(tag!=='MTrk'){pos=end;continue}let tick=0,running=0;while(pos<end){tick+=vlq();let status=bytes[pos++];if(status<128){pos--;status=running}else if(status<240)running=status;if(status===255){const kind=bytes[pos++],size=vlq();if(kind===81&&size===3)events.push({tick,tempo:(bytes[pos]<<16)|(bytes[pos+1]<<8)|bytes[pos+2]});pos+=size;continue}if(status===240||status===247){const size=vlq();pos+=size;continue}const cmd=status&240,ch=status&15,a=bytes[pos++],b=(cmd===192||cmd===208)?0:bytes[pos++];if(cmd===144||cmd===128)events.push({tick,ch,note:a,velocity:b,on:cmd===144&&b>0});}pos=end}events.sort((a,b)=>a.tick-b.tick);let tick=0,time=0,tempo=500000,active=new Map(),notes=[];for(const e of events){time+=(e.tick-tick)*tempo/1000000/division;tick=e.tick;if(e.tempo){tempo=e.tempo;continue}const key=e.ch+':'+e.note;if(e.on){active.set(key,{note:e.note,start:time,velocity:e.velocity})}else if(active.has(key)){const n=active.get(key);notes.push({...n,duration:Math.max(.025,time-n.start)});active.delete(key)}}for(const n of active.values())notes.push({...n,duration:Math.max(.1,time-n.start)});return {notes,duration:Math.max(time,...notes.map(n=>n.start+n.duration),0)}}
function stop(){playing=false;playGeneration++;clearTimeout(playTimer);stopFollow();for(const node of nodes){try{node.stop()}catch{}}nodes=[];$('play').textContent='▶ Play';$('play-status').textContent='Ready to play'}
async function play(resumeFrom=null){if(playing){stop();return}clearTimeout(renderTimer);render();const generation=++playGeneration;try{audio ||= new (window.AudioContext||window.webkitAudioContext)();await audio.resume();if(generation!==playGeneration)return;const full=parseMidi(midiBytes($('abc').value));const measure=+$('start-measure').value||1;const from=resumeFrom??measureStarts.get(measure);if(from==null){toast('This measure has no playback event. Check the ABC notation.');return}const percent=+$('speed').value;const data=playbackSlice(full,from,percent);if(!data.notes.length){toast('Add some notes before playback.');return}playing=true;playOrigin=from;playClock=audio.currentTime+.07;playSpeed=percent/100;$('play').textContent='■ Playing';$('play-status').textContent=`From measure ${measure} · ${percent}% speed`;const base=playClock,config=instruments[$('instrument').value];for(const n of data.notes){const osc=audio.createOscillator(),gain=audio.createGain();osc.type=config.wave;osc.frequency.value=440*2**((n.note+(config.shift===-12?-12:0)-69)/12);const start=base+n.start,end=start+n.duration,attack=Math.min(.012,n.duration/3);gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(+$('volume').value*.12*n.velocity/100,start+attack);gain.gain.setValueAtTime(+$('volume').value*.08*n.velocity/100,Math.max(start+attack,end-.04));gain.gain.linearRampToValueAtTime(0,end+.025);osc.connect(gain);gain.connect(audio.destination);osc.start(start);osc.stop(end+.03);nodes.push(osc)}startFollow(generation);playTimer=setTimeout(()=>{const loop=$('loop').checked;stop();if(loop)play()},(data.duration+.12)*1000)}catch(e){stop();toast('Playback unavailable: '+e.message)}}
// Light up sounding notes. Score time comes from the audio clock, so speed changes and resumes stay in sync.
// abcjs timing events group notes by onset, so each note keeps its own end time; a held note stays lit while others move.
let followFrame=0,noteDurations=new Map();
const nextFrame=f=>window.requestAnimationFrame?requestAnimationFrame(f):setTimeout(f,16),cancelFrame=id=>window.cancelAnimationFrame?cancelAnimationFrame(id):clearTimeout(id);
function stopFollow(){if(followFrame)cancelFrame(followFrame);followFrame=0;document.querySelectorAll('#notation .abcjs-playing').forEach(el=>el.classList.remove('abcjs-playing'))}
function startFollow(generation){
 stopFollow();if(!renderedTune?.noteTimings)return;
 const bar=renderedTune.getBarLength?.()||1,events=renderedTune.noteTimings.filter(e=>e.type==='event'&&e.elements?.length),notes=[];
 for(const [i,e] of events.entries())for(const [j,group] of e.elements.entries()){
  const start=e.milliseconds/1000,whole=noteDurations.get(e.startCharArray?.[j]);
  const end=whole?start+whole*e.millisecondsPerMeasure/bar/1000:(events[i+1]?.milliseconds??Infinity)/1000;
  notes.push({start,end,els:[group].flat(2).filter(el=>el?.classList)});
 }
 notes.sort((a,b)=>a.start-b.start);let next=0,active=[];
 const tick=()=>{
  if(generation!==playGeneration)return;
  const now=playOrigin+Math.max(0,audio.currentTime-playClock)*playSpeed+.005;
  active=active.filter(n=>{if(n.end>now)return true;for(const el of n.els)el.classList.remove('abcjs-playing');return false});
  while(next<notes.length&&notes[next].start<=now){
   const n=notes[next++];if(n.end<=now)continue;
   for(const el of n.els)el.classList.add('abcjs-playing');active.push(n);
   const box=n.els[0]?.getBoundingClientRect();
   if(box&&(box.top<0||box.bottom>window.innerHeight))n.els[0].scrollIntoView({block:'center',behavior:'smooth'});
  }
  followFrame=nextFrame(tick);
 };
 tick();
}
// abcjs moves one staff step per ~4px of raw offsetY and switches coordinate sources mid-drag, so notes race ahead and jitter.
// Take over the move: measure screen distance from the press point and require DRAG_PX_PER_STEP per staff step.
const DRAG_PX_PER_STEP=10,STAFF_STEP=93/24;let dragStartY=null;
$('notation').addEventListener('mousedown',e=>{dragStartY=e.clientY},true);
$('notation').addEventListener('touchstart',e=>{dragStartY=e.touches[0]?.clientY??null},{capture:true,passive:true});
function dragMove(e){
 const c=renderedTune?.engraver,point=e.touches?e.touches[0]:e;
 if(dragStartY==null||!point||!c?.dragTarget?.isDraggable||c.dragMechanism!=='mouse')return;
 e.stopPropagation();if(e.type==='touchmove'&&e.cancelable)e.preventDefault();
 const step=Math.round((point.clientY-dragStartY)/DRAG_PX_PER_STEP);
 if(step!==c.dragYStep){c.dragYStep=step;c.dragTarget.svgEl.setAttribute('transform','translate(0,'+step*STAFF_STEP+')')}
}
// Track on window so the drag keeps working when the pointer leaves the score; abcjs only hears events inside its SVG.
window.addEventListener('mousemove',dragMove,true);$('notation').addEventListener('touchmove',dragMove,{capture:true,passive:false});
window.addEventListener('mouseup',e=>{
 const c=renderedTune?.engraver,svg=$('notation').querySelector('svg');dragStartY=null;
 if(c?.dragTarget&&c.dragMechanism==='mouse'&&svg&&!svg.contains(e.target))svg.dispatchEvent(new MouseEvent('mouseup',{clientX:e.clientX,clientY:e.clientY,button:e.button}));
},true);
// Draw mode: click an empty staff position to add a one-beat note. Right-click (or long-press) any note for its properties.
let drawMode=false,ghost=null,menuEntry=null;
const meterParts=()=>{const m=field('M','4/4').trim();if(m==='C')return [4,4];if(m==='C|')return [2,2];const x=m.match(/(\d+)\s*\/\s*(\d+)/);return x?[+x[1],+x[2]]:[4,4]};
// Without L:, ABC's unit is 1/16 for meters under 3/4 and 1/8 otherwise.
const unitLength=()=>{const m=field('L','').match(/^(\d+)\/(\d+)$/);if(m)return +m[1]/+m[2];const [n,d]=meterParts();return n/d<.75?1/16:1/8};
const beatLength=()=>1/meterParts()[1];
const pitchName=p=>'CDEFGAB'[((p%7)+7)%7]+(4+Math.floor(p/7));
const lengthName=v=>({1:'whole',.5:'half',.25:'quarter',.125:'eighth',.0625:'16th',.03125:'32nd'})[v]||'';
function scorePoint(e){const svg=$('notation').querySelector('svg');return svg&&new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse())}
function staffList(){return (renderedTune?.engraver?.staffgroups||[]).flatMap((g,gi)=>g.staffs.map((st,si)=>({id:gi+':'+si,y:st.absoluteY,clef:staffClefs[gi]?.[si]??0})))}
const nearestStaff=(staffs,y)=>staffs.reduce((best,st)=>Math.abs(y-(st.y-6*STAFF_STEP))<Math.abs(y-(best.y-6*STAFF_STEP))?st:best,staffs[0]);
// Staff lines sit at verticalPos 2-10; abcjs draws verticalPos v at absoluteY - v*STEP and v = written pitch - clef offset.
function drawTarget(e){
 const pt=scorePoint(e),staffs=staffList();if(!pt||!staffs.length)return null;
 const staff=nearestStaff(staffs,pt.y);if(Math.abs(pt.y-(staff.y-6*STAFF_STEP))>11*STAFF_STEP)return null;
 const v=Math.max(-4,Math.min(16,Math.round((staff.y-pt.y)/STAFF_STEP)));
 return {x:pt.x,y:staff.y-v*STAFF_STEP,written:v+staff.clef,staff};
}
// Hit-test by bounding box too: the hollow centre of a half or whole note is bare SVG.
function selectableAt(e){
 const c=renderedTune?.engraver;if(!c)return null;const direct=c.selectables.find(s=>s.svgEl.contains(e.target));if(direct)return direct;
 const pt=scorePoint(e);if(!pt)return null;let best=null,dist=Infinity;
 for(const s of c.selectables){const b=s.svgEl.getBBox();if(pt.x<b.x-2||pt.x>b.x+b.width+2||pt.y<b.y-2||pt.y>b.y+b.height+2)continue;const d=Math.abs(pt.x-(b.x+b.width/2));if(d<dist){dist=d;best=s}}
 return best;
}
const onNote=e=>!!selectableAt(e);
function showGhost(t){
 const svg=$('notation').querySelector('svg');if(!svg)return;
 if(!ghost||ghost.ownerSVGElement!==svg){ghost=document.createElementNS('http://www.w3.org/2000/svg','ellipse');ghost.setAttribute('class','draw-ghost');ghost.setAttribute('rx','5');ghost.setAttribute('ry','3.8');svg.appendChild(ghost)}
 ghost.style.display=t?'':'none';if(!t)return;
 ghost.setAttribute('cx',t.x);ghost.setAttribute('cy',t.y);ghost.setAttribute('transform',`rotate(-20 ${t.x} ${t.y})`);
 $('selection-status').textContent=`Draw: click to add ${pitchName(t.written)} (${lengthName(beatLength())||'one-beat'} note) · right-click a note to change it`;
}
function applyNoteEdit(start,end,text,select=text?[start,start+text.length]:null){
 const area=$('abc');area.setRangeText(text,start,end,'end');
 dirty=true;$('save-status').textContent='Unsaved changes';clearTimeout(renderTimer);syncFields();
 selectedRange=select;render();
 if(selectedRange){area.focus({preventScroll:true});area.setSelectionRange(...selectedRange)}
}
function drawNote(t){
 if(renderedSource!==$('abc').value){clearTimeout(renderTimer);render();toast('Score updated. Click again to add the note.');return}
 const config=instruments[$('instrument').value];
 const token=pitchToken(t.written-Math.round(config.shift*7/12))+lengthText(beatLength()/unitLength());
 // Neighbours on the clicked staff, in reading order; the new note goes before the first one to the right of the click.
 const staffs=staffList(),items=[];
 for(const sel of renderedTune.engraver.selectables){
  const entry=noteSources.get(sel.absEl.abcelem.startChar);if(!entry)continue;
  const box=sel.svgEl.getBBox();if(nearestStaff(staffs,box.y+box.height/2).id!==t.staff.id)continue;
  items.push({x:box.x+box.width/2,entry});
 }
 items.sort((a,b)=>a.x-b.x);
 const next=items.find(i=>i.x>t.x),last=items.at(-1),value=$('abc').value;
 let at,text;
 const tuneEnd=Math.max(...[...noteSources.values()].filter(Boolean).map(e=>e.element.startChar));
 // Past the closing barline: add the note inside the tune, before that barline.
 if(!next&&last?.entry.element.el_type==='bar'&&last.entry.element.startChar===tuneEnd){at=last.entry.element.startChar;text=token+' '}
 else if(next){at=next.entry.element.startChar;text=token+' '}
 else if(last){at=last.entry.element.endChar;text=' '+token}
 else{at=value.length;text=(value.endsWith('\n')?'':'\n')+token}
 if(at>0&&!/\s/.test(value[at-1])&&!text.startsWith(' ')&&!text.startsWith('\n'))text=' '+text;
 const start=at+text.indexOf(token);applyNoteEdit(at,at,text,[start,start+token.length]);
 $('selection-status').textContent=`Added ${pitchName(t.written)} · right-click it to change accidental or length`;
}
function setDrawMode(on){
 drawMode=on;$('draw-mode').setAttribute('aria-pressed',on);$('notation').classList.toggle('drawing',on);showGhost(null);
 $('selection-status').textContent=on?'Draw mode: click the staff to add a note. Right-click a note to change it.':'Click a note to select its ABC text and starting measure. Drag up/down to change pitch; right-click for accidentals and length.';
}
$('draw-mode').onclick=()=>setDrawMode(!drawMode);
for(const type of ['mousedown','touchstart'])$('notation').addEventListener(type,e=>{
 if(!drawMode||onNote(e)||(type==='mousedown'&&e.button!==0))return;
 e.stopPropagation();if(!$('note-menu').hidden){e.preventDefault();closeNoteMenu();return}if(type==='mousedown'){e.preventDefault();const t=drawTarget(e);if(t)drawNote(t)}
},{capture:true,passive:false});
$('notation').addEventListener('mousemove',e=>{if(drawMode&&!renderedTune?.engraver?.dragTarget)showGhost(onNote(e)?null:drawTarget(e))});
$('notation').addEventListener('mouseleave',()=>showGhost(null));
// Note properties menu. Lengths come from the parsed (effective) duration, so chords and broken rhythm read correctly.
const DOTTABLE=[1,.5,.25,.125,.0625,.03125];
function closeNoteMenu(){$('note-menu').hidden=true;menuEntry=null}
const transposing=()=>{const shift=instruments[$('instrument').value].shift;return shift%12!==0?shift:0};
// Accidentals are what the player sees, so read and edit them in written pitch, then transpose back to the concert source.
function writtenNote(display){const w=writtenABC();return {text:w.slice(display.startChar,display.endChar),key:(w.match(/^K:(.*)$/m)||[,'C'])[1].replace(/\s+clef=\S+/g,'').trim()}}
function accidentalEdit(entry,display,acc){
 const old=$('abc').value.slice(entry.element.startChar,entry.element.endChar),shift=transposing();
 if(!shift)return editNoteText(old,{accidental:acc});
 const {text,key}=writtenNote(display),mini=`X:1\nL:1/8\nK:${key}\n${editNoteText(text,{accidental:acc})}\n`;
 const lines=ABCJS.strTranspose(mini,ABCJS.parseOnly(mini),-shift).split('\n'),note=lines[lines.findIndex(l=>l.startsWith('K:'))+1];
 return note==null?old:note;
}
// A note joined to its neighbour by > or < (broken rhythm), as [first, second] source entries.
function brokenPair(entry){
 const v=$('abc').value,notes=[...noteSources.values()].filter(e=>e?.element.el_type==='note').sort((a,b)=>a.element.startChar-b.element.startChar);
 const marked=e=>/[<>]/.test(noteParts(v.slice(e.element.startChar,e.element.endChar))?.post||''),i=notes.indexOf(entry);
 if(marked(entry)&&notes[i+1])return [entry,notes[i+1]];
 if(i>0&&marked(notes[i-1]))return [notes[i-1],entry];
 return null;
}
function openNoteMenu(entry,display,x,y){
 menuEntry={entry,display};
 const isRest=!entry.element.pitches?.length,text=transposing()?writtenNote(display).text:$('abc').value.slice(entry.element.startChar,entry.element.endChar);
 const acc=(noteParts(text)?.core.match(/^\[?(\^{1,2}|_{1,2}|=)/)||[])[1]||'',len=entry.element.duration||0;
 const durations=[[1,'𝅝 Whole'],[.5,'𝅗𝅥 Half'],[.25,'♩ Quarter'],[.125,'♪ Eighth'],[.0625,'𝅘𝅥𝅯 16th']];
 const dotted=DOTTABLE.some(v=>Math.abs(len-v*1.5)<1e-9),base=dotted?len/1.5:len;
 const item=(action,label,checked)=>`<button role="menuitemradio" aria-checked="${!!checked}" data-edit="${action}">${label}</button>`;
 $('note-menu').innerHTML=(isRest?'':`<div class="menu-label">ACCIDENTAL</div><div class="menu-row">${item('acc:^','♯ Sharp',acc==='^')}${item('acc:_','♭ Flat',acc==='_')}${item('acc:=','♮ Natural',acc==='=')}${item('acc:','None',!acc)}</div>`)
  +`<div class="menu-label">LENGTH</div>${durations.map(([v,l])=>item('len:'+v,l,Math.abs(base-v)<1e-9)).join('')}`
  +`<button role="menuitemcheckbox" aria-checked="${dotted}" data-edit="dot">· Dotted</button><hr><button role="menuitem" class="danger" data-edit="delete">Delete ${isRest?'rest':'note'}</button>`;
 const menu=$('note-menu');menu.hidden=false;
 menu.style.left=Math.max(8,Math.min(x,window.innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(y,window.innerHeight-menu.offsetHeight-8))+'px';
 menu.querySelector('button')?.focus({preventScroll:true});
}
$('notation').addEventListener('contextmenu',e=>{
 if(renderedSource!==$('abc').value){e.preventDefault();clearTimeout(renderTimer);render();toast('Score updated. Right-click the note again.');return}
 const sel=selectableAt(e),display=sel?.absEl.abcelem;
 const entry=display?.el_type==='note'&&noteSources.get(display.startChar);if(!entry)return;
 e.preventDefault();showGhost(null);scoreClick(display,0,[],{},null);
 const box=sel.svgEl.getBoundingClientRect();openNoteMenu(entry,display,e.clientX||box.right,e.clientY||box.bottom);
});
$('note-menu').addEventListener('click',e=>{
 const b=e.target.closest('[data-edit]'),picked=menuEntry;if(!b||!picked)return;
 e.stopPropagation();closeNoteMenu();
 if(renderedSource!==$('abc').value){clearTimeout(renderTimer);render();toast('Score updated. Right-click the note again.');return}
 const {entry,display}=picked,action=b.dataset.edit,area=$('abc'),v=area.value,start=entry.element.startChar,end=entry.element.endChar;
 if(action.startsWith('acc:')){applyNoteEdit(start,end,accidentalEdit(entry,display,action.slice(4)));return}
 const unit=unitLength(),len=entry.element.duration||0,dotted=DOTTABLE.some(x=>Math.abs(len-x*1.5)<1e-9);
 const change=t=>action==='delete'?'':editNoteText(t,{length:(action==='dot'?(dotted?len/1.5:len*1.5):+action.slice(4))/unit});
 const pair=brokenPair(entry);
 if(!pair){
  if(action==='delete')applyNoteEdit(start,end+(v[end]===' '?1:0),'');else applyNoteEdit(start,end,change(v.slice(start,end)));
  return;
 }
 // Spell the broken-rhythm pair out with explicit lengths so the neighbour keeps its duration.
 const [a,c]=pair,fixed=n=>editNoteText(v.slice(n.element.startChar,n.element.endChar),{length:(n.element.duration||0)/unit,unbroken:true});
 const first=a===entry?change(fixed(a)):fixed(a),second=c===entry?change(fixed(c)):fixed(c);
 const text=(first+v.slice(a.element.endChar,c.element.startChar)+second).replace(/^\s+/,m=>first?m:'');
 const spaced=second||!first?text:text.replace(/\s*$/,' ');
 applyNoteEdit(a.element.startChar,c.element.endChar,spaced,action==='delete'?null:undefined);
});
document.addEventListener('mousedown',e=>{if(!$('note-menu').hidden&&!$('note-menu').contains(e.target))closeNoteMenu()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('note-menu').hidden)closeNoteMenu()});
window.addEventListener('scroll',()=>{if(!$('note-menu').hidden)closeNoteMenu()},{passive:true});
for(const name of Object.keys(instruments))$('instrument').add(new Option(name,name));for(const note of 'CDEFGAB'){$('note-buttons').insertAdjacentHTML('beforeend',`<button data-token="${note}">${note}</button>`)}
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>show(b.dataset.view));document.querySelectorAll('.brand').forEach(a=>a.onclick=e=>{e.preventDefault();show('library')});$('browse').onclick=()=>$('library-top').scrollIntoView({behavior:'smooth'});$('start-writing').onclick=$('new-score').onclick=$('saved-new').onclick=newScore;
for(const id of ['search','level-filter','kind-filter','instrument-filter','genre-filter','sort-filter','collection-filter','license-filter'])$(id).addEventListener('input',()=>{libraryPage=0;renderCards()});
$('prev-page').onclick=()=>{libraryPage=Math.max(0,libraryPage-1);renderCards();$('library-top').scrollIntoView({behavior:'smooth'})};$('next-page').onclick=()=>{libraryPage++;renderCards();$('library-top').scrollIntoView({behavior:'smooth'})};
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.open)openScore(catalog.find(x=>x.id===b.dataset.open));if(b.dataset.saved){const x=saved.find(x=>x.id===b.dataset.saved);if(x)openScore(x,x.id)}if(b.dataset.favorite){const id=b.dataset.favorite;const next=favorites.includes(id)?favorites.filter(x=>x!==id):[...favorites,id];if(storage.set('commonnote-favorites-v1',next)){favorites=next;renderCards();renderSaved()}else toast('This browser could not save favorites.')}if(b.dataset.delete&&confirm('Delete this locally saved score?')){const next=saved.filter(x=>x.id!==b.dataset.delete);if(storage.set('commonnote-scores-v1',next)){saved=next;renderSaved();if(savedId===b.dataset.delete)savedId=null}else toast('Deletion could not be saved.')}if(b.dataset.token)insertToken(b.dataset.token)});
$('abc').addEventListener('input',()=>{syncFields();changed()});for(const [id,header] of [['title','T'],['composer','C'],['meter','M'],['key','K'],['bpm','Q']])$(id).addEventListener('input',()=>{setHeader(header,id==='bpm'?'1/4='+$(id).value:$(id).value);$('bpm-value').textContent=$('bpm').value;changed()});$('instrument').onchange=changed;$('volume').oninput=()=>{if(playing){stop();toast('Volume updated. Press Play to resume.')}};
$('help-toggle').onclick=()=>{$('abc-help').hidden=!$('abc-help').hidden};$('save').onclick=()=>{const id=savedId||globalThis.crypto?.randomUUID?.()||'score-'+Date.now();const entry={...current,id,title:field('T','Untitled'),composer:field('C'),abc:$('abc').value,instrument:$('instrument').value,updated:Date.now()};const next=saved.filter(x=>x.id!==id).concat(entry);if(storage.set('commonnote-scores-v1',next)){saved=next;savedId=id;dirty=false;$('save-status').textContent='Saved on this device. Export ABC for a lasting backup.';toast('Score saved');render()}else{$('save-status').textContent='This browser could not save. Export an ABC file to keep your score.'}};
$('import').onclick=()=>$('import-file').click();$('import-file').onchange=async()=>{const file=$('import-file').files[0];if(!file)return;if(file.size>1024*1024){toast('Please use an ABC file smaller than 1 MB.');return}try{const source=await file.text();if(ABCJS.numberOfTunes(source)!==1)throw new Error('Please import one ABC tune at a time.');if(!/^K:/m.test(source)||!/^X:/m.test(source))throw new Error('Expected an ABC score with X: and K: headers.');if(!allowReplace())return;dirty=false;const notice=source.match(/^% FretFree-Rights: (.*)$/m);let metadata={};if(notice){try{metadata=JSON.parse(notice[1]);if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))metadata={}}catch{}}openScore({...metadata,kind:'personal',abc:source});dirty=true;$('save-status').textContent='Imported locally. Save or export to keep a copy.'}catch(e){toast(e.message)}finally{$('import-file').value=''}};
$('play').onclick=()=>play();$('start-measure').onchange=()=>{stop();$('start-measure').value=Math.max(1,Math.min(+$('start-measure').max,+$('start-measure').value||1))};$('speed').oninput=()=>{const position=playing?playOrigin+Math.max(0,audio.currentTime-playClock)*playSpeed:null;$('speed-value').textContent=$('speed').value+'%';if(position!=null){stop();play(position)}};$('speed-reset').onclick=()=>{$('speed').value=100;$('speed').oninput()};$('stop').onclick=stop;$('print').onclick=()=>{render();const appendix=$('print-appendix');appendix.innerHTML=scoreLicense(current).startsWith('GPL-')?'<h2>Editable source and GPL license</h2><pre>'+esc(exportCredit(current)+'\n\nCorresponding editable ABC (FretFree export, 2026-10-03):\n'+$('abc').value+'\n\n'+GPL_LICENSE)+'</pre>':'';window.print()};$('export-abc').onclick=()=>download(creditedABC($('abc').value,current),safeName()+'.abc','text/plain');$('export-midi').onclick=()=>{try{download(creditedMidi(midiBytes($('abc').value),$('abc').value,current),safeName()+'.mid','audio/midi')}catch(e){toast(e.message)}};$('export-svg').onclick=()=>{try{clearTimeout(renderTimer);render();download(creditedSVG($('notation'),$('abc').value,current),safeName()+'.svg','image/svg+xml')}catch(e){toast(e.message)}};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()});
const initialView=location.hash.slice(1);
for(const name of [...new Set(catalog.map(scoreCollection))].sort())$('collection-filter').add(new Option(name,name));for(const name of [...new Set(catalog.map(scoreLicense))].sort())$('license-filter').add(new Option(name,name));
for(const genre of [...new Set(catalog.map(x=>x.genre||'Teaching melodies'))].sort())$('genre-filter').add(new Option(genre,genre));$('hero-count').textContent='01 / '+catalog.length;
ABCJS.renderAbc('hero-notation',catalog[0].abc,{staffwidth:460,responsive:'resize',scale:.9,paddingtop:25,paddingbottom:30});renderCards();newScore();show(['studio','saved','about'].includes(initialView)?initialView:'library');
