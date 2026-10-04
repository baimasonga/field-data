#!/usr/bin/env python3
"""Verify a downloaded encrypted recovery bundle in a new disposable Docker database."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
from uuid import uuid4
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--container', required=True)
    parser.add_argument('--user', default='jubilant')
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'field-data-(feature|test|drill)[a-z0-9-]*', args.container): parser.error('Use a disposable test container.')
    if not re.fullmatch(r'[a-z_][a-z0-9_]*', args.user): parser.error('Invalid test database role.')
    passphrase = os.environ.get('FIELD_DATA_BACKUP_PASSPHRASE', '')
    if len(passphrase) < 16: parser.error('Configure FIELD_DATA_BACKUP_PASSPHRASE securely; do not pass it as an argument.')
    env = {**os.environ, 'ODK_BACKUP_PASSPHRASE': passphrase}
    target = 'field_data_restore_drill_' + uuid4().hex
    started = time.monotonic()
    created = False
    def decrypt(source, destination):
        subprocess.run(['openssl', 'enc', '-d', '-chacha20', '-pbkdf2', '-pass', 'env:ODK_BACKUP_PASSPHRASE', '-in', str(source), '-out', str(destination)], env=env, check=True, capture_output=True)
    def pg(command, *options, data=None):
        return subprocess.run(['docker', 'exec', '-i', args.container, command, '-U', args.user, *options], input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout
    try:
        with tempfile.TemporaryDirectory(prefix='field-data-recovery-drill-') as directory:
            root = Path(directory); archive = root / 'bundle.zip'; decrypt(args.bundle, archive)
            with zipfile.ZipFile(archive) as z:
                if len(z.infolist()) > 25002 or sum(i.file_size for i in z.infolist()) > 8 * 1024 ** 3 + 10 * 1024 ** 2: raise ValueError('Bundle exceeds recovery limits.')
                manifest = json.loads(z.read('manifest.json'))
                if manifest.get('version') != 1: raise ValueError('Unsupported bundle version.')
                schema = manifest['configuration']['schema']
                if not re.fullmatch(r'[a-z_][a-z0-9_]*', schema): raise ValueError('Invalid snapshot schema.')
                entries = manifest['files']
                if len({e['file'] for e in entries}) != len(entries): raise ValueError('Duplicate manifest file.')
                if set(z.namelist()) != {'manifest.json', *(e['file'] for e in entries)}: raise ValueError('Archive and manifest disagree.')
                for entry in entries:
                    if not re.fullmatch(r'files/[0-9]+\.bin', entry['file']): raise ValueError('Invalid archive path.')
                    if entry['kind'] not in ('database', 'object', 'blob'): raise ValueError('Unknown recovery entry.')
                    path = root / entry['file']; path.parent.mkdir(exist_ok=True)
                    digest = hashlib.sha256(); sha1 = hashlib.sha1(); size = 0
                    with z.open(entry['file']) as source, path.open('wb') as out:
                        while chunk := source.read(1024 * 1024):
                            digest.update(chunk); sha1.update(chunk); size += len(chunk); out.write(chunk)
                    if digest.hexdigest() != entry['sha256'] or size != entry['bytes']: raise ValueError('Recovery file integrity mismatch.')
                    if entry['kind'] == 'blob' and sha1.hexdigest() != entry['sha']: raise ValueError('Attachment digest mismatch.')
                databases = [e for e in entries if e['kind'] == 'database']
                if len(databases) != 1: raise ValueError('Exactly one database snapshot is required.')
                dump = root / 'database.pgdump'; decrypt(root / databases[0]['file'], dump)
                pg('createdb', target); created = True
                with dump.open('rb') as source:
                    subprocess.run(['docker', 'exec', '-i', args.container, 'pg_restore', '-U', args.user, '-d', target, '--no-owner', '--no-privileges', '--exit-on-error'], stdin=source, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
                for table, expected in manifest['tables'].items():
                    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', table): raise ValueError('Invalid table name.')
                    if isinstance(expected, int):
                        count = pg('psql', '-d', target, '-At', '-v', 'ON_ERROR_STOP=1', '-c', f'SELECT count(*) FROM "{schema}"."{table}"').decode().strip()
                        if int(count) != expected: raise ValueError('Restored table count mismatch.')
                    else:
                        fingerprint = pg('psql', '-d', target, '-At', '-v', 'ON_ERROR_STOP=1', '-c', f'''SELECT json_build_object('rows',count(*),'digestA',coalesce(sum(('x'||substr(md5(row_to_json(t)::text),1,15))::bit(60)::bigint),0)::text,'digestB',coalesce(sum(('x'||substr(md5(row_to_json(t)::text),18,15))::bit(60)::bigint),0)::text) FROM "{schema}"."{table}" t''').decode().strip()
                        if json.loads(fingerprint) != expected: raise ValueError('Restored row count or digest mismatch.')
                report = {'environment': 'isolated Docker recovery of downloaded bundle', 'tablesCompared': len(manifest['tables']), 'filesVerified': len(entries), 'databaseRestored': True, 'fileHashesAndTableCountsMatch': True, 'elapsedSeconds': round(time.monotonic() - started, 3), 'externalAttachmentFilesVerified': sum(e['kind'] == 'blob' for e in entries), 'providerCutover': 'not attempted; restore verified objects to isolated provider destinations and test attachment links before cutover'}
                args.report.write_text(json.dumps(report, indent=2) + '\n'); print(json.dumps(report))
    finally:
        if created: pg('dropdb', target)


if __name__ == '__main__': main()
