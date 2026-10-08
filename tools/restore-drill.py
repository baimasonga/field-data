#!/usr/bin/env python3
"""Disposable Docker/fixture recovery drill. Never contacts a production provider."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from tempfile import TemporaryDirectory
import time
from uuid import uuid4


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container', required=True)
    parser.add_argument('--source-database', required=True)
    parser.add_argument('--storage-directory', required=True, type=Path)
    parser.add_argument('--report', required=True, type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r'field-data-(feature|test|drill)[a-z0-9-]*', args.container): parser.error('Use an explicitly named local test container.')
    if not re.fullmatch(r'field_data_(test|drill|restore)[a-z0-9_]*', args.source_database): parser.error('Use a fixture/test database, never production.')
    storage = args.storage_directory.resolve()
    if not str(storage).startswith(('/workspace/.field-data-setup/', '/tmp/')): parser.error('Use disposable local fixture storage.')
    if any(p.is_symlink() for p in storage.rglob('*')): parser.error('Fixture storage must not contain symlinks.')
    target = 'field_data_restore_drill_' + uuid4().hex
    def pg(tool, *options, capture=True):
        return subprocess.run(['docker', 'exec', args.container, tool, '-U', 'jubilant', *options], check=True, stdout=subprocess.PIPE if capture else None, stderr=subprocess.PIPE).stdout
    def query(database, sql): return pg('psql', '-d', database, '-At', '-c', sql).decode().strip()
    def fingerprint(database):
        names = query(database, "select tablename from pg_tables where schemaname='public' order by tablename").splitlines()
        results = {}
        for name in names:
            if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name): raise ValueError('Unsupported fixture table name')
            summary = query(database, f'''select count(*) || ':' || coalesce(md5(string_agg(md5(row_to_json(t)::text), '' order by md5(row_to_json(t)::text))), '') from public."{name}" t''')
            results[name] = summary
        return results
    def files(root):
        return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.rglob('*')) if p.is_file() and not p.is_symlink()}
    started = time.monotonic(); before = fingerprint(args.source_database); before_files = files(storage)
    created = False
    try:
        with TemporaryDirectory(prefix='field-data-drill-') as directory:
            path = Path(directory)
            dump = path / 'database.pgdump'; dump.write_bytes(pg('pg_dump', '-d', args.source_database, '--format=custom', '--no-owner', '--no-privileges'))
            # Same cipher/KDF as the existing Central backup path. Random ephemeral
            # fixture key is kept out of command arguments, logs and the report.
            env = {**os.environ, 'ODK_BACKUP_PASSPHRASE': uuid4().hex + uuid4().hex}
            encrypted = path / 'database.enc'
            subprocess.run(['openssl', 'enc', '-chacha20', '-pbkdf2', '-pass', 'env:ODK_BACKUP_PASSPHRASE', '-in', str(dump), '-out', str(encrypted)], env=env, check=True, capture_output=True)
            dump.unlink()
            subprocess.run(['openssl', 'enc', '-d', '-chacha20', '-pbkdf2', '-pass', 'env:ODK_BACKUP_PASSPHRASE', '-in', str(encrypted), '-out', str(dump)], env=env, check=True, capture_output=True)
            restored_files = path / 'objects'; shutil.copytree(storage, restored_files, symlinks=False)
            pg('createdb', target); created = True
            subprocess.run(['docker', 'exec', '-i', args.container, 'pg_restore', '-U', 'jubilant', '-d', target, '--no-owner', '--no-privileges', '--exit-on-error'], input=dump.read_bytes(), capture_output=True, check=True)
            after = fingerprint(target); after_files = files(restored_files)
            if before != after or before_files != after_files: raise AssertionError('Recovery integrity mismatch')
            report = {'environment': 'disposable Docker fixture', 'sourceDatabase': args.source_database, 'tablesCompared': len(before), 'filesCompared': len(before_files), 'rowAndFileHashesMatch': True, 'elapsedSeconds': round(time.monotonic() - started, 3), 'rpo': 'fixture snapshot; no concurrent writes', 'rto': 'measured local drill only; no production commitment'}
            args.report.write_text(json.dumps(report, indent=2) + '\n'); print(json.dumps(report))
    finally:
        if created: pg('dropdb', target)


if __name__ == '__main__': main()
