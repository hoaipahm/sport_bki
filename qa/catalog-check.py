import json,re
from pathlib import Path
catalogs={lang:json.loads(Path(f'shared/i18n/{lang}.json').read_text(encoding='utf-8')) for lang in ['vi','en']}
def get(d,k):
 for part in k.split('.'):
  if not isinstance(d,dict) or part not in d:return None
  d=d[part]
 return d
missing=[]
for p in Path('frontend/src').rglob('*.tsx'):
 if 'admin' in p.parts or 'staff' in p.parts:continue
 for key in re.findall(r"\bt\('([^']+)'",p.read_text(encoding='utf-8-sig')):
  for lang,d in catalogs.items():
   if not isinstance(get(d,key),str):missing.append((str(p),lang,key))
print('Missing literal customer translation keys:',missing)
assert not missing
