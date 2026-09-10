"""Read an unencrypted EPUB in spine order. No extraction to the filesystem."""
import json
import posixpath
import sys
import zipfile
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree as ET

MAX_TOTAL = 128 * 1024 * 1024
MAX_ENTRY = 16 * 1024 * 1024


def local(tag):
    return tag.split('}')[-1].lower()


def xml(data):
    if b'<!ENTITY' in data.upper():
        raise ValueError('EPUB XML contains entity declarations')
    return ET.fromstring(data)


def resolve(base, href):
    parts = urlsplit(href)
    if parts.scheme or parts.netloc:
        raise ValueError('Remote EPUB content is not supported')
    result = posixpath.normpath(posixpath.join(posixpath.dirname(base), unquote(parts.path)))
    if result.startswith(('../', '/')) or result == '..' or '\\' in result:
        raise ValueError('Invalid EPUB entry path')
    return result


def parse_epub(file):
    with zipfile.ZipFile(file) as archive:
        entries = archive.infolist()
        if len(entries) > 10000 or sum(e.file_size for e in entries) > MAX_TOTAL:
            raise ValueError('EPUB archive exceeds limits')
        if len({e.filename for e in entries}) != len(entries):
            raise ValueError('Duplicate EPUB entries')
        if any(e.file_size > MAX_ENTRY or e.flag_bits & 1 for e in entries):
            raise ValueError('Oversized or encrypted EPUB entry')
        if 'META-INF/encryption.xml' in archive.namelist():
            raise ValueError('Encrypted EPUB is not supported')
        container = xml(archive.read('META-INF/container.xml'))
        rootfiles = [e.attrib['full-path'] for e in container.iter() if local(e.tag) == 'rootfile']
        if len(rootfiles) != 1:
            raise ValueError('Expected one EPUB package')
        opf_name = resolve('', rootfiles[0])
        opf = xml(archive.read(opf_name))
        metadata = {}
        for e in opf.iter():
            if local(e.tag) in ('title', 'creator'):
                key = 'title' if local(e.tag) == 'title' else 'author'
                metadata.setdefault(key, ''.join(e.itertext()).strip())
        manifest = {e.attrib['id']: e.attrib for e in opf.iter() if local(e.tag) == 'item'}
        spine = [e.attrib['idref'] for e in opf.iter() if local(e.tag) == 'itemref']
        if not spine:
            raise ValueError('EPUB spine is empty')
        chapters = []
        for index, ref in enumerate(spine):
            item = manifest[ref]
            if 'nav' in item.get('properties', '').split():
                continue
            if item.get('media-type') not in ('application/xhtml+xml', 'text/html'):
                raise ValueError('Unsupported EPUB spine media type')
            name = resolve(opf_name, item['href'])
            root = xml(archive.read(name))
            body = next((e for e in root.iter() if local(e.tag) == 'body'), None)
            if body is None:
                raise ValueError('EPUB document has no body')
            title = f'前言（文档{index + 1}）'
            parts = []

            def flush():
                nonlocal parts
                content = '\n'.join(line.strip() for line in ''.join(parts).splitlines() if line.strip())
                if content:
                    chapters.append({'title': title, 'content': content, 'epubEntry': name})
                parts = []

            def visit(node):
                nonlocal title
                tag = local(node.tag)
                if tag in ('script', 'style', 'nav', 'iframe'):
                    return
                if tag in ('h1', 'h2'):
                    flush()
                    title = ''.join(node.itertext()).strip()
                    return
                if tag in ('br', 'p', 'div', 'section', 'li', 'blockquote', 'pre', 'h3', 'h4'):
                    parts.append('\n')
                if node.text:
                    parts.append(node.text)
                for child in node:
                    visit(child)
                    if child.tail:
                        parts.append(child.tail)
                if tag in ('p', 'div', 'section', 'li', 'blockquote', 'pre', 'h3', 'h4'):
                    parts.append('\n')

            visit(body)
            flush()
        if not chapters:
            raise ValueError('EPUB contains no text chapters')
        return {'metadata': metadata, 'chapters': chapters}


def extract_txt(file, selected=None):
    with zipfile.ZipFile(file) as archive:
        entries = archive.infolist()
        if len(entries) > 10000 or sum(e.file_size for e in entries) > MAX_TOTAL:
            raise ValueError('ZIP archive exceeds limits')
        if len({e.filename for e in entries}) != len(entries):
            raise ValueError('Duplicate ZIP entries')
        candidates = [e for e in entries if not e.is_dir() and e.filename.lower().endswith('.txt')]
        if selected:
            candidates = [e for e in candidates if e.filename == selected]
        if len(candidates) != 1:
            raise ValueError('ZIP must contain exactly one selected TXT file')
        entry = candidates[0]
        if entry.file_size > 64 * 1024 * 1024 or entry.flag_bits & 1:
            raise ValueError('Oversized or encrypted TXT entry')
        return archive.read(entry)


if __name__ == '__main__':
    try:
        # ASCII JSON keeps subprocess output portable under Windows code pages.
        if len(sys.argv) > 2 and sys.argv[2] == '--txt':
            sys.stdout.buffer.write(extract_txt(sys.argv[1], sys.argv[3] if len(sys.argv) > 3 else None))
        else:
            print(json.dumps(parse_epub(sys.argv[1]), ensure_ascii=True))
    except Exception as error:
        print(str(error).encode('ascii', 'backslashreplace').decode(), file=sys.stderr)
        sys.exit(1)
