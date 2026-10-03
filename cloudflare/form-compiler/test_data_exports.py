"""Synthetic export acceptance with pandas and an independent SAV reader."""
import io
import json
import struct
import unittest
import zipfile
from xml.etree import ElementTree as ET
import pandas as pd
from data_exports import write_export


def independent_sav(data):
    if data[:4] != b'$FL2': raise AssertionError('Not native SAV')
    case_size, compression, _, cases = struct.unpack_from('<iiii', data, 68)
    if compression != 0: raise AssertionError('Expect uncompressed SAV')
    offset = 176; variables = []
    while True:
        kind, = struct.unpack_from('<i', data, offset); offset += 4
        if kind == 2:
            typ, label, missing, _, _ = struct.unpack_from('<iiiii', data, offset)
            name = data[offset + 20:offset + 28].rstrip(b' ').decode('ascii'); offset += 28
            variables.append((name, typ))
            if label:
                length, = struct.unpack_from('<i', data, offset); offset += 4 + ((length + 3) // 4) * 4
            offset += abs(missing) * 8
        elif kind == 3:
            n, = struct.unpack_from('<i', data, offset); offset += 4
            for _ in range(n):
                length = data[offset + 8]; offset += 8 + ((length + 1 + 7) // 8) * 8
        elif kind == 4:
            n, = struct.unpack_from('<i', data, offset); offset += 4 + 4 * n
        elif kind == 6:
            n, = struct.unpack_from('<i', data, offset); offset += 4 + 80 * n
        elif kind == 7:
            _, size, n = struct.unpack_from('<iii', data, offset); offset += 12 + size * n
        elif kind == 999: offset += 4; break
        else: raise AssertionError(f'Unexpected record {kind}')
    records = []
    for i in range(cases):
        record = {}; start = offset + i * case_size * 8
        for slot, (name, typ) in enumerate(variables):
            if typ < 0: continue
            raw = data[start + slot * 8:start + slot * 8 + (8 if typ == 0 else typ)]
            record[name] = struct.unpack('<d', raw)[0] if typ == 0 else raw.rstrip(b' ').decode('utf-8')
        records.append(record)
    return records


def fixture():
    return {'source': {'kind': 'form', 'id': 1}, 'definition': {'version': 1}, 'geometry': '/gps', 'repeatPaths': ['/children'], 'fields': [
        {'path': '/name', 'name': 'Name', 'type': 'string'}, {'path': '/age', 'name': 'Age', 'type': 'int'},
        {'path': '/date', 'name': 'Date', 'type': 'date'}, {'path': '/gps', 'type': 'geopoint'},
        {'path': '/children/name', 'type': 'string'}, {'path': '/children/age', 'type': 'int'}],
        'rows': [{'instanceId': 'uuid:1', 'sourceForm': 'survey', 'submittedAt': '2026-10-03T12:00:00Z', 'xml': '<data><name>Zoë &amp; A</name><age>42</age><date>2026-10-03</date><gps>8.46 -11.79 0 5</gps><children><name>One</name><age>5</age></children><children><name>Two</name><age/></children></data>'}]}


class Exports(unittest.TestCase):
    def test_stata_independent_pandas_and_repeat_keys(self):
        content, _, extension = write_export(fixture(), 'dta'); self.assertEqual(extension, 'zip')
        with zipfile.ZipFile(io.BytesIO(content)) as z:
            main = pd.read_stata(io.BytesIO(z.read('submissions.dta'))); children = pd.read_stata(io.BytesIO(z.read('repeat_1.dta')))
            self.assertEqual(main.loc[0, 'v005_name'], 'Zoë & A'); self.assertEqual(main.loc[0, 'v006_age'], 42)
            self.assertEqual(main.loc[0, 'v007_date'], pd.Timestamp('2026-10-03'))
            self.assertEqual(len(children), 2); self.assertEqual(children.loc[0, 'parent_id'], main.loc[0, 'record_id'])
            self.assertTrue(pd.isna(children.loc[1, 'v006_age'])); self.assertEqual(json.loads(z.read('manifest.json'))['tables'][1]['scope'], '/children')
    def test_spss_separate_system_file_reader(self):
        content, _, _ = write_export(fixture(), 'sav')
        with zipfile.ZipFile(io.BytesIO(content)) as z:
            rows = independent_sav(z.read('submissions.sav'))
            self.assertEqual(rows[0]['V005_NAM'], 'Zoë & A'); self.assertEqual(rows[0]['V006_AGE'], 42)
            children = independent_sav(z.read('repeat_1.sav')); self.assertEqual(len(children), 2)
            self.assertLess(children[1]['V006_AGE'], -1e300)
    def test_kml_xml_and_coordinates(self):
        content, _, _ = write_export(fixture(), 'kml'); root = ET.fromstring(content); ns = {'k': 'http://www.opengis.net/kml/2.2'}
        self.assertEqual(root.find('.//k:coordinates', ns).text, '-11.79,8.46,0'); self.assertEqual(len(root.findall('.//k:Placemark', ns)), 1)
        self.assertNotIn(b'Zo', content)
    def test_xlsx_formula_safety_and_empty_formats(self):
        p = fixture(); p['rows'][0]['xml'] = p['rows'][0]['xml'].replace('Zoë &amp; A', '=evil')
        content, _, _ = write_export(p, 'xlsx')
        from openpyxl import load_workbook
        self.assertEqual(load_workbook(io.BytesIO(content))['submissions']['F2'].value, "'=evil")
        p['rows'] = []
        for fmt in ['csv', 'xlsx', 'sav', 'dta']: self.assertGreater(len(write_export(p, fmt)[0]), 50)
    def test_long_unicode_strings_are_not_truncated(self):
        p = fixture(); text = 'é' * 1200; p['rows'][0]['xml'] = p['rows'][0]['xml'].replace('Zoë &amp; A', text)
        import pyreadstat
        from pathlib import Path
        from tempfile import TemporaryDirectory
        for fmt in ['sav', 'dta']:
            content, _, _ = write_export(p, fmt)
            with zipfile.ZipFile(io.BytesIO(content)) as z:
                raw = z.read('submissions.' + fmt)
                if fmt == 'dta':
                    self.assertEqual(pd.read_stata(io.BytesIO(raw)).loc[0, 'v005_name'], text)
                with TemporaryDirectory() as directory:
                    file = Path(directory) / ('long.' + fmt); file.write_bytes(raw); df, _ = (pyreadstat.read_sav if fmt == 'sav' else pyreadstat.read_dta)(str(file))
                self.assertEqual(df.loc[0, 'v005_name'], text)

    def test_entities_and_bad_numbers_fail(self):
        p = fixture(); p['rows'][0]['xml'] = '<!DOCTYPE data><data/>'
        with self.assertRaises(ValueError): write_export(p, 'csv')
        p = fixture(); p['rows'][0]['xml'] = p['rows'][0]['xml'].replace('<age>42</age>', '<age>invalid</age>')
        with self.assertRaises(ValueError): write_export(p, 'sav')
