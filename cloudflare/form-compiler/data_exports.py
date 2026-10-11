"""Bounded internal data writer. Input already authorized/projected by Central."""
import csv
import io
import json
import math
import re
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory
from xml.etree import ElementTree as ET
import pandas as pd
import pyreadstat


class Recodes:
    """S4 recode rules: for each row, the active rules of its form and version.

    Path rules fill an empty answer from the question's earlier path; value
    rules then map old stored values to new ones (each selected value of a
    multiple-choice question on its own). Counts are kept for the manifest.
    """

    def __init__(self, payload):
        settings = payload.get('recodes') or {}
        self.applied = settings.get('applied', True)
        self.rules = settings.get('rules', []) if self.applied else []
        self.changed = {rule['id']: 0 for rule in self.rules}
        self.multiple = {f['path'] for f in payload['fields'] if f.get('selectMultiple')}
        self.index = {}
        for rule in self.rules:
            for version in rule['versions']:
                self.index.setdefault((rule['xmlFormId'], version, rule['kind'], rule['path']), rule)

    def rule(self, row, kind, path):
        return self.index.get((row.get('sourceForm'), row.get('formVersion'), kind, path)) if self.rules else None

    def value(self, row, path, value):
        rule = self.rule(row, 'value', path)
        if rule is None or value in (None, ''): return value
        mapping = rule['values']
        if path in self.multiple:
            parts = str(value).split()
            mapped = ' '.join(mapping.get(part, part) for part in parts)
        else:
            mapped = mapping.get(value, value)
        if mapped != value: self.changed[rule['id']] += 1
        return mapped

    def manifest(self):
        return {'applied': self.applied,
                'rules': [{**{k: rule[k] for k in ('id', 'xmlFormId', 'kind', 'path', 'fromPath', 'versions', 'values') if k in rule}, 'changed': self.changed[rule['id']]} for rule in self.rules]}


def tables_for(payload, recodes=None):
    recodes = recodes or Recodes(payload)
    fields = payload['fields']
    selected_repeat = payload.get('definition', {}).get('repeatPath')
    if selected_repeat:
        records = []
        for row in payload['rows']:
            parent = row['sourceForm'] + ':' + row['instanceId']
            records.append({'record_id': f"{parent}:{selected_repeat}:{row['repeatIndex']}", 'parent_id': parent, 'instance_id': row['instanceId'], 'source_form': row['sourceForm'], 'submitted_at': row['submittedAt'], **{f['path']: recodes.value(row, f['path'], (row.get('data') or {}).get(f['path'], '')) for f in fields}})
        return {selected_repeat: {'fields': fields, 'rows': records}}
    repeat_paths = sorted(payload.get('repeatPaths', []), key=lambda p: (p.count('/'), p))
    parents = {p: next((r for r in reversed(repeat_paths) if p.startswith(r + '/')), None) for p in repeat_paths}
    scopes = {p: [] for p in [None] + repeat_paths}
    for field in fields:
        parent = next((p for p in reversed(repeat_paths) if field['path'].startswith(p + '/')), None)
        scopes[parent].append(field)
    tables = {p: {'fields': fs, 'rows': []} for p, fs in scopes.items() if fs or p is None}
    # Include ancestor tables even if only nested descendants are projected.
    for p in list(tables):
        while p is not None:
            if p not in tables: tables[p] = {'fields': [], 'rows': []}
            p = parents[p]
    for row in payload['rows']:
        raw = row.get('xml', '')
        if '<!DOCTYPE' in raw.upper() or '<!ENTITY' in raw.upper():
            raise ValueError('DTD/entity declarations are unsupported in exports.')
        root = ET.fromstring(raw) if raw else None
        if root is not None:
            for node in root.iter(): node.tag = node.tag.split('}')[-1]
        def extract(node, prefix, fs):
            result = {}
            for f in fs:
                relative = f['path'][len(prefix):].lstrip('/')
                found = node.find(relative) if node is not None else None
                value = ''.join(found.itertext()) if found is not None else (row.get('data') or {}).get(f['path'], '')
                moved = recodes.rule(row, 'path', f['path']) if prefix == '' else None
                if moved is not None and value == '' and node is not None:
                    earlier = node.find(moved['fromPath'].lstrip('/'))
                    if earlier is not None and ''.join(earlier.itertext()) != '':
                        value = ''.join(earlier.itertext()); recodes.changed[moved['id']] += 1
                result[f['path']] = recodes.value(row, f['path'], value)
            return result
        root_key = row['sourceForm'] + ':' + row['instanceId']
        tables[None]['rows'].append({'record_id': root_key, 'parent_id': '', 'instance_id': row['instanceId'], 'source_form': row['sourceForm'], 'submitted_at': row['submittedAt'], **extract(root, '', scopes[None])})
        nodes = {None: [(root, root_key)]}
        for p in repeat_paths:
            if p not in tables: continue
            parent = parents[p]; nodes[p] = []
            for node, parent_key in nodes.get(parent, []):
                relative = p[len(parent or ''):].lstrip('/')
                for index, child in enumerate(node.findall(relative) if node is not None else [], 1):
                    key = f'{parent_key}:{p}:{index}'
                    nodes[p].append((child, key))
                    tables[p]['rows'].append({'record_id': key, 'parent_id': parent_key, 'instance_id': row['instanceId'], 'source_form': row['sourceForm'], 'submitted_at': row['submittedAt'], **extract(child, p, scopes[p])})
    return tables


