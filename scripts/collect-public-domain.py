"""Refresh Mutopia listing evidence; admit only explicit PD editions of old compositions."""
import concurrent.futures, urllib.request, re, html, json, pathlib, time
ROOT=pathlib.Path(__file__).resolve().parents[1]
CACHE=ROOT/'provenance'/'listings'; CACHE.mkdir(exist_ok=True)
def fetch(url):
 for attempt in range(3):
  try:
   with urllib.request.urlopen(url,timeout=45) as r: return r.read()
  except Exception:
   if attempt==2: raise
   time.sleep(1)
def listing(i):
 path=CACHE/f'all-{i}.html'
 if not path.exists():path.write_bytes(fetch(f'https://www.mutopiaproject.org/cgibin/make-table.cgi?startat={i}'))
 return path.read_text()
def clean(s):return html.unescape(re.sub('<[^>]+>','',s)).strip()
entries=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
 for i,s in zip(range(0,2300,10),pool.map(listing,range(0,2300,10))):
  for block in re.findall(r'<table class="table-bordered result-table">(.*?)</table>',s,re.S):
   cells=[clean(x) for x in re.findall(r'<td>(.*?)</td>',block,re.S)]
   if len(cells)<12 or cells[9]!='Public Domain':continue
   composer=cells[1].removeprefix('by '); years=re.search(r'\((\d{4})[–-](\d{4})\)',composer)
   if not (years and int(years[2])<=1925):continue
   ident=re.search(r'piece-info.cgi\?id=(\d+)',block)
   mids=re.findall(r'href="(https:[^"]+\.mid)"',block);pdfs=re.findall(r'href="(https:[^"]+-let\.pdf)"',block)
   if not ident or not mids or not pdfs:continue
   entries.append(dict(id='mutopia-'+ident[1],title=cells[0],composer=composer,opus=cells[2],originalInstrument=cells[4].removeprefix('for '),date=cells[5],style=cells[6],edition=cells[8],source='https://www.mutopiaproject.org/cgibin/piece-info.cgi?id='+ident[1],midURL=mids[0],pdfURL=pdfs[0],licenseURL='https://www.mutopiaproject.org/legal.html#publicdomain',declaredLicense='Public Domain',composerCode=mids[0].split('/ftp/')[1].split('/')[0],evidenceFile=f'listings/all-{i}.html',evidenceHTML=block,reviewedAt='2026-10-03'))
  if i%200==0:print('listing',i,'PD candidates',len(entries),flush=True)
(ROOT/'scripts'/'candidates.json').write_text(json.dumps(entries,ensure_ascii=False))
print('CANDIDATES',len(entries),flush=True)
