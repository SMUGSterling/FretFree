import pathlib,re,json,hashlib,shutil,html
ROOT=pathlib.Path(__file__).resolve().parents[1];(ROOT/'licenses').mkdir(exist_ok=True)
shutil.copyfile('downloads/oneill-copyright',ROOT/'licenses/oneill-copyright.html')
shutil.copyfile('downloads/hymnal-http-copying',ROOT/'licenses/openhymnal-copying.html')
shutil.copyfile('downloads/oneill-master/1850/editorial/Initials.html',ROOT/'licenses/oneill-contributors.html')
credits=dict(re.findall(r'<dt>(\w+)\s*<dd>([^\n<]+)',pathlib.Path('downloads/oneill-master/1850/editorial/Initials.html').read_text()))
def text(b):
 try:return b.decode('utf8')
 except UnicodeDecodeError:return b.decode('latin1')
def header(s,k,default=''):
 return next(iter(re.findall('^'+k+':\s*(.*)$',s,re.M)),default).strip()
def write(r,b):
 folder=ROOT/'scores'/r['id'];folder.mkdir(exist_ok=True);(folder/'original.abc').write_bytes(b)
 r.update(originalSource=f"scores/{r['id']}/original.abc",sourceSHA256=hashlib.sha256(b).hexdigest(),reviewedAt='2026-10-03',kind='historic',level='Intermediate',skill='Melody practice')
 return r
rows=[];excluded=[]
for p in sorted(pathlib.Path('downloads/oneill-master/1850/abc').glob('*.abc')):
 b=p.read_bytes();s=text(b);id='oneill-1850-'+p.stem.split('_')[0];credit=credits.get(p.stem.split('_')[-1],p.stem.split('_')[-1]);title=header(s,'T',p.stem)
 r=dict(id=id,title=title,composer=header(s,'C','Traditional Irish · collected by Francis O’Neill'),abc=s,collection='O’Neill’s Music of Ireland (1903)',notationLicense='GPL-2.0-or-later',declaredLicense='GNU GPL version 2 or any later version',licenseURL='https://www.gnu.org/licenses/old-licenses/gpl-2.0.html',localLicense='licenses/GPL-2.0.txt',compositionStatus='Public-domain historical tune; GPL transcription',attribution=f"O’Neill’s Project contributors, 1997–2000; transcriber: {credit}",source='https://trillian.mit.edu/~jc/music/book/ONeills/_1850/',sourceLabel='O’Neill’s Project · 1850-tune collection',sourceMirror='https://github.com/folkies/oneill/blob/master/1850/abc/'+p.name,genre=header(s,'R','Irish traditional').capitalize(),description='Irish traditional melody from the 1,850-tune collection. Credited GPL transcription.',studyTransform='Original ABC transcription; no musical reduction.',rights=f"Underlying historical tune is public domain. ABC transcription © 1997–2000 O’Neill’s Project contributors; transcriber: {credit}. Licensed GNU GPL v2 or later. Retain credits, include the license, mark changes, and provide corresponding editable source when redistributing derivatives.")
 rows.append(write(r,b))
for p in sorted(pathlib.Path('downloads/hymnal').glob('*.abc')):
 b=p.read_bytes();s=text(b);cs='\n'.join(re.findall(r'^C:.*$',s,re.M));declarations=[x for x in cs.splitlines() if 'copyright:' in x.lower()]
 # Require explicit declaration for the entire setting; exclude lyrics/setting restrictions and CPDL license.
 if not declarations or not all(re.search(r'copyright:\s*(?:words and music,\s*)?public domain\b',x,re.I) for x in declarations) or re.search(r'copyright\s+\d{4}|CPDL|may be freely|worship',cs,re.I):
  excluded.append(dict(file=p.name,reason='Not an unqualified public-domain declaration',declaration=cs));continue
 km=re.search(r'^K:([^\n]*)',s,re.M)
 if not km:excluded.append(dict(file=p.name,reason='Missing key'));continue
 body=s[km.end():];voices=re.findall(r'\[V:\s*([^\]]+)\]',body)
 if not voices:excluded.append(dict(file=p.name,reason='No identifiable upper voice'));continue
 upper=voices[0].strip();parts=[]
 for m in re.finditer(r'\[V:\s*([^\]]+)\]([^\[]*(?:\[(?!V:)[^\[]*)*)',body):
  if m[1].strip()==upper:
   lines=[line for line in m[2].splitlines() if not re.match(r'\s*(?:%|[wW]:)',line)]
   part='\n'.join(lines);part=re.sub(r'![^!]+!',lambda a:a[0] if a[0] in ('!fermata!','!trill!') else '',part);parts.append(part)
 music='\n'.join(parts).strip()
 title=header(s,'T',p.stem);composer='; '.join(x[2:].strip() for x in cs.splitlines() if not re.search(r'copyright',x,re.I))
 source=f"X:1\nT:{title} · upper melody\nC:{composer}\nM:{header(s,'M','4/4').split('%')[0].strip()}\nL:{header(s,'L','1/4').split('%')[0].strip()}\nQ:1/4=100\nK:{km[1].split('%')[0].strip()}\n{music}"
 id='openhymnal-'+p.stem.lower().replace('_','-')
 r=dict(id=id,title=title,composer=composer,abc=source,collection='Open Hymnal',notationLicense='Public Domain',declaredLicense='Public Domain',copyrightDeclaration='\n'.join(declarations),licenseURL='http://openhymnal.org/copying.html',compositionStatus='Public-domain words, music, and setting as declared per score',attribution='Open Hymnal Project · Brian J. Dumont; '+composer,source='http://openhymnal.org/Abc/'+p.name,sourceLabel='Open Hymnal · complete original ABC',genre='Hymn',description='Extracted upper melody. Complete original words and all voices are included as source ABC.',studyTransform=f'FretFree extracted voice {upper}; lyrics and accompaniment omitted; unsupported decorations removed; default tempo 100 if not specified.',rights='Public domain declared individually in original ABC. '+ ' '.join(declarations)+' FretFree upper-melody extraction; complete original ABC retained. Credit: Open Hymnal Project, Brian J. Dumont; '+composer)
 rows.append(write(r,b))
pathlib.Path('abc-ready.json').write_text(json.dumps(rows,ensure_ascii=False));(ROOT/'scripts/openhymnal-exclusions.json').write_text(json.dumps(excluded,ensure_ascii=False,indent=2));print('ABC candidates',len(rows),'hymnal copyright exclusions',len(excluded))
