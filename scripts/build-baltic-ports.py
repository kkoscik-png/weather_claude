#!/usr/bin/env python3
"""Build data/baltic-ports.json: searchable list of Baltic Sea ports for the port picker.

Sources
- UN/LOCODE code list (UNECE), entries with function 1 (sea port) in SE, FI, EE, LV, LT,
  PL, DE, DK, RU. Coordinates are given to the minute (about 1-2 km).
- Open-Meteo geocoding (GeoNames) for LOCODE ports that have no coordinates
  (data/sources/ports-geocoded.json, produced once by a GitHub Actions probe).
- A curated list of the main commercial and ferry ports with harbour coordinates
  (approximate, about 1 km), which also fixes ports whose town centre lies inland
  (Riga, Gdansk, Szczecin, Klaipeda, Kaliningrad ...).

Filters
- Only the Baltic Sea with the Kattegat, the Belts and the Sound; North Sea, Skagerrak,
  Wadden Sea and lake/river ports far from the sea are dropped.
- A port must lie at sea or within MAX_KM of the Baltic coastline (dist/assets/coast.json).

Usage: python3 scripts/build-baltic-ports.py <code-list.csv> [data/sources/ports-geocoded.json]
"""
import csv, json, math, sys, unicodedata
from pathlib import Path
from shapely.geometry import shape, Point
from shapely.ops import unary_union
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parent.parent
COUNTRIES = {'SE': 'Sweden', 'FI': 'Finland', 'EE': 'Estonia', 'LV': 'Latvia', 'LT': 'Lithuania', 'PL': 'Poland', 'DE': 'Germany', 'DK': 'Denmark', 'RU': 'Russia'}
MAX_KM = 5.0

