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


def recode_fixture(applied=True):
    """Two versions of one form: v1 kept water as 'borehole' and age at /old_age."""
    p = {'source': {'kind': 'form', 'id': 1}, 'definition': {'version': 1}, 'repeatPaths': ['/children'], 'fields': [
        {'path': '/water', 'type': 'string'}, {'path': '/lights', 'type': 'string', 'selectMultiple': True},
        {'path': '/age', 'type': 'int'}, {'path': '/children/water', 'type': 'string'}],
        'rows': [
            {'instanceId': 'uuid:old', 'sourceForm': 'census', 'formVersion': '1', 'submittedAt': '2026-10-01T00:00:00Z',
             'xml': '<data><water>borehole</water><lights>solar torch</lights><old_age>40</old_age><children><water>borehole</water></children></data>'},
            {'instanceId': 'uuid:new', 'sourceForm': 'census', 'formVersion': '2', 'submittedAt': '2026-10-02T00:00:00Z',
             'xml': '<data><water>borehole</water><lights>torch</lights><age>31</age><old_age>99</old_age></data>'},
            {'instanceId': 'uuid:other', 'sourceForm': 'farm', 'formVersion': '1', 'submittedAt': '2026-10-03T00:00:00Z',
             'xml': '<data><water>borehole</water></data>'}],
        'recodes': {'applied': applied, 'rules': [
            {'id': 'r1', 'xmlFormId': 'census', 'kind': 'value', 'path': '/water', 'fromPath': None, 'versions': ['1'], 'values': {'borehole': 'bh'}},
            {'id': 'r2', 'xmlFormId': 'census', 'kind': 'value', 'path': '/lights', 'fromPath': None, 'versions': ['1'], 'values': {'torch': 'battery_torch'}},
            {'id': 'r3', 'xmlFormId': 'census', 'kind': 'path', 'path': '/age', 'fromPath': '/old_age', 'versions': ['1'], 'values': None},
            {'id': 'r4', 'xmlFormId': 'census', 'kind': 'value', 'path': '/children/water', 'fromPath': None, 'versions': ['1'], 'values': {'borehole': 'bh'}}]}}
    return p


class Recoding(unittest.TestCase):
    def read(self, payload):
        content, _, _ = write_export(payload, 'csv')
        with zipfile.ZipFile(io.BytesIO(content)) as z:
            main = pd.read_csv(io.BytesIO(z.read('submissions.csv')), dtype=str, keep_default_na=False).set_index('instance_id')
            children = pd.read_csv(io.BytesIO(z.read('repeat_1.csv')), dtype=str, keep_default_na=False)
            return main, children, json.loads(z.read('manifest.json'))

    def test_rules_apply_only_to_their_form_and_versions(self):
        main, children, manifest = self.read(recode_fixture())
        old, new, other = main.loc['uuid:old'], main.loc['uuid:new'], main.loc['uuid:other']
        self.assertEqual(old['/water'], 'bh'); self.assertEqual(new['/water'], 'borehole'); self.assertEqual(other['/water'], 'borehole')
        # Each selected value is mapped on its own; values not in the map are kept.
        self.assertEqual(old['/lights'], 'solar battery_torch'); self.assertEqual(new['/lights'], 'torch')
        # The earlier path fills an empty answer only for the listed version.
        self.assertEqual(old['/age'], '40'); self.assertEqual(new['/age'], '31')
        self.assertEqual(list(children['/children/water']), ['bh'])
        self.assertTrue(manifest['recodes']['applied'])
        self.assertEqual({r['id']: r['changed'] for r in manifest['recodes']['rules']}, {'r1': 1, 'r2': 1, 'r3': 1, 'r4': 1})

    def test_a_path_rule_never_replaces_an_answer_at_the_current_path(self):
        p = recode_fixture(); p['rows'][0]['xml'] = p['rows'][0]['xml'].replace('<old_age>40</old_age>', '<old_age>40</old_age><age>41</age>')
        main, _, manifest = self.read(p)
        self.assertEqual(main.loc['uuid:old', '/age'], '41')
        self.assertEqual(next(r for r in manifest['recodes']['rules'] if r['id'] == 'r3')['changed'], 0)

    def test_exported_as_stored_when_asked(self):
        main, children, manifest = self.read(recode_fixture(applied=False))
        self.assertEqual(main.loc['uuid:old', '/water'], 'borehole'); self.assertEqual(main.loc['uuid:old', '/age'], '')
        self.assertEqual(list(children['/children/water']), ['borehole'])
        self.assertEqual(manifest['recodes'], {'applied': False, 'rules': []})

    def test_repeat_scope_applies_value_rules(self):
        p = recode_fixture(); p['definition'] = {'version': 1, 'repeatPath': '/children'}
        p['fields'] = [{'path': '/children/water', 'type': 'string'}]
        p['rows'] = [{'instanceId': 'uuid:old', 'sourceForm': 'census', 'formVersion': '1', 'submittedAt': '2026-10-01T00:00:00Z', 'repeatIndex': 1, 'data': {'/children/water': 'borehole'}},
                     {'instanceId': 'uuid:new', 'sourceForm': 'census', 'formVersion': '2', 'submittedAt': '2026-10-02T00:00:00Z', 'repeatIndex': 1, 'data': {'/children/water': 'borehole'}}]
        content, _, _ = write_export(p, 'csv')
        with zipfile.ZipFile(io.BytesIO(content)) as z:
            rows = pd.read_csv(io.BytesIO(z.read('submissions.csv') if 'submissions.csv' in z.namelist() else z.read(z.namelist()[0])), dtype=str, keep_default_na=False)
        self.assertEqual(list(rows['/children/water']), ['bh', 'borehole'])

    def test_payload_without_recodes_is_unchanged(self):
        p = fixture(); content, _, _ = write_export(p, 'csv')
        with zipfile.ZipFile(io.BytesIO(content)) as z:
            self.assertEqual(json.loads(z.read('manifest.json'))['recodes'], {'applied': True, 'rules': []})
