"""Build locally bundled PD PDFs/MIDI and explicitly labeled upper-part practice studies.
Run collect-public-domain.py first. No network is used by the finished application.
"""
import pathlib,json,re,hashlib,concurrent.futures,urllib.request,time,statistics,struct
ROOT=pathlib.Path(__file__).resolve().parents[1]
existing=set(re.findall(r'"id":"(mutopia-\d+)"',(ROOT/'catalog-expanded.js').read_text().split('// Additional verified')[0]))
known_missing={'mutopia-1829','mutopia-1830'}
rows=[r for r in json.loads((ROOT/'scripts/candidates.json').read_text()) if r['id'] not in existing and r['id'] not in known_missing]
def fetch(url):
 for attempt in range(3):
  try:
   with urllib.request.urlopen(url,timeout=45) as r:return r.read()
  except Exception:
   if attempt==2:raise
   time.sleep(1)
def midi_tracks(b):
 if b[:4]!=b'MThd':raise ValueError('Not MIDI')
 division=int.from_bytes(b[12:14],'big');pos=8+int.from_bytes(b[4:8],'big');tracks=[];meter=(4,4);tempo=500000
 if division&32768:raise ValueError('SMPTE')
 while pos+8<=len(b):
  size=int.from_bytes(b[pos+4:pos+8],'big');tag=b[pos:pos+4];pos+=8;end=pos+size
  if tag!=b'MTrk':pos=end;continue
  tick=0;running=0;active={};notes=[];name=''
  def vlq():
   nonlocal pos
   v=0
   while True:
    c=b[pos];pos+=1;v=(v<<7)|(c&127)
    if not c&128:return v
  while pos<end:
   tick+=vlq();status=b[pos];pos+=1
   if status<128:pos-=1;status=running
   elif status<240:running=status
   if status==255:
    kind=b[pos];pos+=1;n=vlq();data=b[pos:pos+n];pos+=n
    if kind==3:name=data.decode('utf8','replace')
    if kind==88 and tick==0:meter=(data[0],2**data[1])
    if kind==81 and tick==0:tempo=int.from_bytes(data,'big')
    continue
   if status in (240,247):n=vlq();pos+=n;continue
   cmd=status&240;ch=status&15;a=b[pos];pos+=1;v=0
   if cmd not in (192,208):v=b[pos];pos+=1
   if ch==9:continue
   if cmd==144 and v>0:active[(ch,a)]=(tick,v)
   elif cmd==128 or (cmd==144 and v==0):
    if (ch,a) in active:
     start,vel=active.pop((ch,a));notes.append((start,tick,a))
  if notes:tracks.append((name,notes))
  pos=end
 if not tracks:raise ValueError('No notes')
 # Upper part, with enough notes to form a useful study; never combine accompaniment tracks.
 name,notes=max(tracks,key=lambda x:statistics.mean(n[2] for n in x[1]) if len(x[1])>=8 else -1)
 return division,meter,tempo,name,notes