def write_export(payload, fmt):
    if fmt not in ('csv', 'xlsx', 'sav', 'dta', 'kml'): raise ValueError('Unsupported format.')
    recodes = Recodes(payload)
    tables = tables_for(payload, recodes)
    metadata = ['record_id', 'parent_id', 'instance_id', 'source_form', 'submitted_at']
    manifest = {'version': 1, 'source': payload['source'], 'definition': payload['definition'], 'timezone': 'UTC', 'missing': 'blank strings or system missing numeric; never zero', 'tables': [], 'choiceCoding': 'original choice names; multiple selections retained as space-separated names', 'variableLabels': 'Native labels are limited to 80 characters; full labels and field paths are preserved in this manifest'}
    manifest['recodes'] = recodes.manifest()
    if fmt == 'kml':
        geometry = payload.get('geometry')
        if not geometry: raise ValueError('Select a visible geometry field before exporting KML.')
        namespace = 'http://www.opengis.net/kml/2.2'; ET.register_namespace('', namespace)
        root = ET.Element(f'{{{namespace}}}kml'); doc = ET.SubElement(root, 'Document'); skipped = 0
        for table in tables.values():
            for row in table['rows']:
                parts = str(row.get(geometry, '')).split()
                try:
                    lat, lon = map(float, parts[:2])
                    if not (math.isfinite(lat) and math.isfinite(lon) and abs(lat) <= 90 and abs(lon) <= 180) or lat == lon == 0: raise ValueError()
                except (ValueError, TypeError): skipped += 1; continue
                mark = ET.SubElement(doc, 'Placemark'); ET.SubElement(mark, 'name').text = row['record_id']
                point = ET.SubElement(mark, 'Point'); ET.SubElement(point, 'coordinates').text = f'{lon},{lat},0'
        ET.SubElement(doc, 'description').text = f'WGS84 points. {skipped} rows without valid selected coordinates omitted. Answers are excluded.'
        # The recode audit travels with the points it may have changed.
        data = ET.SubElement(ET.SubElement(doc, 'ExtendedData'), 'Data', name='recodes')
        ET.SubElement(data, 'value').text = json.dumps(recodes.manifest(), ensure_ascii=False)
        return ET.tostring(root, encoding='utf-8', xml_declaration=True), 'application/vnd.google-earth.kml+xml', 'kml'
    archive = io.BytesIO()
    workbook_buffer = io.BytesIO()
    workbook = pd.ExcelWriter(workbook_buffer, engine='openpyxl') if fmt == 'xlsx' else None
    with TemporaryDirectory() as directory, zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for index, (scope, table) in enumerate(tables.items()):
            name = 'submissions' if scope is None else f'repeat_{index}'
            columns = metadata + [f['path'] for f in table['fields']]
            variable_names = {p: p if p in metadata else f'v{i:03d}_' + re.sub(r'[^A-Za-z0-9_]', '_', p.rsplit('/', 1)[-1])[:25] for i, p in enumerate(columns)}
            labels = {variable_names[f['path']]: (f.get('name') or f['path'])[:80] for f in table['fields']}
            schema = [{'path': p, 'variable': variable_names[p], 'label': next((f.get('name') or f['path'] for f in table['fields'] if f['path'] == p), p), 'type': next((f['type'] for f in table['fields'] if f['path'] == p), 'string')} for p in columns]
            manifest['tables'].append({'file': name + '.' + fmt, 'scope': scope, 'rows': len(table['rows']), 'columns': schema})
            df = pd.DataFrame(table['rows'], columns=columns)
            if fmt == 'csv':
                stream = io.StringIO(); writer = csv.writer(stream); writer.writerow(columns)
                for row in table['rows']:
                    writer.writerow(["'" + str(row.get(p, '')) if isinstance(row.get(p), str) and str(row[p]).lstrip().startswith(('=', '+', '-', '@')) else row.get(p, '') for p in columns])
                z.writestr(name + '.csv', stream.getvalue())
            elif fmt == 'xlsx':
                # No formulas from field values: escape spreadsheet-active prefixes.
                for col in columns: df[col] = df[col].map(lambda v: "'" + v if isinstance(v, str) and v.lstrip().startswith(('=', '+', '-', '@')) else v)
                df.to_excel(workbook, sheet_name=name[:31], index=False)
            else:
                for spec in schema:
                    p = spec['path']
                    if spec['type'] in ('int', 'decimal'):
                        values = df[p].replace('', None)
                        converted = pd.to_numeric(values, errors='coerce')
                        if ((values.notna()) & converted.isna()).any(): raise ValueError(f'Invalid numeric value in {p}; export CSV to inspect it.')
                        if ((converted.dropna().abs() > 2 ** 53)).any(): raise ValueError(f'Number exceeds exact statistical precision in {p}.')
                        df[p] = converted.astype(float)
                    elif spec['type'] in ('date', 'dateTime') or p == 'submitted_at':
                        values = df[p].replace('', None)
                        converted = pd.to_datetime(values, errors='coerce', utc=True)
                        if (values.notna() & converted.isna()).any(): raise ValueError(f'Invalid date in {p}.')
                        df[p] = converted.dt.tz_localize(None)
                    else: df[p] = df[p].fillna('').astype(str)
                df = df.rename(columns=variable_names)
                path = Path(directory) / (name + '.' + fmt)
                if fmt == 'sav': pyreadstat.write_sav(df, str(path), column_labels=labels)
                else:
                    date_formats = {variable_names[s['path']]: 'td' if s['type'] == 'date' else 'tc' for s in schema if s['type'] in ('date', 'dateTime') or s['path'] == 'submitted_at'}
                    long_strings = [col for col in df.columns if df[col].dtype == object and any(len(str(v).encode('utf-8')) > 2045 for v in df[col])]
                    df.to_stata(str(path), version=118, write_index=False, variable_labels=labels, convert_dates=date_formats, convert_strl=long_strings)
                z.write(path, path.name)
        if workbook:
            # Manifest lives in the same workbook as a plain string, never a formula.
            pd.DataFrame({'manifest': [json.dumps(manifest, ensure_ascii=False)]}).to_excel(workbook, sheet_name='manifest', index=False)
            workbook.close(); return workbook_buffer.getvalue(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'
        z.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
    return archive.getvalue(), 'application/zip', 'zip'
