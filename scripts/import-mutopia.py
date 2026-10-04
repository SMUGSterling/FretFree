import pathlib,json,re,html,hashlib,concurrent.futures,urllib.request,time
ROOT=pathlib.Path(__file__).resolve().parents[1]
ns={'__file__':str(ROOT/'scripts/expand-library.py')}
exec((ROOT/'scripts/expand-library.py').read_text().split('def build(row):')[0],ns)
abc_study=ns['abc_study']
rows=json.load(open(ROOT/'scripts/free-edition-candidates.json'))
def fetch(url,path):
 if path.exists():return path.read_bytes()
 for attempt in range(2):
  try:
   with urllib.request.urlopen(url,timeout=22) as r:b=r.read()
   path.write_bytes(b);return b
  except Exception:
   if attempt:raise

def build(r):
 try:
  folder=ROOT/'scores'/r['id'];folder.mkdir(exist_ok=True)
  mid=fetch(r['midURL'],folder/'original.mid');pdf=fetch(r['pdfURL'],folder/'score.pdf');ly=fetch(r['lyURL'],folder/'original.ly')
  if not pdf.startswith(b'%PDF'):raise ValueError('not PDF')
  lytext=ly.decode('utf8','replace')
  credit=re.search(r'mutopiacopyright\s*=\s*"([^"]+)"',lytext)
  maint=re.search(r'maintainer\s*=\s*"([^"]+)"',lytext)
  r['attribution']='; '.join(x for x in [r['composer'],r['credits'],maint[1] if maint else '',credit[1] if credit else ''] if x)
  # No guessing contributor for a licensed edition when the source header is missing.
  if r['notationLicense']!='Public Domain' and not (maint or credit):raise ValueError('No contributor credit in LilyPond header')
  abc,track,bars,count,first,low,high=abc_study(mid,r['title'],r['composer'])
  evidence=r.pop('evidenceHTML');(ROOT/'provenance'/f"{r['id']}.html").write_text(evidence)
  r.update(abc=abc,sourceTrack=track,bars=bars,studyNotes=count,pitchMin=low,pitchMax=high,firstNotePitch=first,collection='Mutopia',compositionStatus='Historical composition; see source edition',studyTransform='FretFree: upper MIDI track, highest simultaneous note, first 32 bars, sixteenth-note quantization; accompaniment and markings omitted.',pdf=f"scores/{r['id']}/score.pdf",originalMidi=f"scores/{r['id']}/original.mid",originalSource=f"scores/{r['id']}/original.ly",kind='historic',genre='Ragtime' if r['style']=='Jazz' else r['style'] or 'Classical',level='Advanced' if count/bars>6 or high-low>24 else 'Intermediate',skill=r['style'] or 'Melody practice',sourceLabel='Mutopia Project · original edition and license',rights=f"Edition license: {r['notationLicense']}. Credit: {r['attribution']}. Source: {r['edition']}. PDF, MIDI, and LilyPond files unchanged. FretFree extracted upper-part study, up to 32 bars; accompaniment omitted. "+('If sharing adaptations, retain this exact attribution/share-alike license.' if '-SA-' in r['notationLicense'] else 'Retain attribution and the license when sharing.' if r['notationLicense'].startswith('CC-') else 'Edition declared Public Domain by its contributor.'),description=f"{r['style']} for {r['originalInstrument']}. Complete PDF and editable upper-part study.",pdfSHA256=hashlib.sha256(pdf).hexdigest(),midiSHA256=hashlib.sha256(mid).hexdigest(),sourceSHA256=hashlib.sha256(ly).hexdigest(),reviewedAt='2026-10-03',aliases='')
  return r
 except Exception as e:return dict(id=r['id'],error=str(e))
out=[];errors=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
 for i,r in enumerate(pool.map(build,rows)):
  (errors if 'error' in r else out).append(r)
  if i%50==0:print('Mutopia',i,'ready',len(out),'excluded',len(errors),flush=True)
  if i%50==0:pathlib.Path('mutopia-ready.json').write_text(json.dumps(out,ensure_ascii=False))
pathlib.Path('mutopia-ready.json').write_text(json.dumps(out,ensure_ascii=False));pathlib.Path('mutopia-errors.json').write_text(json.dumps(errors,indent=2));print('DONE',len(out),len(errors),flush=True)
