import json, time, urllib.request, urllib.parse
missing = json.load(open('probe/missing.json'))
out = []
for m in missing:
    name = m['name'].split('(')[0].split('/')[0].strip()
    q = urllib.parse.urlencode({'name': name, 'count': 5, 'countryCode': m['country'], 'language': 'en', 'format': 'json'})
    try:
        with urllib.request.urlopen('https://geocoding-api.open-meteo.com/v1/search?' + q, timeout=20) as r:
            d = json.load(r)
        res = [{'name': x.get('name'), 'lat': x.get('latitude'), 'lon': x.get('longitude'), 'fc': x.get('feature_code'), 'pop': x.get('population')} for x in d.get('results', [])]
    except Exception as e:
        res = [{'error': str(e)}]
    out.append({**m, 'results': res})
    time.sleep(0.12)
json.dump(out, open('probe-out.json', 'w'), ensure_ascii=False)
print(len(out), sum(1 for o in out if o['results'] and 'lat' in o['results'][0]))