def abc_study(b,title,composer):
 division,(num,den),tempo,name,notes=midi_tracks(b)
 bar=round(num*16/den)
 if bar<1 or bar>64:raise ValueError('Unusual meter')
 limit=bar*32;unit=division/4;onsets={}
 for st,en,p in notes:
  st=round(st/unit);en=max(st+1,round(en/unit))
  if st>=limit:continue
  if st not in onsets or p>onsets[st][1]:onsets[st]=(min(limit,en),p)
 seq=sorted(onsets.items())
 if not seq:raise ValueError('Empty study')
 final=min(limit,max(x[1][0] for x in seq));final=((final+bar-1)//bar)*bar
 tokens=[];cursor=0;count=0;first=None;pitches=[]
 def pitch(p):
  names=['=C','^C','=D','^D','=E','=F','^F','=G','^G','=A','^A','=B'];s=names[p%12];octave=p//12-5
  if octave>=1:s=s[0]+s[1].lower()+"'"*(octave-1)
  else:s+=','*(-octave)
  return s
 def emit(token,duration,isnote):
  nonlocal cursor
  while duration>0:
   available=min(duration,bar-cursor%bar);chunk=max(n for n in (1,2,3,4,6,7,8,12,14,15,16,24,28,30,32,48,56,60,64) if n<=available);duration-=chunk
   tokens.append(token+(str(chunk) if chunk!=1 else '')+('-' if isnote and duration else ''));cursor+=chunk
   if cursor%bar==0:tokens.append('|');
   if cursor%(bar*4)==0:tokens.append('\n')
 for i,(start,(end,p)) in enumerate(seq):
  if start>cursor:emit('z',start-cursor,False)
  end=min(end,seq[i+1][0] if i+1<len(seq) else final)
  if end<=cursor:continue
  if first is None:first=p
  pitches.append(p);count+=1;emit(pitch(p),end-cursor,True)
 if cursor<final:emit('z',final-cursor,False)
 body=' '.join(tokens).strip();body=re.sub(r'\|\s*$','|]',body)
 source=f'X:1\nT:{title} · upper-part study\nC:{composer}\nM:{num}/{den}\nL:1/16\nQ:1/4={round(60000000/tempo)}\nK:C\n'+body
 return source,name,final//bar,count,first,min(pitches),max(pitches)
def build(row):
 try:
  folder=ROOT/'scores'/row['id'];folder.mkdir(exist_ok=True)
  files=[]
  for key,file in [('midURL','original.mid'),('pdfURL','score.pdf')]:
   p=folder/file
   if not p.exists():p.write_bytes(fetch(row[key]))
   files.append(p.read_bytes())
  mid,pdf=files
  if not pdf.startswith(b'%PDF'):raise ValueError('Not PDF')
  abc,track,bars,count,first,low,high=abc_study(mid,row['title'],row['composer'])
  evidence=row.pop('evidenceHTML');(ROOT/'provenance'/f"{row['id']}.html").write_text(evidence)
  row.update(abc=abc,sourceTrack=track,bars=bars,studyNotes=count,pitchMin=low,pitchMax=high,firstNotePitch=first,studyTransform='Upper MIDI track; highest note at simultaneous onsets; first 32 bars; durations quantized to sixteenth notes. Accompaniment and performance markings omitted.',pdf=f"scores/{row['id']}/score.pdf",originalMidi=f"scores/{row['id']}/original.mid",kind='historic',genre='Ragtime' if row['style']=='Jazz' else row['style'] or 'Classical',level='Advanced' if count/bars>6 or high-low>24 else 'Intermediate',skill=row['style'] or 'Melody practice',sourceLabel='Mutopia Project · edition and public-domain declaration',rights=f"The composition and this Mutopia edition are supplied as Public Domain. Edition source: {row['edition']}. The included PDF and original MIDI are unchanged. The editable notation is a {bars}-bar upper-part study (maximum 32 bars) derived from the MIDI, not the complete score.",description=f"{row['style']} music for {row['originalInstrument']}. Complete source PDF plus an editable upper-part practice study.",pdfSHA256=hashlib.sha256(pdf).hexdigest(),midiSHA256=hashlib.sha256(mid).hexdigest(),notationLicense='Public Domain',aliases='')
  (ROOT/'provenance'/f"{row['id']}.json").write_text(json.dumps({k:v for k,v in row.items() if k!='abc'},ensure_ascii=False,indent=2))
  return row
 except Exception as e:return {'error':str(e),'id':row['id']}
out=[];errors=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=30) as pool:
 for i,r in enumerate(pool.map(build,rows)):
  (errors if 'error' in r else out).append(r)
  if i%25==0:print('processed',i,'added',len(out),'errors',len(errors),flush=True)
(ROOT/'scripts/new-entries.json').write_text(json.dumps(out,ensure_ascii=False))
(ROOT/'scripts/expansion-errors.json').write_text(json.dumps(errors,indent=2))
print('DONE',len(out),'errors',errors,flush=True)
