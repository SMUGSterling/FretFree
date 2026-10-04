'use strict';
const $=id=>document.getElementById(id), esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let renderedSource=null,renderedTune=null,noteSources=new Map(),measureStarts=new Map(),selectedRange=null,playOrigin=0,playClock=0,playSpeed=1;
let staffClefs=[],shownElements=new Map(),inputLength=null;let libraryPage=0;const PAGE_SIZE=24;
let current=null,savedId=null,dirty=false,renderTimer,storageOK=true,audio=null,playing=false,nodes=[],playGeneration=0;
const storage={get(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}},set(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true}catch{storageOK=false;return false}}};
let saved=storage.get('commonnote-scores-v1',[]),favorites=storage.get('commonnote-favorites-v1',[]);
if(!Array.isArray(saved))saved=[];if(!Array.isArray(favorites))favorites=[];
function toast(msg){$('toast').textContent=msg;$('toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').style.display='none',3500)}
function show(view){document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==view);document.querySelectorAll('.nav').forEach(el=>el.classList.toggle('active',el.dataset.view===view));if(view==='saved')renderSaved();if(view!=='studio')stop();history.replaceState(null,'','#'+view);window.scrollTo({top:0,behavior:'smooth'})}
function allowReplace(){return !dirty||confirm('Replace your unsaved changes? Save or export first if you want to keep them.');}
function openScore(item,id=null){if(!allowReplace())return;stop();current=item;savedId=id;dirty=false;selectedRange=null;$('selection-status').textContent='Click a note to select its ABC text and starting measure; Shift+click another to set the loop end. Drag up/down to change pitch; chords move together.';$('start-measure').value=1;$('end-measure').value='';$('abc').value=item.abc;inputLength=null;$('instrument').value=item.instrument||($('instrument-filter').value==='all'?'Flute':$('instrument-filter').value);resetHistory();syncFields();render();$('save-status').textContent='';show('studio')}
function newScore(){openScore({title:'Untitled melody',composer:'',kind:'personal',abc:tune('Untitled melody','','4/4','C',100,'C D E F | G2 G2 | F E D C | C4 |]')})}
function filteredCatalog(){const q=$('search').value.toLowerCase(),level=$('level-filter').value,kind=$('kind-filter').value,genre=$('genre-filter').value,collection=$('collection-filter').value,license=$('license-filter').value;const list=catalog.filter(x=>(collection==='all'||scoreCollection(x)===collection)&&(license==='all'||scoreLicense(x)===license)&&(level==='all'||x.level===level)&&(kind==='all'||x.kind===kind)&&(genre==='all'||(x.genre||'Teaching melodies')===genre)&&`${x.title} ${x.composer} ${x.skill} ${x.originalInstrument||''} ${x.aliases||''} ${x.attribution||''} ${scoreCollection(x)}`.toLowerCase().includes(q));const order=$('sort-filter').value;if(order==='title')list.sort((a,b)=>a.title.localeCompare(b.title));if(order==='composer')list.sort((a,b)=>a.composer.localeCompare(b.composer)||a.title.localeCompare(b.title));return list}
function renderCards(){const list=filteredCatalog();const pages=Math.max(1,Math.ceil(list.length/PAGE_SIZE));libraryPage=Math.min(libraryPage,pages-1);const visible=list.slice(libraryPage*PAGE_SIZE,(libraryPage+1)*PAGE_SIZE);$('result-count').textContent=`${list.length} scores · curated collection`;$('empty').hidden=list.length>0;$('pagination').hidden=list.length<=PAGE_SIZE;$('prev-page').disabled=libraryPage===0;$('next-page').disabled=libraryPage>=pages-1;$('page-status').textContent=`Page ${libraryPage+1} of ${pages} · ${list.length} scores`;$('cards').innerHTML=visible.map(x=>`<article class="card"><div class="mini-score" id="mini-${x.id}" aria-hidden="true"></div><div class="card-body"><div class="card-top"><span class="tag">${esc(licenseLabel(x))}</span><button class="favorite" data-favorite="${x.id}" aria-label="${favorites.includes(x.id)?'Unfavorite':'Favorite'} ${esc(x.title)}" aria-pressed="${favorites.includes(x.id)}">${favorites.includes(x.id)?'★':'☆'}</button></div><h3>${esc(x.title)}</h3><span class="small">${esc(x.composer)}</span><p>${esc(x.description)}</p>${x.pdf?`<a class="pdf-link" href="${esc(x.pdf)}" target="_blank" rel="noopener">Complete PDF · ${esc(x.originalInstrument)} ↗</a>`:''}<div class="card-bottom"><span>${x.level} · ${esc(x.skill)}</span><button data-open="${x.id}">${x.pdf?'Practice part':'Open score'} ↗</button></div></div></article>`).join('');for(const x of visible){const lines=x.abc.split('\n'),k=lines.findIndex(l=>l.startsWith('K:'));ABCJS.renderAbc(`mini-${x.id}`,lines.slice(0,k+1).filter(l=>!/^T:|^C:/.test(l)).join('\n')+'\n'+lines[k+1],{staffwidth:380,scale:.7,responsive:'resize',paddingtop:15});}}