# Main ports: (country, name, lat, lon, LOCODE or None, aliases). Harbour positions, ~1 km.
MAJOR = [
 ('LV','Ventspils',57.398,21.560,'LVVNT',[]),('LV','Riga',57.030,24.040,'LVRIX',['Rīga','Freeport of Riga']),('LV','Liepāja',56.525,20.995,'LVLPX',['Liepaja']),('LV','Skulte',57.317,24.405,None,[]),
 ('LT','Klaipėda',55.700,21.120,'LTKLJ',['Klaipeda','Memel']),('LT','Būtingė',56.060,21.060,None,['Butinge']),
 ('EE','Tallinn',59.445,24.770,'EETLL',['Reval']),('EE','Muuga',59.490,24.960,'EEMUG',[]),('EE','Paldiski',59.350,24.050,'EEPLA',[]),('EE','Pärnu',58.380,24.480,'EEPRN',['Parnu']),('EE','Sillamäe',59.420,27.730,'EESLM',['Sillamae']),('EE','Kunda',59.520,26.530,'EEKND',[]),('EE','Virtsu',58.575,23.510,None,[]),('EE','Kuivastu',58.575,23.390,None,[]),('EE','Heltermaa',58.865,23.050,None,[]),('EE','Rohuküla',58.900,23.430,None,['Rohukula']),
 ('FI','Helsinki',60.162,24.957,'FIHEL',['Helsingfors']),('FI','Vuosaari (Helsinki)',60.210,25.190,None,['Nordsjö']),('FI','Kotka',60.440,26.920,'FIKTK',['Mussalo']),('FI','Hamina',60.550,27.190,'FIHMN',['Fredrikshamn']),('FI','Sköldvik (Porvoo)',60.300,25.550,'FISKV',['Kilpilahti','Porvoo','Borgå']),('FI','Hanko',59.820,22.970,'FIHKO',['Hangö']),('FI','Turku',60.435,22.220,'FITKU',['Åbo','Abo']),('FI','Naantali',60.460,22.030,'FINLI',['Nådendal']),('FI','Rauma',61.130,21.460,'FIRAU',['Raumo']),('FI','Pori (Mäntyluoto)',61.590,21.470,'FIPOR',['Björneborg','Mantyluoto']),('FI','Vaasa',63.080,21.570,'FIVAA',['Vasa']),('FI','Kokkola',63.860,23.030,'FIKOK',['Karleby']),('FI','Oulu',65.010,25.400,'FIOUL',['Uleåborg']),('FI','Kemi (Ajos)',65.670,24.520,'FIKEM',[]),('FI','Tornio',65.780,24.180,'FITOR',['Torneå']),('FI','Mariehamn',60.090,19.930,'FIMHQ',['Maarianhamina']),('FI','Loviisa',60.430,26.270,'FILOV',['Lovisa']),('FI','Inkoo',60.040,24.000,'FIINK',['Ingå']),
 ('SE','Stockholm',59.320,18.100,'SESTO',[]),('SE','Nynäshamn (Norvik)',58.940,17.980,'SENYN',['Nynashamn','Norvik']),('SE','Kapellskär',59.720,19.070,'SEKPS',['Kapellskar']),('SE','Grisslehamn',60.100,18.820,None,[]),('SE','Södertälje',59.180,17.630,'SESOE',['Sodertalje']),('SE','Oxelösund',58.670,17.120,'SEOXE',['Oxelosund']),('SE','Norrköping',58.600,16.220,'SENRK',['Norrkoping']),('SE','Västervik',57.750,16.660,'SEVVK',['Vastervik']),('SE','Oskarshamn',57.260,16.480,'SEOSK',[]),('SE','Kalmar',56.660,16.370,'SEKLR',[]),('SE','Visby',57.640,18.290,'SEVBY',['Gotland']),('SE','Karlskrona',56.160,15.600,'SEKAA',[]),('SE','Karlshamn',56.170,14.860,'SEKAN',[]),('SE','Åhus',55.930,14.310,'SEAHU',['Ahus']),('SE','Ystad',55.420,13.830,'SEYST',[]),('SE','Trelleborg',55.370,13.150,'SETRG',[]),('SE','Malmö',55.620,12.990,'SEMMA',['Malmo','CMP Malmö']),('SE','Helsingborg',56.040,12.690,'SEHEL',['Hälsingborg']),('SE','Halmstad',56.660,12.860,'SEHAD',[]),('SE','Varberg',57.110,12.240,'SEVAG',[]),('SE','Göteborg',57.690,11.900,'SEGOT',['Gothenburg','Goteborg']),('SE','Gävle',60.680,17.200,'SEGVX',['Gavle']),('SE','Sundsvall',62.400,17.350,'SESDL',[]),('SE','Härnösand',62.630,17.950,'SEHND',['Harnosand']),('SE','Umeå (Holmsund)',63.700,20.350,'SEUME',['Umea','Holmsund']),('SE','Skellefteå',64.680,21.240,'SESFT',['Skelleftea','Skelleftehamn']),('SE','Luleå',65.580,22.180,'SELLA',['Lulea']),('SE','Piteå',65.270,21.520,'SEPIT',['Pitea']),('SE','Hudiksvall',61.730,17.120,'SEHUV',[]),
 ('DK','København',55.700,12.610,'DKCPH',['Copenhagen','Kobenhavn']),('DK','Aarhus',56.150,10.230,'DKAAR',['Århus']),('DK','Aalborg',57.050,9.930,'DKAAL',['Ålborg']),('DK','Frederikshavn',57.440,10.550,'DKFDH',[]),('DK','Grenaa',56.410,10.920,'DKGRE',['Grenå']),('DK','Fredericia',55.560,9.750,'DKFRC',[]),('DK','Kalundborg',55.680,11.080,'DKKAL',[]),('DK','Køge',55.450,12.200,'DKKOG',['Koge']),('DK','Rødby (Puttgarden ferry)',54.650,11.350,'DKROD',['Rodby']),('DK','Gedser',54.570,11.930,'DKGED',[]),('DK','Rønne',55.100,14.690,'DKRNN',['Ronne','Bornholm']),('DK','Helsingør',56.040,12.620,'DKHLS',['Elsinore','Helsingor']),('DK','Odense',55.410,10.380,'DKODE',[]),('DK','Nyborg',55.310,10.790,'DKNBG',[]),
 ('DE','Kiel',54.320,10.140,'DEKEL',[]),('DE','Lübeck-Travemünde',53.960,10.870,'DETRV',['Lubeck','Travemunde','Lübeck']),('DE','Rostock',54.150,12.100,'DERSK',['Warnemünde']),('DE','Wismar',53.900,11.460,'DEWIS',[]),('DE','Stralsund',54.320,13.100,'DESTL',[]),('DE','Sassnitz (Mukran)',54.480,13.610,'DESAS',['Mukran','Rügen']),('DE','Puttgarden',54.500,11.230,'DEPUT',['Fehmarn']),('DE','Flensburg',54.800,9.440,'DEFLF',[]),('DE','Greifswald',54.100,13.380,None,[]),
 ('PL','Gdynia',54.530,18.550,'PLGDY',[]),('PL','Gdańsk',54.395,18.690,'PLGDN',['Gdansk','Port Północny','Danzig']),('PL','Szczecin',53.430,14.570,'PLSZZ',['Stettin']),('PL','Świnoujście',53.910,14.260,'PLSWI',['Swinoujscie','Swinemünde']),('PL','Police',53.570,14.580,'PLPCE',[]),('PL','Kołobrzeg',54.180,15.560,'PLKOL',['Kolobrzeg']),('PL','Ustka',54.590,16.850,'PLUST',[]),('PL','Władysławowo',54.790,18.420,'PLWLA',['Wladyslawowo']),('PL','Elbląg',54.170,19.390,'PLELB',['Elblag']),('PL','Darłowo',54.430,16.380,'PLDAR',['Darlowo']),
 ('RU','Saint Petersburg',59.900,30.210,'RULED',['St Petersburg','Sankt-Peterburg']),('RU','Ust-Luga',59.670,28.400,'RUULU',[]),('RU','Primorsk',60.350,28.670,'RUPRI',[]),('RU','Vysotsk',60.620,28.570,'RUVYS',[]),('RU','Vyborg',60.710,28.730,'RUVYG',[]),('RU','Kaliningrad',54.690,20.430,'RUKGD',['Königsberg']),('RU','Baltiysk',54.650,19.890,'RUBLT',['Pillau']),
]

