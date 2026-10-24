import json, time, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor
missing = json.load(open('probe/missing.json'))
t0 = time.time()
def one(m):
    name = m['name'].split('(')[0].split('/')[0].strip()
    q = urllib.parse.urlencode({'name': name, 'count': 5, 'countryCode': m['country'], 'language': 'en', 'format': 'json'})
    for attempt in range(2):
        try:
            req = urllib.request.Request('https://geocoding-api.open-meteo.com/v1/search?' + q, headers={'User-Agent': 'baltic-ports-build/1.0'})
            with urllib.request.urlopen(req, timeout=8) as r:
                d = json.load(r)
            return {**m, 'results': [{'name': x.get('name'), 'lat': x.get('latitude'), 'lon': x.get('longitude'), 'fc': x.get('feature_code'), 'pop': x.get('population')} for x in d.get('results', [])]}
        except Exception as e:
            err = str(e)
    return {**m, 'results': [{'error': err}]}
first = one(missing[0]); print('first', round(time.time() - t0, 2), first['results'][:1], flush=True)
with ThreadPoolExecutor(6) as ex:
    out = list(ex.map(one, missing))
json.dump(out, open('probe-out.json', 'w'), ensure_ascii=False)
print(len(out), sum(1 for o in out if o['results'] and 'lat' in o['results'][0]), 'errors', sum(1 for o in out if o['results'] and 'error' in o['results'][0]), round(time.time() - t0, 1), 's')