function renderSaved(){const fav=catalog.filter(x=>favorites.includes(x.id));$('saved-cards').innerHTML=(saved.length||fav.length)?saved.map(x=>`<article class="card"><div class="card-body"><span class="tag">SAVED ON THIS DEVICE</span><h3>${esc(x.title)}</h3><p>${esc(x.composer||'Your composition')}<br>${new Date(x.updated).toLocaleDateString()}</p><div class="card-bottom"><button data-saved="${esc(x.id)}">Open score ↗</button><button data-delete="${esc(x.id)}">Delete</button></div></div></article>`).join('')+fav.map(x=>`<article class="card"><div class="card-body"><span class="tag">FAVORITE</span><h3>${esc(x.title)}</h3><p>${esc(x.composer)}</p><div class="card-bottom"><button data-open="${x.id}">Open score ↗</button><button data-favorite="${x.id}">Remove favorite</button></div></div></article>`).join(''):'<div class="empty">Your collection starts here.<br>Save a composition or tap a star in the library.</div>'}
function field(name,defaultValue=''){const match=$('abc').value.match(new RegExp('^'+name+':(.*)$','m'));return match?match[1].trim():defaultValue}
function assignSelect(id,value){const select=$(id);if(![...select.options].some(o=>o.value===value))select.add(new Option(value,value));select.value=value}
function syncFields(){$('title').value=field('T','Untitled');$('composer').value=field('C');assignSelect('meter',field('M','4/4'));assignSelect('key',field('K','C').split(/\s/)[0]);const m=field('Q','100').match(/(\d+)\s*$/);$('bpm').value=m?Math.max(40,Math.min(200,+m[1])):100;$('bpm-value').textContent=$('bpm').value}
function setHeader(name,value){const lines=$('abc').value.split('\n'),i=lines.findIndex(x=>x.startsWith(name+':'));const text=name+':'+String(value).replace(/[\r\n]/g,' ');if(i>=0)lines[i]=text;else lines.splice(Math.max(0,lines.findIndex(x=>x.startsWith('K:'))),0,text);$('abc').value=lines.join('\n')}
function writtenABC(){let source=$('abc').value;const config=instruments[$('instrument').value];if(config.shift)source=ABCJS.strTranspose(source,ABCJS.parseOnly(source),config.shift);source=source.replace(/^K:(.*)$/m,(_,key)=>'K:'+key.replace(/\s+clef=\S+/g,'')+' clef='+config.clef);return source}
function scoreClick(element,tuneNumber,classes,analysis,drag,event){
 if(renderedSource!==$('abc').value){clearTimeout(renderTimer);render();toast('Score updated. Select the note again.');return}
 const entry=noteSources.get(element.startChar);if(!entry)return;
 const area=$('abc'),start=entry.element.startChar,end=entry.element.endChar;
 if(start==null||end==null)return;
 let nextEnd=end;
 // Bundled abcjs 6.5.2 reports SVG Y steps: negative is upward.
 if(drag?.step&&entry.element.pitches?.length){
  flushTyping();
  const old=area.value.slice(start,end),replacement=moveNoteText(old,-drag.step);
  area.setRangeText(replacement,start,end,'select');nextEnd=start+replacement.length;
  dirty=true;$('save-status').textContent='Unsaved changes';clearTimeout(renderTimer);
  selectedRange=[start,nextEnd];render();
 }
 selectedRange=[start,nextEnd];area.setSelectionRange(start,nextEnd);focusScore();
 // Shift+click sets the end of the practice range; a plain click sets its start.
 if(event?.shiftKey&&!drag?.step){setRange(+$('start-measure').value,entry.measure);return}
 $('start-measure').value=entry.measure;if(+$('end-measure').value<entry.measure)$('end-measure').value=$('end-measure').max;
 shadeRange();
 $('selection-status').textContent=`Measure ${entry.measure} selected · type A–G to add notes after it, ↑↓ to change pitch · Shift+click another note to set the loop end`;
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
 // The end follows the last measure unless the student picked an earlier one.
 const followEnd=!+$('end-measure').value||+$('end-measure').value>=+$('end-measure').max;
 $('start-measure').max=$('end-measure').max=total;$('start-measure').value=Math.max(1,Math.min(total,+$('start-measure').value||1));
 $('end-measure').value=followEnd?total:Math.max(+$('start-measure').value,Math.min(total,+$('end-measure').value));
 $('measure-count').textContent=`of ${total}`;shadeRange();
}
function render(){stop();recordHistory();try{const source=writtenABC();renderedSource=$('abc').value;const original=ABCJS.parseOnly(renderedSource)[0];const display=ABCJS.parseOnly(source)[0];noteSources=sourceMap(original,display);const tunes=ABCJS.renderAbc('notation',source,{responsive:'resize',staffwidth:740,add_classes:true,dragging:true,selectTypes:['note','bar'],selectionColor:'#317761',dragColor:'#ba663d',clickListener:scoreClick});renderedTune=tunes[0];{const shown=scoreEvents(display),lengths=effectiveDurations(shown);noteDurations=new Map(shown.map(e=>[e.element.startChar,lengths.get(e.element)||0]));shownElements=new Map(shown.map(e=>[e.element.startChar,e.element]))}staffClefs=display.lines.filter(l=>l.staff).map(l=>l.staff.map(st=>st.clef?.verticalPos||0));updateMeasures();updateBarCheck(original);updatePromptCheck(display);if(selectedRange&&renderedTune?.engraver){const match=[...noteSources.entries()].find(([,e])=>e?.element.startChar===selectedRange[0]);if(match){const shown=scoreEvents(display).find(e=>e.element.startChar===match[0]);if(shown)renderedTune.engraver.rangeHighlight(shown.element.startChar,shown.element.endChar)}}$('warnings').textContent=(tunes[0]?.warnings||[]).map(x=>String(x).replace(/<[^>]+>/g,'')).join(' · ');$('workspace-heading').textContent=field('T','Untitled melody');const config=instruments[$('instrument').value];$('score-caption').textContent=`${$('instrument').value} · ${config.clef} clef · ${config.shift===2||config.shift===9?'Written pitch shown; ABC source and MIDI are concert pitch.':config.shift===-12?'Melody lowered one octave for bass range.':'Concert pitch melody part.'}`;const edition=$('source-edition');edition.hidden=!(current?.pdf||current?.originalSource);if(current?.pdf){edition.innerHTML=`<strong>Complete source edition</strong><p>The editor shows an extracted upper-part study, up to 32 bars. The original PDF below includes the complete score for ${esc(current.originalInstrument)}.</p><div class="source-actions"><a class="button-link" href="${esc(current.pdf)}" target="_blank" rel="noopener">Open complete PDF ↗</a><a class="button-link" href="${esc(current.pdf)}" download>Download PDF</a><a class="button-link" href="${esc(current.originalMidi)}" download>Original MIDI</a>${current.originalSource?`<a class="button-link" href="${esc(current.originalSource)}" download>Original editable source</a>`:''}</div>`}else if(current?.originalSource){edition.innerHTML=`<strong>Complete original ABC source</strong><p>${esc(current.studyTransform)} License: ${esc(scoreLicense(current))}. See the credit notice below before sharing.</p><a class="button-link" href="${esc(current.originalSourceDownload||current.originalSource)}" download>${current.originalSourceDownload?'Download original ABC + license bundle':'Download complete original ABC'}</a>`}const r=current?.rights;if(r){$('rights').innerHTML=`<strong>${esc(licenseLabel(current))} · ${esc(scoreCollection(current))}</strong>${esc(r)}<br>${current.attribution?`Credit: ${esc(current.attribution)}<br>`:''}${current.licenseURL?`<a href="${esc(current.licenseURL)}" target="_blank" rel="noopener">License terms ↗</a><br>`:''}<a href="${esc(current.source)}" target="_blank" rel="noopener">${esc(current.sourceLabel)} ↗</a><br><span class="small">${dirty?'Your edits stay private. Export or save a copy to preserve them.':'Use, print, practice, and adapt this teaching version.'}</span>`}else{$('rights').innerHTML='<strong>Your private workspace</strong>Your work stays on this device. Imported music keeps its original rights; importing or editing a file does not make it public domain.'}}catch(e){$('warnings').textContent='Could not render this score: '+e.message}}
function changed(){stop();selectedRange=null;dirty=true;$('save-status').textContent='Unsaved changes';clearTimeout(renderTimer);renderTimer=setTimeout(render,220)}
function noteLength(){const match=field('L','1/8').match(/^(\d+)\/(\d+)$/);const base=match?+match[1]/+match[2]:.125;const beats=({'1':1,'/2':.5,'2':2,'4':4})[$('duration').value];const length=beats/4/base;return length===1?'':Number.isInteger(length)?String(length):'/'+String(Math.round(1/length))}
function insertToken(token){flushTyping();const area=$('abc'),start=area.selectionStart,end=area.selectionEnd;const keyLine=area.value.match(/^K:.*(?:\n|$)/m);if(!keyLine){toast('Add a K: key header before writing notes.');return}const musicStart=keyLine.index+keyLine[0].length;if(start<musicStart){toast('Place the cursor after the K: line to add notes.');area.focus();area.setSelectionRange(area.value.length,area.value.length);return}const prefix=['^','_','='].includes(token);let text=token;if(/^[A-G]$/.test(token)){if($('octave').value==='upper')text=token.toLowerCase();if($('octave').value==='lower')text=token+',';text+=noteLength()}if(token==='z')text+=noteLength();if(!prefix)text+=' ';area.setRangeText(text,start,end,'end');area.focus();changed();clearTimeout(renderTimer);render()}
function safeName(){return field('T','score').replace(/[^a-z0-9_-]+/gi,'-').slice(0,80)||'score'}
function download(data,name,type){const blob=new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function midiBytes(source){const result=ABCJS.synth.getMidiFile(source,{midiOutputType:'encoded'});const uri=Array.isArray(result)?result[0]:result;if(typeof uri!=='string'||!uri.startsWith('data:'))throw new Error('MIDI could not be generated. Check your notation.');const [meta,body]=uri.split(',');return meta.includes(';base64')?Uint8Array.from(atob(body),c=>c.charCodeAt(0)):Uint8Array.from(body.match(/%[0-9a-f]{2}|[^%]/gi)||[],t=>t[0]==='%'?parseInt(t.slice(1),16):t.charCodeAt(0))}
// Decode MIDI note and tempo events generated by abcjs, including polyphonic voices.
function parseMidi(bytes){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),division=v.getUint16(12);if(division&0x8000)throw new Error('SMPTE MIDI timing is not supported');let pos=14,events=[];const vlq=()=>{let n=0,b;do{b=bytes[pos++];n=(n<<7)|(b&127)}while(b&128);return n};while(pos+8<=bytes.length){const tag=String.fromCharCode(...bytes.slice(pos,pos+4)),len=v.getUint32(pos+4);pos+=8;const end=pos+len;if(tag!=='MTrk'){pos=end;continue}let tick=0,running=0;while(pos<end){tick+=vlq();let status=bytes[pos++];if(status<128){pos--;status=running}else if(status<240)running=status;if(status===255){const kind=bytes[pos++],size=vlq();if(kind===81&&size===3)events.push({tick,tempo:(bytes[pos]<<16)|(bytes[pos+1]<<8)|bytes[pos+2]});pos+=size;continue}if(status===240||status===247){const size=vlq();pos+=size;continue}const cmd=status&240,ch=status&15,a=bytes[pos++],b=(cmd===192||cmd===208)?0:bytes[pos++];if(cmd===144||cmd===128)events.push({tick,ch,note:a,velocity:b,on:cmd===144&&b>0});}pos=end}events.sort((a,b)=>a.tick-b.tick);let tick=0,time=0,tempo=500000,active=new Map(),notes=[];for(const e of events){time+=(e.tick-tick)*tempo/1000000/division;tick=e.tick;if(e.tempo){tempo=e.tempo;continue}const key=e.ch+':'+e.note;if(e.on){active.set(key,{note:e.note,start:time,velocity:e.velocity})}else if(active.has(key)){const n=active.get(key);notes.push({...n,duration:Math.max(.025,time-n.start)});active.delete(key)}}for(const n of active.values())notes.push({...n,duration:Math.max(.1,time-n.start)});return {notes,duration:Math.max(time,...notes.map(n=>n.start+n.duration),0)}}
// Tint the practice range on the score so students can see what will play and loop.
// Undo/redo for every change to the ABC source. Programmatic edits (drag, draw, menu, bar fixes, buttons) are one step
// each; a burst of typing is one step. Undoing back to the opened text clears the unsaved-changes state.
let editHistory=[],historyIndex=0,typingEdit=false,lastTypingAt=0,cleanKey='';
const HISTORY_LIMIT=200;
// A history state is the ABC text plus the instrument, which is saved with the score.
function snapshot(){const a=$('abc');return {abc:a.value,instrument:$('instrument').value,start:a.selectionStart||0,end:a.selectionEnd||0}}
const stateKey=s=>s.abc+'\u0000'+s.instrument;
// The clean state is the opened score, or the last save; undoing or redoing onto it clears "Unsaved changes".
function markClean(){cleanKey=stateKey(snapshot())}
function resetHistory(){editHistory=[snapshot()];historyIndex=0;markClean();typingEdit=false;lastTypingAt=0;updateHistoryButtons()}
function recordHistory(){
 const now=snapshot();if(!editHistory.length){resetHistory();return}
 if(stateKey(now)===stateKey(editHistory[historyIndex])){typingEdit=false;return}
 editHistory.length=historyIndex+1;
 const coalesce=typingEdit&&editHistory[historyIndex].typing===typingEdit&&Date.now()-lastTypingAt<1500&&historyIndex>0;
 if(coalesce)editHistory[historyIndex]={...now,typing:typingEdit};else{editHistory.push({...now,typing:typingEdit});historyIndex++}
 lastTypingAt=typingEdit?Date.now():0;typingEdit=false;
 if(editHistory.length>HISTORY_LIMIT){editHistory.shift();historyIndex--}
 updateHistoryButtons();
}
// typingEdit names what is being typed into (the ABC box or a header field) so bursts merge into one step,
// but a burst in one place never merges with a different one or with an edit made on the score.
function noteTyping(source){if(typingEdit&&typingEdit!==source){clearTimeout(renderTimer);recordHistory()}typingEdit=source}
function flushTyping(){if(typingEdit){clearTimeout(renderTimer);recordHistory()}}
function updateHistoryButtons(){const u=$('undo'),r=$('redo');if(u)u.disabled=historyIndex<=0;if(r)r.disabled=historyIndex>=editHistory.length-1}
function stepHistory(delta){
 clearTimeout(renderTimer);recordHistory();
 const next=historyIndex+delta;if(next<0||next>=editHistory.length)return;
 // Offsets held by the note menu, a pending typing merge or a selection belong to the text being replaced.
 closeNoteMenu();lastTypingAt=0;
 historyIndex=next;const state=editHistory[next],a=$('abc');
 a.value=state.abc;$('instrument').value=state.instrument;a.setSelectionRange?.(state.start,state.end);
 dirty=stateKey(state)!==cleanKey;$('save-status').textContent=dirty?'Unsaved changes':'';selectedRange=null;syncFields();render();updateHistoryButtons();
 $('selection-status').textContent=delta<0?'Undid the last change.':'Redid the change.';
}
// Tinted boxes behind measures: one per line for a span, or one per measure.
function shadeMeasures(cls,include,perMeasure=false){
 const svg=$('notation')?.querySelector?.('svg');if(!svg)return;
 svg.querySelectorAll('.'+cls).forEach(el=>el.remove());
 const boxes=new Map();
 for(const e of renderedTune?.noteTimings||[]){
  if(e.type!=='event'||e.left==null)continue;
  const measure=(e.startCharArray||[]).map(c=>noteSources.get(c)?.measure).find(Boolean);if(!measure||!include(measure))continue;
  const key=perMeasure?e.line+'|'+measure:e.line,box=boxes.get(key)||{x0:Infinity,x1:-Infinity,y0:Infinity,y1:-Infinity,measure};
  box.x0=Math.min(box.x0,e.left);box.x1=Math.max(box.x1,e.left+e.width);box.y0=Math.min(box.y0,e.top);box.y1=Math.max(box.y1,e.top+e.height);boxes.set(key,box);
 }
 for(const b of boxes.values()){
  const r=document.createElementNS('http://www.w3.org/2000/svg','rect');r.setAttribute('class',cls);r.dataset.measure=b.measure;
  r.setAttribute('x',b.x0-8);r.setAttribute('y',b.y0-6);r.setAttribute('width',b.x1-b.x0+16);r.setAttribute('height',b.y1-b.y0+12);r.setAttribute('rx',4);
  svg.insertBefore(r,svg.firstChild);
 }
}
// Tint the practice range on the score so students can see what will play and loop.
function shadeRange(){
 const {from,to,total}=measureRange();
 shadeMeasures('range-shade',m=>!(from===1&&to===total)&&m>=from&&m<=to);
}
// Bar check: flag measures with too many or too few beats, in plain words, with a one-click fix where one is safe.
// Library editions keep their historic irregular bars, so only bars that differ from the opened edition are flagged.
let barBaseline=[],barIssues=[];
const barText=m=>$('abc').value.slice(m.notes[0].element.startChar,(m.bar||m.notes.at(-1).element).endChar);
const barKey=m=>m.voice+'|'+barText(m).replace(/\s+/g,'');
const NOTE_VALUES={1:'a whole note',.75:'a dotted half note',.5:'a half note',.375:'a dotted quarter',.25:'a quarter note',.1875:'a dotted eighth',.125:'an eighth note',.0625:'a sixteenth note'};
function beatCount(value){const whole=Math.floor(value+1e-9),part=value-whole,frac={.25:'¼',.5:'½',.75:'¾'}[Math.round(part*4)/4];return Math.abs(part)<1e-6?String(whole):frac&&Math.abs(part-Math.round(part*4)/4)<1e-6?(whole||'')+frac:value.toFixed(2)}
function beatWords(length,meter){const unit={2:'half-note beat',4:'beat',8:'eighth',16:'sixteenth'}[meter.den]||'beat',n=length*meter.den,text=beatCount(n);return text+' '+unit+(text==='1'?'':'s')}
function amountWords(whole,meter){return NOTE_VALUES[Math.round(whole*1e6)/1e6]||beatWords(whole,meter)+"' worth"}
function barSplit(m){const k=m.notes.findIndex(n=>Math.abs(n.at-m.expected)<1e-6);return k>=0&&k<m.notes.length-1?m.notes[k]:null}
// Each irregular bar of the opened edition excuses one current bar with the same text: the nearest by measure number,
// so a student's identical bar elsewhere is still flagged and repeated edition bars are counted separately.
function newBarProblems(problems){
 const left=problems.slice();
 for(const b of barBaseline){
  let best=-1;
  for(const [i,m] of left.entries())if(barKey(m)===b.key&&(best<0||Math.abs(m.measure-b.measure)<Math.abs(left[best].measure-b.measure)))best=i;
  if(best>=0)left.splice(best,1);
 }
 return left;
}
function updateBarCheck(tune){
 const problems=barProblems(tune),fromLibrary=catalog.includes(current),voices=new Set(barLengths(tune).map(m=>m.voice)).size;
 if(!dirty)barBaseline=fromLibrary?problems.map(m=>({key:barKey(m),measure:m.measure})):[];
 barIssues=newBarProblems(problems);
 shadeMeasures('bar-flag',m=>barIssues.some(i=>i.measure===m),true);
 const box=$('bar-check');if(!box)return;
 if(!barIssues.length){
  box.className='bar-check ok';
  box.innerHTML=!dirty&&barBaseline.length?`This historic edition has ${barBaseline.length} bar${barBaseline.length===1?' that doesn’t':'s that don’t'} match the time signature. That's how the source was written.`
   :noteSources.size&&(dirty||!fromLibrary)?'✓ Every bar has the right number of beats.':'';
  box.hidden=!box.innerHTML;return;
 }
 box.className='bar-check';box.hidden=false;
 const items=barIssues.slice(0,6).map((m,i)=>{
  const where=(voices>1?`Voice ${+m.voice.split(':')[1]+1}, measure `:'Measure ')+m.measure,diff=Math.abs(m.length-m.expected);
  const said=`${where} has ${beatWords(m.length,m.meter)}; ${m.meter.label} needs ${beatWords(m.expected,m.meter)}.`;
  const advice=m.length<m.expected?`Add ${amountWords(diff,m.meter)} or rest.`:`It's ${amountWords(diff,m.meter)} too long. Shorten or remove a note${barSplit(m)?', or split the bar':''}.`;
  const fix=m.length<m.expected?`<button data-bar-fix="rest" data-bar="${i}">Fill with a rest</button>`:barSplit(m)?`<button data-bar-fix="split" data-bar="${i}">Split the bar</button>`:'';
  return `<li><span>${said} ${advice}</span><span class="bar-actions"><button data-bar-fix="show" data-bar="${i}">Show</button>${fix}</span></li>`;
 }).join('');
 box.innerHTML=`<strong>Check your bars</strong><ul>${items}</ul>${barIssues.length>6?`<p class="small">${barIssues.length-6} more bar${barIssues.length-6===1?'':'s'} to check.</p>`:''}`;
}
function setRange(from,to){
 if(to<from)[from,to]=[to,from];
 stop();$('start-measure').value=from;$('end-measure').value=to;shadeRange();
 $('selection-status').textContent=`Practice range: measures ${from}–${to}. Turn on Loop to repeat it.`;
}
// Practice playback: plays a measure range, optionally looped, with count-in, metronome and a speed trainer.
// Each pass is scheduled on the audio clock just before the previous one ends, so loops are gapless.
let playTimers=[];
function stop(){playing=false;playGeneration++;playTimers.forEach(clearTimeout);playTimers=[];stopFollow();for(const node of nodes){try{node.stop()}catch{}}nodes=[];$('play').textContent='▶ Play';$('play-status').textContent='Ready to play'}
const atAudioTime=(time,fn)=>playTimers.push(setTimeout(fn,Math.max(0,(time-audio.currentTime)*1000)));
function measureRange(){
 const total=+$('start-measure').max||1,clamp=v=>Math.max(1,Math.min(total,Math.round(v)||1));
 const from=clamp(+$('start-measure').value),to=Math.max(from,clamp(+$('end-measure').value||total));
 return {from,to,total};
}
// Score seconds where the range ends: the first performance of the next measure, or the end of the tune.
function rangeEnd(to,duration,from=-Infinity){const later=[...measureStarts].filter(([m,t])=>m>to&&t>from).map(([,t])=>t);return later.length?Math.min(...later):duration}
// Beats per bar: compound meters (6/8, 9/8, 12/8) count dotted beats.
function beatsPerBar(){const [n,d]=meterParts();return d===8&&n>3&&n%3===0?n/3:n}
// Written length of each measure in whole notes: the longest voice, so pickups and short final bars are measured, not assumed.
function measureLengths(){
 const sums=new Map(),events=[...new Set(noteSources.values())].filter(Boolean),durations=effectiveDurations(events);
 for(const e of events){
  if(e.element.el_type!=='note')continue;
  const key=e.measure+'|'+e.key.split(':').slice(0,2).join(':');
  sums.set(key,(sums.get(key)||0)+durations.get(e.element));
 }
 const lengths=new Map();
 for(const [key,sum] of sums){const m=+key.split('|')[0];lengths.set(m,Math.max(lengths.get(m)||0,sum))}
 return lengths;
}
// Metronome clicks in score seconds. Each bar's clicks are spaced from that bar's real start and end, so they follow
// repeats and tempo changes at barlines; a pickup bar is aligned to its end.
function clickTimes(from,until,end=until){
 const beats=beatsPerBar(),bar=renderedTune?.getBarLength?.()||1,beat=bar/beats,lengths=measureLengths(),out=[];
 const starts=(renderedTune?.noteTimings||[]).filter(e=>e.type==='event'&&e.measureStart);
 for(const [i,e] of starts.entries()){
  const t=e.milliseconds/1000,next=starts[i+1]?starts[i+1].milliseconds/1000:end;
  const measure=(e.startCharArray||[]).map(c=>noteSources.get(c)?.measure).find(Boolean);
  const length=lengths.get(measure)||bar,secondsPerWhole=(next-t)/length,pickup=i===0&&length<bar-1e-9;
  for(let k=0;k<beats;k++){
   const p=pickup?length-(beats-k)*beat:k*beat;
   if(p<-1e-9||p>=length-1e-9)continue;
   const c=t+p*secondsPerWhole;if(c>=from-1e-6&&c<until-1e-6)out.push({time:c,down:k===0&&!pickup});
  }
 }
 return out;
}
function click(time,down){
 const osc=audio.createOscillator(),gain=audio.createGain(),level=+$('volume').value*(down?.5:.3);
 osc.type='square';osc.frequency.value=down?1760:1320;
 gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime(level,time+.002);gain.gain.exponentialRampToValueAtTime(.0001,time+.05);
 osc.connect(gain);gain.connect(audio.destination);osc.start(time);osc.stop(time+.06);osc.onended=()=>osc.done=true;nodes.push(osc);
}
function scheduleNotes(notes,base){
 const config=instruments[$('instrument').value],volume=+$('volume').value;
 for(const n of notes){
  const osc=audio.createOscillator(),gain=audio.createGain();osc.type=config.wave;osc.frequency.value=440*2**((n.note+(config.shift===-12?-12:0)-69)/12);
  const start=base+n.start,end=start+n.duration,attack=Math.min(.012,n.duration/3);
  gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(volume*.12*n.velocity/100,start+attack);gain.gain.setValueAtTime(volume*.08*n.velocity/100,Math.max(start+attack,end-.04));gain.gain.linearRampToValueAtTime(0,end+.025);
  osc.connect(gain);gain.connect(audio.destination);osc.start(start);osc.stop(end+.03);osc.onended=()=>osc.done=true;nodes.push(osc);
 }
}
function schedulePass(p,from,percent,base,pass){
 const speed=percent/100,data=playbackSlice(p.full,from,percent,p.until),looping=$('loop').checked||$('trainer').checked;
 scheduleNotes(data.notes,base);
 if($('metronome').checked)for(const c of clickTimes(from,p.until,p.full.duration))click(base+(c.time-from)/speed,c.down);
 atAudioTime(base,()=>{
  if(p.generation!==playGeneration)return;
  playOrigin=from;playClock=base;playSpeed=speed;nodes=nodes.filter(n=>!n.done);startFollow(p.generation);
  if($('trainer').checked){$('speed').value=percent;$('speed-value').textContent=percent+'%'}
  $('play-status').textContent=`Measures ${p.range.from}–${p.range.to} · ${percent}% speed`+(looping?` · loop ${pass}`:'');
 });
 const end=base+(p.until-from)/speed;
 if(looping)atAudioTime(Math.max(base,end-.25),()=>{
  if(p.generation!==playGeneration)return;
  // Speed trainer: raise the tempo after each pass until it reaches the goal.
  let next=percent;
  if($('trainer').checked)next=Math.min(Math.max(percent,trainerGoal()),percent+(+$('trainer-step').value||5));
  schedulePass(p,p.start,next,end,pass+1);
 });
 else atAudioTime(end+.12,()=>{if(p.generation===playGeneration)stop()});
}
async function play(resumeFrom=null){
 if(playing){stop();return}
 clearTimeout(renderTimer);render();const generation=++playGeneration;
 try{
  audio ||= new (window.AudioContext||window.webkitAudioContext)();await audio.resume();if(generation!==playGeneration)return;
  const full=parseMidi(midiBytes($('abc').value)),range=measureRange(),start=measureStarts.get(range.from);
  const from=resumeFrom??start;
  if(from==null){toast('This measure has no playback event. Check the ABC notation.');return}
  const until=rangeEnd(range.to,full.duration,from),percent=+$('speed').value;
  if(!playbackSlice(full,from,percent,until).notes.length){toast('Add some notes before playback.');return}
  playing=true;$('play').textContent='■ Playing';
  let base=audio.currentTime+.07;
  // Count-in: one bar of clicks at the starting tempo, only when starting fresh.
  if(resumeFrom==null&&$('count-in').checked){
   // Beat length at the start: the spacing of the first full-bar clicks from the starting measure onward.
   const beats=beatsPerBar(),grid=clickTimes(from,full.duration,full.duration),down=grid.findIndex((c,i)=>c.down&&grid[i+1]);
   const step=(down>=0?grid[down+1].time-grid[down].time:.5)/(percent/100);
   for(let k=0;k<beats;k++)click(base+k*step,k===0);
   $('play-status').textContent='Count-in…';base+=beats*step;
  }
  else $('play-status').textContent=`Measures ${range.from}–${range.to} · ${percent}% speed`;
  playOrigin=from;playClock=base;playSpeed=percent/100;
  schedulePass({full,range,start,until,generation},from,percent,base,1);
 }catch(e){stop();toast('Playback unavailable: '+e.message)}
}
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
// Unit length in force at a source position: the last L: field before it, on a header line or inline as [L:].
function unitLengthAt(pos){
 let found=null;for(const m of $('abc').value.slice(0,pos).matchAll(/(?:^|\n)L:\s*(\d+)\s*\/\s*(\d+)|\[L:\s*(\d+)\s*\/\s*(\d+)\s*\]/g))found=m;
 return found?+(found[1]||found[3])/+(found[2]||found[4]):unitLength();
}
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
 flushTyping();const area=$('abc');area.setRangeText(text,start,end,'end');
 dirty=true;$('save-status').textContent='Unsaved changes';clearTimeout(renderTimer);syncFields();
 selectedRange=select;render();
 if(selectedRange)area.setSelectionRange(...selectedRange);focusScore();
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
  +`<button role="menuitemcheckbox" aria-checked="${dotted}" data-edit="dot">· Dotted</button>`+(isRest?'':`<button role="menuitemcheckbox" aria-checked="${/^-/.test(noteParts($('abc').value.slice(entry.element.startChar,entry.element.endChar))?.post||'')}" data-edit="tie">⁀ Tie to next note</button>`)
  +`<div class="menu-label">INSERT AFTER</div><div class="menu-row"><button role="menuitem" data-edit="rest-after">𝄽 Rest</button><button role="menuitem" data-edit="bar-after">| Bar line</button></div><hr><button role="menuitem" class="danger" data-edit="delete">Delete ${isRest?'rest':'note'}</button>`;
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
// One edit on one note, shared by the note menu and the keyboard. Actions: acc:<^|_|=|>, len:<whole>, dot, tie,
// delete, rest-after, bar-after.
function editNote(entry,display,action){
 const area=$('abc'),v=area.value,start=entry.element.startChar,end=entry.element.endChar,old=v.slice(start,end);
 if(action.startsWith('acc:')){applyNoteEdit(start,end,accidentalEdit(entry,display,action.slice(4)));return}
 if(action==='tie'){applyNoteEdit(start,end,editNoteText(old,{tie:!/^-/.test(noteParts(old)?.post||'')}));return}
 if(action==='rest-after'||action==='bar-after'){
  const token=action==='bar-after'?'|':'z'+lengthText((entry.element.duration||beatLength())/unitLengthAt(end));
  insertAt(end,token,action==='rest-after');return;
 }
 const unit=unitLength(),len=entry.element.duration||0,dotted=DOTTABLE.some(x=>Math.abs(len-x*1.5)<1e-9);
 const change=t=>action==='delete'?'':editNoteText(t,{length:(action==='dot'?(dotted?len/1.5:len*1.5):+action.slice(4))/unit});
 const pair=brokenPair(entry);
 if(!pair){
  // Deleting keeps the previous note selected so typing can carry on from there.
  const prev=action==='delete'?scoreNotes().filter(n=>n.element.startChar<start).pop():null;
  if(action==='delete')applyNoteEdit(start,end+(v[end]===' '?1:0),'',prev?[prev.element.startChar,prev.element.endChar]:null);
  else applyNoteEdit(start,end,change(old));
  return;
 }
 // Spell the broken-rhythm pair out with explicit lengths so the neighbour keeps its duration.
 const [a,c]=pair,fixed=n=>editNoteText(v.slice(n.element.startChar,n.element.endChar),{length:(n.element.duration||0)/unit,unbroken:true});
 const first=a===entry?change(fixed(a)):fixed(a),second=c===entry?change(fixed(c)):fixed(c);
 const text=(first+v.slice(a.element.endChar,c.element.startChar)+second).replace(/^\s+/,m=>first?m:'');
 const spaced=second||!first?text:text.replace(/\s*$/,' ');
 applyNoteEdit(a.element.startChar,c.element.endChar,spaced,action==='delete'?null:undefined);
}
$('note-menu').addEventListener('click',e=>{
 const b=e.target.closest('[data-edit]'),picked=menuEntry;if(!b||!picked)return;
 e.stopPropagation();closeNoteMenu();
 if(renderedSource!==$('abc').value){clearTimeout(renderTimer);render();toast('Score updated. Right-click the note again.');return}
 editNote(picked.entry,picked.display,b.dataset.edit);
});
document.addEventListener('mousedown',e=>{if(!$('note-menu').hidden&&!$('note-menu').contains(e.target))closeNoteMenu()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('note-menu').hidden)closeNoteMenu()});
window.addEventListener('scroll',()=>{if(!$('note-menu').hidden)closeNoteMenu()},{passive:true});
for(const name of Object.keys(instruments))$('instrument').add(new Option(name,name));for(const note of 'CDEFGAB'){$('note-buttons').insertAdjacentHTML('beforeend',`<button data-token="${note}">${note}</button>`)}
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>show(b.dataset.view));document.querySelectorAll('.brand').forEach(a=>a.onclick=e=>{e.preventDefault();show('library')});$('browse').onclick=()=>$('library-top').scrollIntoView({behavior:'smooth'});$('start-writing').onclick=$('new-score').onclick=$('saved-new').onclick=newScore;
for(const id of ['search','level-filter','kind-filter','instrument-filter','genre-filter','sort-filter','collection-filter','license-filter'])$(id).addEventListener('input',()=>{libraryPage=0;renderCards()});
$('prev-page').onclick=()=>{libraryPage=Math.max(0,libraryPage-1);renderCards();$('library-top').scrollIntoView({behavior:'smooth'})};$('next-page').onclick=()=>{libraryPage++;renderCards();$('library-top').scrollIntoView({behavior:'smooth'})};
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.open)openScore(catalog.find(x=>x.id===b.dataset.open));if(b.dataset.saved){const x=saved.find(x=>x.id===b.dataset.saved);if(x)openScore(x,x.id)}if(b.dataset.favorite){const id=b.dataset.favorite;const next=favorites.includes(id)?favorites.filter(x=>x!==id):[...favorites,id];if(storage.set('commonnote-favorites-v1',next)){favorites=next;renderCards();renderSaved()}else toast('This browser could not save favorites.')}if(b.dataset.delete&&confirm('Delete this locally saved score?')){const next=saved.filter(x=>x.id!==b.dataset.delete);if(storage.set('commonnote-scores-v1',next)){saved=next;renderSaved();if(savedId===b.dataset.delete)savedId=null}else toast('Deletion could not be saved.')}if(b.dataset.token)insertToken(b.dataset.token)});
$('abc').addEventListener('beforeinput',()=>noteTyping('abc'));$('abc').addEventListener('input',()=>{syncFields();changed()});for(const [id,header] of [['title','T'],['composer','C'],['meter','M'],['key','K'],['bpm','Q']])$(id).addEventListener('input',()=>{noteTyping(id);setHeader(header,id==='bpm'?'1/4='+$(id).value:$(id).value);$('bpm-value').textContent=$('bpm').value;changed()});$('instrument').onchange=changed;$('volume').oninput=()=>{if(playing){stop();toast('Volume updated. Press Play to resume.')}};
$('help-toggle').onclick=()=>{$('abc-help').hidden=!$('abc-help').hidden};$('save').onclick=()=>{const id=savedId||globalThis.crypto?.randomUUID?.()||'score-'+Date.now();const entry={...current,id,title:field('T','Untitled'),composer:field('C'),abc:$('abc').value,instrument:$('instrument').value,updated:Date.now()};const next=saved.filter(x=>x.id!==id).concat(entry);if(storage.set('commonnote-scores-v1',next)){saved=next;savedId=id;dirty=false;markClean();$('save-status').textContent='Saved on this device. Export ABC for a lasting backup.';toast('Score saved');render()}else{$('save-status').textContent='This browser could not save. Export an ABC file to keep your score.'}};
$('import').onclick=()=>$('import-file').click();$('import-file').onchange=async()=>{const file=$('import-file').files[0];if(!file)return;if(file.size>1024*1024){toast('Please use an ABC file smaller than 1 MB.');return}try{const source=await file.text();if(ABCJS.numberOfTunes(source)!==1)throw new Error('Please import one ABC tune at a time.');if(!/^K:/m.test(source)||!/^X:/m.test(source))throw new Error('Expected an ABC score with X: and K: headers.');if(!allowReplace())return;dirty=false;const notice=source.match(/^% FretFree-Rights: (.*)$/m);let metadata={};if(notice){try{metadata=JSON.parse(notice[1]);if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))metadata={}}catch{}}openScore({...metadata,kind:'personal',abc:source});dirty=true;$('save-status').textContent='Imported locally. Save or export to keep a copy.'}catch(e){toast(e.message)}finally{$('import-file').value=''}};
$('play').onclick=()=>play();for(const id of ['start-measure','end-measure'])$(id).onchange=()=>{const {from,to}=measureRange();setRange(from,to)};
// Practice toggles are per-browser conveniences.
// Speed trainer starts 20 points below its goal so there is room to climb; the goal's 45% minimum keeps that within the slider.
const trainerGoal=()=>Math.max(45,Math.min(200,+$('trainer-goal').value||100));
function prepareTrainer(){if($('trainer').checked&&+$('speed').value>=trainerGoal()){$('speed').value=trainerGoal()-20;$('speed').oninput()}}
for(const id of ['loop','metronome','count-in','trainer']){$(id).checked=!!storage.get('fretfree-practice-'+id,false);$(id).addEventListener('change',()=>{storage.set('fretfree-practice-'+id,$(id).checked);if(id==='trainer')prepareTrainer()})}
$('trainer-goal').addEventListener('change',()=>{$('trainer-goal').value=trainerGoal();prepareTrainer()});;$('speed').oninput=()=>{const position=playing?playOrigin+Math.max(0,audio.currentTime-playClock)*playSpeed:null;$('speed-value').textContent=$('speed').value+'%';if(position!=null){stop();play(position)}};$('speed-reset').onclick=()=>{$('speed').value=100;$('speed').oninput()};$('stop').onclick=stop;$('print').onclick=()=>{render();const appendix=$('print-appendix');appendix.innerHTML=scoreLicense(current).startsWith('GPL-')?'<h2>Editable source and GPL license</h2><pre>'+esc(exportCredit(current)+'\n\nCorresponding editable ABC (FretFree export, 2026-10-03):\n'+$('abc').value+'\n\n'+GPL_LICENSE)+'</pre>':'';window.print()};$('export-abc').onclick=()=>download(creditedABC($('abc').value,current),safeName()+'.abc','text/plain');$('export-midi').onclick=()=>{try{download(creditedMidi(midiBytes($('abc').value),$('abc').value,current),safeName()+'.mid','audio/midi')}catch(e){toast(e.message)}};$('export-svg').onclick=()=>{try{clearTimeout(renderTimer);render();download(creditedSVG($('notation'),$('abc').value,current),safeName()+'.svg','image/svg+xml')}catch(e){toast(e.message)}};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()});
const initialView=location.hash.slice(1);
for(const name of [...new Set(catalog.map(scoreCollection))].sort())$('collection-filter').add(new Option(name,name));for(const name of [...new Set(catalog.map(scoreLicense))].sort())$('license-filter').add(new Option(name,name));
for(const genre of [...new Set(catalog.map(x=>x.genre||'Teaching melodies'))].sort())$('genre-filter').add(new Option(genre,genre));$('hero-count').textContent='01 / '+catalog.length;
ABCJS.renderAbc('hero-notation',catalog[0].abc,{staffwidth:460,responsive:'resize',scale:.9,paddingtop:25,paddingbottom:30});renderCards();newScore();show(['studio','saved','about'].includes(initialView)?initialView:'library');
// Keyboard note entry on the score (MuseScore-style): A–G add a note after the selection in the nearest octave,
// R or 0 a rest, 3–7 set the length (16th…whole), . dots, ↑↓ move by step (Ctrl: octave), ←→ change the selection,
// # - = set sharp/flat/natural, + ties, | adds a bar line, Delete removes the note.
const LENGTH_KEYS={'3':1/16,'4':1/8,'5':1/4,'6':1/2,'7':1};
function focusScore(){$('notation').focus?.({preventScroll:true})}
// Notes and rests of the source in reading order, one entry each.
function scoreNotes(){return [...new Set(noteSources.values())].filter(e=>e?.element.el_type==='note').sort((a,b)=>a.element.startChar-b.element.startChar)}
function displayOf(entry){for(const [key,e] of noteSources)if(e===entry)return shownElements.get(key);return null}
function selectedNote(){const entry=selectedRange&&scoreNotes().find(e=>e.element.startChar===selectedRange[0]);return entry?{entry,display:displayOf(entry)}:null}
function selectEntry(entry){const display=displayOf(entry);if(!display)return;scoreClick(display,0,[],{},null);renderedTune?.engraver?.rangeHighlight?.(display.startChar,display.endChar)}
// Insert a token at a source position with spacing, then select it.
function insertAt(at,token,select=true){
 const v=$('abc').value,before=at>0&&!/\s/.test(v[at-1])?' ':'',after=v[at]&&!/\s/.test(v[at])?' ':'';
 applyNoteEdit(at,at,before+token+after,select?[at+before.length,at+before.length+token.length]:null);
}
// Where a new note goes with nothing selected: before the closing bar line, or at the end of the music.
function tuneEndPosition(){
 const all=[...new Set(noteSources.values())].filter(Boolean).sort((a,b)=>a.element.startChar-b.element.startChar),last=all.at(-1);
 if(!last)return $('abc').value.length;
 return last.element.el_type==='bar'&&/thick|dbl/.test(last.element.type||'')?last.element.startChar:last.element.endChar;
}
function insertNote(letter,sel){
 if(sel&&!sel.entry.element.pitches?.length&&sel.entry.element.rest?.type!=='multimeasure'){overwriteRest(letter,sel.entry);return}
 const at=sel?sel.entry.element.endChar:tuneEndPosition(),length=inputLength??beatLength();
 let token='z';
 if(letter!=='z'){
  // Letters name what the student sees, so pick the octave in written pitch, nearest the previous note.
  token=letterToken(letter,at);
 }
 insertAt(at,token+lengthText(length/unitLengthAt(at)));
}
// Written-pitch note token for a letter, in the octave nearest the last note before a source position.
function letterToken(letter,at){
 if(letter==='z')return 'z';
 const steps=Math.round(instruments[$('instrument').value].shift*7/12),prev=scoreNotes().filter(n=>n.element.startChar<at&&n.element.pitches?.length).pop();
 const ref=prev?prev.element.pitches[0].pitch+steps:6+(staffClefs[0]?.[0]||0),letterIndex='CDEFGAB'.indexOf(letter);
 return pitchToken(letterIndex+7*Math.round((ref-letterIndex)/7)-steps);
}
// Typing on a rest writes over it (as in MuseScore): the note takes its length from the rest and the rest keeps
// what is left, which stays selected so the next letter continues. A filled rest passes the selection on.
function overwriteRest(letter,rest){
 const v=$('abc').value,start=rest.element.startChar,end=rest.element.endChar,old=v.slice(start,end),unit=unitLengthAt(start);
 const restLength=rest.element.duration||0,length=Math.min(inputLength??beatLength(),restLength||Infinity),left=restLength-length;
 const token=letterToken(letter,start)+lengthText(length/unit),trail=old.match(/\s*$/)[0],lead=old.match(/^\s*/)[0]||(start>0&&!/\s/.test(v[start-1])?' ':'');
 if(left>1e-6){const remainder='z'+lengthText(left/unit),text=lead+token+' '+remainder+trail,at=start+lead.length+token.length+1;applyNoteEdit(start,end,text,[at,at+remainder.length]);return}
 const text=lead+token+trail,delta=text.length-(end-start),next=scoreNotes().find(n=>n.element.startChar>=end);
 applyNoteEdit(start,end,text,next?[next.element.startChar+delta,next.element.endChar+delta]:[start+lead.length,start+lead.length+token.length]);
}
function scoreKey(e){
 if(e.metaKey||e.altKey||(e.ctrlKey&&!/^Arrow(Up|Down)$/.test(e.key))||!$('note-menu').hidden)return false;
 if(renderedSource!==$('abc').value){clearTimeout(renderTimer);render()}
 const key=e.key,sel=selectedNote(),notes=scoreNotes();
 if(/^[a-g]$/i.test(key)){insertNote(key.toUpperCase(),sel);return true}
 if(key==='r'||key==='R'||key==='0'){insertNote('z',sel);return true}
 if(LENGTH_KEYS[key]){inputLength=LENGTH_KEYS[key];if(sel&&sel.entry.element.pitches?.length)editNote(sel.entry,sel.display,'len:'+inputLength);else $('selection-status').textContent='New notes will be '+(NOTE_VALUES[inputLength]||'that length').replace(/^an? /,'')+'s.';return true}
 if(key==='|'){if(sel)editNote(sel.entry,sel.display,'bar-after');else insertAt(tuneEndPosition(),'|',false);return true}
 if(key==='ArrowLeft'||key==='ArrowRight'){
  if(!notes.length)return true;
  const i=sel?notes.indexOf(sel.entry):key==='ArrowLeft'?notes.length:-1,next=notes[Math.max(0,Math.min(notes.length-1,i+(key==='ArrowLeft'?-1:1)))];
  selectEntry(next);return true;
 }
 if(key==='Escape'&&sel){selectedRange=null;renderedTune?.engraver?.rangeHighlight?.(-1,-1);$('selection-status').textContent='Nothing selected. Letters add notes at the end.';return true}
 if(!sel)return false;
 const isNote=!!sel.entry.element.pitches?.length,start=sel.entry.element.startChar,end=sel.entry.element.endChar;
 if(key==='.'){editNote(sel.entry,sel.display,'dot');return true}
 if(key==='Delete'||key==='Backspace'){editNote(sel.entry,sel.display,'delete');return true}
 if(!isNote)return false;
 if(key==='ArrowUp'||key==='ArrowDown'){const v=$('abc').value;applyNoteEdit(start,end,moveNoteText(v.slice(start,end),(key==='ArrowUp'?1:-1)*(e.ctrlKey?7:1)));return true}
 const accidental={'#':'^','-':'_','=':'='}[key];if(accidental){editNote(sel.entry,sel.display,'acc:'+accidental);return true}
 if(key==='+'){editNote(sel.entry,sel.display,'tie');return true}
 return false;
}
$('notation').addEventListener('keydown',e=>{if(scoreKey(e)){e.preventDefault();e.stopPropagation()}},true);
// Writing prompts: a short assignment with a blank score (one whole-bar rest per bar) and goals that tick off live.
function promptById(id){return (typeof writingPrompts==='undefined'?[]:writingPrompts).find(p=>p.id===id)}
function renderPromptCards(){
 $('prompt-cards').innerHTML=writingPrompts.map(p=>`<article class="prompt-card"><span class="tag">${esc(p.level.toUpperCase())} · ${esc(p.meter)} · ${esc(p.key.replace('m',' minor').replace(/^([A-G])$/,'$1 major'))}</span><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p><button class="primary" data-prompt="${esc(p.id)}">Start writing</button></article>`).join('');
}
function togglePrompts(open){$('prompt-picker').hidden=!open;$('open-prompts').setAttribute('aria-expanded',open);if(open){renderPromptCards();$('prompt-picker').scrollIntoView({block:'nearest',behavior:'smooth'})}}
function startPrompt(prompt){
 // The prompt's key is written pitch; the source keeps concert pitch, so transpose the key for transposing instruments.
 const shift=instruments[$('instrument').value].shift%12?instruments[$('instrument').value].shift:0;
 let key=prompt.key;
 if(shift){const mini=`X:1\nK:${key}\n`;key=(ABCJS.strTranspose(mini,ABCJS.parseOnly(mini),-shift).match(/^K:\s*(\S+)/m)||[,key])[1]}
 const abc=promptSource(prompt,key);
 if(!allowReplace())return;dirty=false;
 openScore({title:prompt.title,composer:'',kind:'personal',abc,instrument:$('instrument').value,prompt:prompt.id});
 togglePrompts(false);
 const first=scoreNotes()[0];if(first)selectEntry(first);
 $('selection-status').textContent='The first rest is selected. Type note letters (A–G) to write over it; 3–7 change the length.';
}
function updatePromptCheck(shown){
 const box=$('prompt-check'),prompt=current?.prompt&&promptById(current.prompt);if(!box)return;
 if(!prompt){box.hidden=true;box.innerHTML='';return}
 const goals=checkPrompt(prompt,melodyBars(shown)),done=goals.every(g=>g.ok);
 box.hidden=false;box.classList.toggle('done',done);
 box.innerHTML=`<div class="prompt-check-head"><strong>Writing prompt · ${esc(prompt.title)}</strong><span class="small">${goals.filter(g=>g.ok).length} of ${goals.length} goals</span></div><p>${esc(prompt.text)}</p><ul>${goals.map(g=>`<li class="${g.ok?'met':''}"><span aria-hidden="true">${g.ok?'✓':'○'}</span> ${esc(g.label)}<span class="sr-only">${g.ok?' (done)':' (not yet)'}</span></li>`).join('')}</ul>${done?'<p class="prompt-done">All goals met. Play it back, then save it or export it to hand in.</p>':''}`;
}
$('open-prompts').onclick=()=>togglePrompts($('prompt-picker').hidden);$('close-prompts').onclick=()=>togglePrompts(false);
$('prompt-cards').addEventListener('click',e=>{const b=e.target.closest('[data-prompt]');if(b)startPrompt(promptById(b.dataset.prompt))});
// Bar check fixes.
$('bar-check').addEventListener('click',e=>{
 const b=e.target.closest('[data-bar-fix]'),m=barIssues[+b?.dataset.bar];if(!m)return;
 if(renderedSource!==$('abc').value){clearTimeout(renderTimer);render();toast('Score updated. Check the bars again.');return}
 const area=$('abc'),v=area.value,start=m.notes[0].element.startChar,end=(m.bar||m.notes.at(-1).element).endChar;
 if(b.dataset.barFix==='show'){
  area.focus({preventScroll:true});area.setSelectionRange(start,end);
  const rect=$('notation').querySelector(`.bar-flag[data-measure="${m.measure}"]`);rect?.scrollIntoView({block:'center',behavior:'smooth'});
  $('selection-status').textContent=`Measure ${m.measure} selected in the ABC text.`;return;
 }
 if(b.dataset.barFix==='rest'){
  // The rest goes just before the closing bar line, or at the end of an unbarred last measure.
  const at=m.bar?m.bar.startChar:m.notes.at(-1).element.endChar,rest='z'+lengthText((m.expected-m.length)/unitLengthAt(at));
  const text=(/\s/.test(v[at-1]||' ')?'':' ')+rest+(m.bar?' ':'');
  applyNoteEdit(at,at,text,[at+text.indexOf(rest),at+text.indexOf(rest)+rest.length]);return;
 }
 const cut=barSplit(m);if(!cut)return;
 const at=cut.element.endChar,text=(/\s/.test(v[at-1])?'':' ')+'| ';
 applyNoteEdit(at,at,text,null);
});
// Undo/redo buttons and shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y). In the ABC box they replace the browser's
// own undo, which doesn't know about edits made on the score.
$('undo').onclick=()=>stepHistory(-1);$('redo').onclick=()=>stepHistory(1);
document.addEventListener('keydown',e=>{
 if(!(e.ctrlKey||e.metaKey)||e.altKey||$('studio').hidden)return;
 const key=e.key.toLowerCase(),field=e.target.closest?.('input,select,textarea');
 if(field&&field.id!=='abc')return;
 if(key==='z'&&!e.shiftKey){e.preventDefault();stepHistory(-1)}
 else if(key==='z'&&e.shiftKey||key==='y'){e.preventDefault();stepHistory(1)}
});
// A remembered speed trainer needs the same below-goal start as a freshly ticked one.
prepareTrainer();
