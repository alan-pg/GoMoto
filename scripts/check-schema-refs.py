#!/usr/bin/env python3
"""
Compara o que o código pede ao Supabase contra as colunas que existem de fato.

Uso: python3 scripts/check-schema-refs.py   (exige o Supabase local rodando)

Os portões do repo não fazem isso: nome de tabela e de coluna são string livre
para o TypeScript. Foi por aí que cinco fluxos quebraram sem ninguém notar.

Heurística: acha `from('<tabela>')` e, na janela seguinte, coleta colunas de
.select(), .eq/.neq/.gt/.gte/.lt/.lte/.is/.in/.not(), .order() e as chaves dos
literais passados a .insert()/.update(). Compara com information_schema.
"""
import os, re, sys, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SQL = """SELECT table_name, string_agg(column_name, ',' ORDER BY column_name)
FROM information_schema.columns WHERE table_schema='public'
GROUP BY table_name ORDER BY table_name;"""

dump = subprocess.run(
    ["docker", "exec", "supabase_db_GoMoto", "psql", "-U", "postgres", "-d", "postgres",
     "-t", "-A", "-F", "|", "-c", SQL],
    capture_output=True, text=True,
)
if dump.returncode != 0:
    sys.exit(f"não consegui ler o schema do banco local — o Supabase está de pé?\n{dump.stderr}")

cols = {}
for line in dump.stdout.splitlines():
    line = line.strip()
    if not line or "|" not in line:
        continue
    t, c = line.split("|", 1)
    cols[t] = set(c.split(","))

# Embeds do PostgREST e chaves que não são coluna
IGNORE = {"*", "count", "sum", "avg", "min", "max"}

def scan_select(expr):
    """Colunas de uma string de select, ignorando embeds aninhados."""
    out, depth, buf = [], 0, ""
    for ch in expr:
        if ch == "(":
            depth += 1
            # `customers(name)` é EMBED de relacionamento, não coluna: o que
            # veio antes do parêntese é nome de tabela e deve ser descartado.
            if depth == 1:
                buf = ""
            continue
        if ch == ")":
            depth -= 1
            continue
        if ch == "," and depth == 0:
            out.append(buf); buf = ""
            continue
        if depth == 0:
            buf += ch
    out.append(buf)
    res = []
    for item in out:
        item = item.strip()
        if not item or item in IGNORE:
            continue
        # alias:coluna  ->  coluna ;  tabela(...) já foi descartado pelo depth
        if ":" in item:
            item = item.split(":", 1)[1].strip()
        if not item or not re.fullmatch(r"[a-z_][a-z0-9_]*", item):
            continue
        res.append(item)
    return res

FROM_RE = re.compile(r"\.from\(\s*['\"]([a-z_][a-z0-9_]*)['\"]\s*\)")
SELECT_RE = re.compile(r"\.select\(\s*[`'\"]([^`'\"]*)[`'\"]")
FILTER_RE = re.compile(r"\.(?:eq|neq|gt|gte|lt|lte|is|in|like|ilike|not|order)\(\s*['\"]([a-z_][a-z0-9_]*)['\"]")
KEY_RE = re.compile(r"^\s*([a-z_][a-z0-9_]*)\s*:", re.M)

problems = []
files = []
for base in ("apps/web/src", "apps/mobile/src", "packages/data/src", "packages/core/src"):
    for dirpath, _, filenames in os.walk(os.path.join(ROOT, base)):
        if "node_modules" in dirpath:
            continue
        for fn in filenames:
            if fn.endswith((".ts", ".tsx")) and not fn.endswith((".spec.ts", ".test.ts")):
                files.append(os.path.join(dirpath, fn))

for path in files:
    src = open(path, encoding="utf-8", errors="ignore").read()
    for m in FROM_RE.finditer(src):
        table = m.group(1)
        if table not in cols:
            problems.append((path, table, "TABELA INEXISTENTE", ""))
            continue
        window = src[m.end(): m.end() + 1400]
        # corta na próxima chamada .from() para não vazar entre queries
        nxt = FROM_RE.search(window)
        if nxt:
            window = window[: nxt.start()]
        # e corta na primeira linha em branco: cadeia de query é contígua, então
        # o que vem depois é outra coisa. Sem isto, as chaves de `logAction({
        # action, table })` e de `return { ok, error }` entram como se fossem
        # colunas — dezenove falsos positivos que afogam o sinal.
        corte = window.find("\n\n")
        if corte != -1:
            window = window[:corte]

        refs = set()
        for s in SELECT_RE.findall(window):
            refs.update(scan_select(s))
        refs.update(FILTER_RE.findall(window))

        # Chaves de objeto em insert/update/upsert.
        #
        # Do parêntese, pula até o PRIMEIRO `{` e casa as chaves balanceadas.
        # Exigir o literal colado ao parêntese perdia
        # `.insert(items.map(i => ({ ... })))` — foi por essa fresta que
        # `cost_center_id` sobreviveu a um DROP COLUMN. Varrer a janela inteira,
        # por outro lado, captura chave de objeto local (`ok`, `error`) e afoga
        # o sinal em ruído.
        for call in re.finditer(r"\.(?:insert|update|upsert)\(", window):
            # O literal precisa estar DENTRO dos parênteses da chamada. Buscar
            # o próximo `{` sem essa checagem escapava de `.update(parsed.data)`
            # e capturava o `return { ok, error }` das linhas seguintes.
            abre, paren, j = -1, 1, call.end()
            while j < len(window) and j < call.end() + 200:
                if window[j] == "(":
                    paren += 1
                elif window[j] == ")":
                    paren -= 1
                    if paren == 0:
                        break
                elif window[j] == "{":
                    abre = j
                    break
                j += 1
            if abre == -1:
                continue
            depth, i = 0, abre
            while i < len(window):
                if window[i] == "{":
                    depth += 1
                elif window[i] == "}":
                    depth -= 1
                    if depth == 0:
                        break
                i += 1
            body = window[abre + 1: i]
            body = re.sub(r"\{[^{}]*\}", "", body)  # ignora objetos aninhados
            refs.update(KEY_RE.findall(body))

        for r in sorted(refs):
            if r not in cols[table]:
                line = src[: m.start()].count("\n") + 1
                problems.append((os.path.relpath(path, ROOT), table, r, line))

print(f"arquivos varridos: {len(files)}\n")
if not problems:
    print("nenhuma referência a coluna inexistente")
    sys.exit(0)

por_tabela = {}
for path, table, col, line in problems:
    por_tabela.setdefault(table, []).append((col, path, line))

for table in sorted(por_tabela):
    print(f"── {table}")
    for col, path, line in sorted(set(por_tabela[table])):
        print(f"   {col:<34} {path}:{line}")
    print()
print(f"total: {len(problems)} referências suspeitas em {len(por_tabela)} tabelas")
