"""Octave's Lua API, read from the engine's own source (Engine/Source/LuaBindings): what DolphinWorks' code editor
completes and explains. Always the installed engine's: nothing to keep up to date by hand.

    read_api(octave_folder) -> {
        'classes': {'Text': {'parent': 'Widget', 'methods': {'SetTextSize': {'args': ['value'], 'doc': ...}}}},
        'tables':  {'System': {'SetSaveInfo': {'args': [...], 'doc': ...}}},     (global tables of functions)
        'enums':   {'AnchorMode': ['TopLeft', ...]},                              (global tables of values)
        'globals': {'LoadAsset': {'args': ['name'], 'doc': ...}},                 (global functions)
    }

Each binding file registers its functions in Bind(): REGISTER_TABLE_FUNC(L, mtIndex, F) on a class's metatable
(CreateClassMetatable(NAME, FLAG, PARENT)), or on a table later set as a global (lua_setglobal(L, "System")).
A function's arguments come from how it reads them (`float value = CHECK_NUMBER(L, 2);`, optional ones inside
`if (!lua_isnone(L, n))`), and its doc from the comment above it.
"""
import re
from pathlib import Path

BIND = re.compile(r'void\s+(?:(\w+)_Lua::)?Bind\w*\s*\(\s*\)\s*\{', re.S)
METATABLE = re.compile(r'CreateClassMetatable\(\s*(\w+)\s*,\s*\w+\s*,\s*(\w+|nullptr|NULL)\s*\)', re.S)
REGISTER = re.compile(r'REGISTER_TABLE_FUNC(?:_EX)?\(\s*L\s*,\s*(\w+)\s*,\s*(\w+)\s*(?:,\s*"(\w+)"\s*)?\)')
SETGLOBAL = re.compile(r'lua_setglobal\(\s*L\s*,\s*"?(\w+)"?\s*\)')
SETFIELD = re.compile(r'lua_setfield\(\s*L\s*,\s*\w+\s*,\s*"(\w+)"\s*\)')
DEFINE = re.compile(r'#define\s+(\w+_LUA_NAME)\s+"(\w+)"')
CHECK = re.compile(r'(?:([\w:<>*&]+)\s+)?(\w+)\s*=\s*\(?\s*(?:\w+\s*\)\s*)?(CHECK_\w+|lua_to\w+|luaL_check\w+)\s*\(\s*L\s*,\s*(\d+)')


def _func_body(text, cls, name):
    """(the comment above `int Cls_Lua::Name(lua_State* L)`, its body)."""
    m = re.search(r'int\s+' + cls + r'_Lua::' + name + r'\s*\(\s*lua_State\s*\*\s*\w+\s*\)\s*\{', text)
    if not m:
        return '', ''
    # the body: to the matching brace
    depth, i = 1, m.end()
    while i < len(text) and depth:
        depth += {'{': 1, '}': -1}.get(text[i], 0)
        i += 1
    body = text[m.end():i]
    # the comment: the // lines just above (blank lines between end it)
    lines = text[:m.start()].rstrip('\n').split('\n')
    doc = []
    for line in reversed(lines):
        s = line.strip()
        if s.startswith('//'):
            doc.append(s[2:].strip())
        else:
            break
    return ' '.join(reversed(doc)).strip(), body


def _args(body, method):
    """The arguments a function reads: [(name, optional)], in order (a method's self left out)."""
    found = {}
    for typ, var, check, idx in CHECK.findall(body):
        idx = int(idx)
        if idx not in found:
            found[idx] = var
    optional = set(int(n) for n in re.findall(r'lua_isnone\(\s*L\s*,\s*(\d+)\s*\)', body))
    optional |= set(int(n) for n in re.findall(r'lua_gettop\(\s*L\s*\)\s*>=\s*(\d+)', body))
    first = 2 if method else 1
    out = []
    for idx in sorted(found):
        if idx >= first:
            name = found[idx]
            out.append(name + ('?' if idx in optional else ''))
    return out


def read_api(octave):
    folder = Path(octave) / 'Engine' / 'Source' / 'LuaBindings'
    api = {'classes': {}, 'tables': {}, 'enums': {}, 'globals': {}}
    if not folder.is_dir():
        return api
    names = {}
    for h in folder.glob('*.h'):
        names.update(dict(DEFINE.findall(h.read_text(errors='replace'))))
    for cpp in sorted(folder.glob('*_Lua.cpp')):
        text = cpp.read_text(errors='replace')
        for bind in BIND.finditer(text):
            cls = bind.group(1) or cpp.stem[:-len('_Lua')]
            # Bind()'s body
            depth, i = 1, bind.end()
            while i < len(text) and depth:
                depth += {'{': 1, '}': -1}.get(text[i], 0)
                i += 1
            body = text[bind.end():i]
            meta = METATABLE.search(body)
            klass = None
            if meta:
                klass = names.get(meta.group(1), cls)
                parent = names.get(meta.group(2)) if meta.group(2) not in ('nullptr', 'NULL') else None
                api['classes'].setdefault(klass, {'parent': parent, 'methods': {}})
            # walk the body in order: functions on a table until the table is named by lua_setglobal
            pending, fields = {}, []
            for m in re.finditer(r'REGISTER_TABLE_FUNC(?:_EX)?\([^)]*\)|lua_setglobal\([^)]*\)|lua_setfield\([^)]*\)', body):
                token = m.group(0)
                reg = REGISTER.match(token)
                if reg:
                    target, func, alias = reg.groups()
                    doc, fbody = _func_body(text, cls, func)
                    entry = {'args': _args(fbody, target == 'mtIndex'), 'doc': doc}
                    if target == 'mtIndex' and klass:
                        api['classes'][klass]['methods'][alias or func] = entry
                    else:
                        pending[alias or func] = entry
                    continue
                field = SETFIELD.match(token)
                if field:
                    fields.append(field.group(1))
                    continue
                glob = SETGLOBAL.match(token)
                if glob:
                    name = names.get(glob.group(1), glob.group(1))
                    if pending:
                        api['tables'].setdefault(name, {}).update(pending)
                    elif fields:
                        api['enums'][name] = fields
                    else:                                   # a lone function pushed, then named
                        start = max(0, m.start() - 200)
                        fn = re.findall(r'lua_pushcfunction\(\s*L\s*,\s*(\w+)\s*\)', body[start:m.start()])
                        if fn:
                            doc, fbody = _func_body(text, cls, fn[-1].split('::')[-1])
                            api['globals'][name] = {'args': _args(fbody, False), 'doc': doc}
                    pending, fields = {}, []
    return api


if __name__ == '__main__':
    import json
    import sys
    a = read_api(sys.argv[1] if len(sys.argv) > 1 else r'C:\Users\NoSig\Documents\octave-libogc')
    print({k: len(v) for k, v in a.items()}, sum(len(c['methods']) for c in a['classes'].values()), 'methods')
    print(json.dumps(a['classes'].get('Text'), indent=1)[:600])
    print(json.dumps({k: a['tables'][k] for k in ('Audio',) if k in a['tables']}, indent=1)[:700])
    print(list(a['enums'])[:12], a['enums'].get('AnchorMode'))
    print(json.dumps(a['globals'], indent=1)[:500])