def plain(s):
    return ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c)).lower()

def coord(text):
    t = text.strip().split()
    if len(t) != 2: return None
    la, lo = t
    lat = (int(la[:2]) + int(la[2:4]) / 60) * (1 if la[-1] == 'N' else -1)
    lon = (int(lo[:3]) + int(lo[3:5]) / 60) * (1 if lo[-1] == 'E' else -1)
    return lat, lon

def in_baltic(c, lat, lon):
    if not (53.4 <= lat <= 66.2 and 9.0 <= lon <= 30.6): return False
    if c == 'DE' and not (lat > 54.2 and lon > 9.35 or lon > 10.3): return False          # North Sea / Elbe side
    if c == 'DK' and (lon < 8.7 or (lat > 57.5 and lon < 10.4)): return False             # West Jutland, Skagerrak
    if c == 'SE' and lat > 57.95 and lon < 12.0: return False                             # Skagerrak coast
    if c == 'RU' and lat > 61.0: return False                                             # White Sea / Karelia
    return True

def main():
    locode, geo = sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else ROOT / 'data/sources/ports-geocoded.json'
    coast = json.load(open(ROOT / 'dist/assets/coast.json'))
    land = unary_union([shape(f['geometry']) for f in coast['features']])
    boundary = land.boundary
    km = lambda lat, lon, p: (Point(lon * math.cos(math.radians(lat)), lat).distance(Point(p.x * math.cos(math.radians(lat)), p.y))) * 111.2
    def sea_km(lat, lon):
        pt = Point(lon, lat)
        if not land.contains(pt): return 0.0
        near = boundary.interpolate(boundary.project(pt))
        return km(lat, lon, near)

    out, seen = [], {}
    def add(entry):
        key = (entry['country'], plain(entry['name']))
        if key in seen: return
        for o in out:  # same port twice (LOCODE name variants)
            if o['country'] == entry['country'] and abs(o['lat'] - entry['lat']) < 0.012 and abs(o['lon'] - entry['lon']) < 0.02 and plain(o['name'])[:5] == plain(entry['name'])[:5]: return
        seen[key] = True; out.append(entry)

    for c, name, lat, lon, code, aliases in MAJOR:
        add({'id': code or (c + plain(name)[:3].upper()), 'name': name, 'country': c, 'lat': lat, 'lon': lon, 'major': True, 'aliases': aliases, 'source': 'curated'})
    major_codes = {m[4] for m in MAJOR if m[4]}

    rows = list(csv.DictReader(open(locode, encoding='utf-8')))
    geocoded = {g['code']: g for g in json.load(open(geo))} if Path(geo).exists() else {}
    skipped = {'far': 0, 'region': 0, 'nocoord': 0}
    for r in rows:
        c, code = r['Country'], r['Country'] + r['Location']
        if c not in COUNTRIES or r['Function'][:1] != '1' or r['Change'].strip() == 'X' or code in major_codes: continue
        name = r['Name'].split(' (')[0].strip() or r['NameWoDiacritics']
        pos, src = coord(r['Coordinates']), 'unlocode'
        if not pos:
            g = geocoded.get(code); res = [x for x in (g or {}).get('results', []) if 'lat' in x]
            want = plain(g['name'].split('(')[0].split('/')[0].strip())
            res = [x for x in res if in_baltic(c, x['lat'], x['lon']) and plain(x.get('name') or '') == want]  # exact name only
            if not res: skipped['nocoord'] += 1; continue
            best = min(res, key=lambda x: sea_km(x['lat'], x['lon']))
            pos, src = (best['lat'], best['lon']), 'geocoded'
        lat, lon = pos
        if not in_baltic(c, lat, lon): skipped['region'] += 1; continue
        if sea_km(lat, lon) > MAX_KM: skipped['far'] += 1; continue
        add({'id': code, 'name': name, 'country': c, 'lat': round(lat, 4), 'lon': round(lon, 4), 'major': False, 'aliases': [r['NameWoDiacritics']] if r['NameWoDiacritics'] != name else [], 'source': src})

    out.sort(key=lambda p: (not p['major'], p['country'], plain(p['name'])))
    meta = {'generated': 'scripts/build-baltic-ports.py', 'count': len(out), 'major': sum(p['major'] for p in out), 'countries': COUNTRIES,
            'attribution': 'Port list from UN/LOCODE (UNECE) and GeoNames via Open-Meteo geocoding; main ports curated. Positions are approximate (about 1-2 km).'}
    (ROOT / 'data').mkdir(exist_ok=True)
    json.dump({'meta': meta, 'ports': out}, open(ROOT / 'data/baltic-ports.json', 'w'), ensure_ascii=False, indent=0, separators=(',', ':'))
    by = {}
    for p in out: by[p['country']] = by.get(p['country'], 0) + 1
    print('ports', len(out), 'major', meta['major'], by, 'skipped', skipped)

if __name__ == '__main__':
    main()
