"""Convert an official D1 SQL export offline; never connects to the source DB."""
import argparse
import datetime
import gzip
import hashlib
import json
import pathlib
import re
import sqlite3


def convert(source):
    connection = sqlite3.connect(':memory:')
    # Export SQL may create its original tables, indexes and triggers, but must
    # never attach files or load extensions on the migration host.
    def authorize(action, first, second, database, trigger):
        if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH):
            return sqlite3.SQLITE_DENY
        if action == sqlite3.SQLITE_FUNCTION and second == 'load_extension':
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK
    connection.set_authorizer(authorize)
    try:
        connection.executescript(source.read_text(encoding='utf-8'))
        if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Export failed SQLite integrity check')
        collections = []
        names = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        for name in names:
            if name.startswith(('_', 'sqlite_')):
                continue
            if not re.fullmatch('[A-Za-z][A-Za-z0-9_]*', name):
                raise ValueError('Unsupported collection name')
            documents = []
            for row_id, document in connection.execute(f'SELECT id, document FROM "{name}" ORDER BY id'):
                if str(json.loads(document).get('_id')) != row_id:
                    raise ValueError('Document ID mismatch: ' + name)
                documents.append({'id': row_id, 'document': document})
            indexes = [{'name': '_id_', 'key': {'_id': 1}, 'unique': True}]
            indexes.extend(json.loads(row[0]) for row in connection.execute('SELECT definition FROM _d1_indexes WHERE collection_name=? ORDER BY index_name', (name,)))
            collections.append({'name': name, 'documents': documents, 'indexes': indexes})
        return {'format': 'test1-cloudflare-documents-v1', 'source': 'D1',
                'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'revision': connection.execute('SELECT revision FROM _d1_meta WHERE id=1').fetchone()[0],
                'collections': collections}
    finally:
        connection.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sql', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    snapshot = convert(args.sql)
    archive = gzip.compress(json.dumps(snapshot, ensure_ascii=False, separators=(',', ':')).encode())
    with args.output.open('xb') as handle:
        args.output.chmod(0o600)
        handle.write(archive)
    print(json.dumps({'sha256': hashlib.sha256(archive).hexdigest(), 'bytes': len(archive),
                      'revision': snapshot['revision'],
                      'collections': [{'name': c['name'], 'count': len(c['documents'])} for c in snapshot['collections']]}))
