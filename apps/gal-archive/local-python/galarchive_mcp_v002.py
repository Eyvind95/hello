"""GalArchive-Python v0.0.2. Restricted local MCP, no shell or arbitrary code."""
from pathlib import Path, PureWindowsPath
import hashlib
import json
import os
import re
import sys
import tempfile

from mcp.server.fastmcp import FastMCP

VERSION = "0.0.2"
OUTPUT = "GPT-Python-Output"
MAX_FILE = 64 * 1024 * 1024
MAX_SAVE = 512 * 1024
MAX_BUNDLE = 128 * 1024 * 1024
FIELDS = ("pilotMessages", "quizLogs", "easterEggs", "casinoLogs", "realChatLogs", "rejectedEvents")
FORMAT = "gal-predecessor-cycle-overwrite"
BUNDLE = "gal-predecessor-import-bundle"
JOINED = "gal-predecessor-prefix-supplement-evidence"
MARKER = re.compile(r"(?:^|\n)[ \t]*(?:[\uFF08(][ \t]*)?(?:\u6211|\u4ed6)[ \t]*[\uFF1A:][ \t]*(?:[\uFF09)])?")
mcp = FastMCP("GalArchive-Python")


def require(ok, message):
    if not ok:
        raise ValueError(message)


def root():
    value = os.environ.get("GALARCHIVE_ROOT", "")
    require(bool(value), "GALARCHIVE_ROOT not configured")
    p = Path(value).resolve(strict=True)
    require(p.is_dir() and p.parent != p, "Invalid archive root")
    return p


def resolve(relative, directory=False):
    base = root()
    require(isinstance(relative, str), "Path must be a string")
    w = PureWindowsPath(relative)
    require(not w.drive and not w.root and not w.is_absolute(), "Use a relative archive path")
    parts = relative.replace("\\", "/").split("/") if relative else []
    require(all(p not in ("", ".", "..") and ":" not in p and not p.endswith((" ", ".")) for p in parts), "Unsafe relative path")
    p = base
    for part in parts:
        p = p / part
        require(not p.is_symlink() and not p.is_junction(), "Symbolic links and junctions are not allowed")
    p = p.resolve(strict=True)
    require(p.is_relative_to(base), "Path outside archive")
    if directory:
        require(p.is_dir(), "Not a directory")
    else:
        require(p.is_file() and p.suffix.lower() == ".json", "Only existing JSON files are allowed")
    return p


def raw_file(relative):
    p = resolve(relative)
    with p.open("rb") as f:
        data = f.read(MAX_FILE + 1)
    require(len(data) <= MAX_FILE, "JSON file exceeds 64 MiB")
    return data


def no_duplicates(pairs):
    result = {}
    for k, v in pairs:
        require(k not in result, "Duplicate JSON object key")
        result[k] = v
    return result


def parse(text):
    def bad_constant(_):
        raise ValueError("Non-finite JSON number")
    return json.loads(text.removeprefix("\ufeff"), object_pairs_hook=no_duplicates,
                      parse_constant=bad_constant)


def load(relative):
    return parse(raw_file(relative).decode("utf-8", errors="strict"))


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def output_json(name, value, maximum):
    require(isinstance(name, str) and 1 <= len(name) <= 160 and
            name.lower().endswith(".json") and not re.search(r'[<>:"/\\|?*\x00-\x1f]', name)
            and not name.endswith((" ", ".")) and not PureWindowsPath(name).is_reserved(),
            "Output must be a simple new JSON filename")
    data = encode(value)
    require(len(data) <= maximum, "Output too large")
    base = root()
    folder = base / OUTPUT
    require(not folder.is_symlink() and not folder.is_junction(), "Unsafe output folder")
    folder.mkdir(exist_ok=True)
    require(resolve(OUTPUT, True) == folder.resolve(), "Unsafe output folder")
    path = folder / name
    # Exclusive create: never overwrite an original or prior result.
    with path.open("xb") as f:
        f.write(data)
    with path.open("rb") as f:
        observed = f.read(maximum + 1)
    require(observed == data, "Read-back mismatch; inspect newly created output")
    return {"path": OUTPUT + "/" + name, "bytes": len(data), "sha256": digest(data), "readback": True}


def nonblank(x):
    return isinstance(x, str) and bool(x.strip())


def rows_map(rows, strict=False):
    require(isinstance(rows, list), "Invalid rows")
    result = {}
    for i, r in enumerate(rows):
        require(isinstance(r, dict) and nonblank(r.get("id")) and r["id"] not in result
                and type(r.get("index")) is int and r["index"] == i
                and r.get("role") in ("user", "assistant") and isinstance(r.get("text"), str)
                and isinstance(r.get("attachments"), list)
                and (not strict or isinstance(r.get("structure"), list)), "Invalid source row: " + str(i))
        result[r["id"]] = r
    return result


def source_view(s):
    require(isinstance(s, dict) and s.get("version") == 1 and nonblank(s.get("chatId"))
            and isinstance(s.get("rows"), list) and type(s.get("count")) is int
            and s["count"] == len(s["rows"]) and s["count"] > 0, "Invalid source structure")
    rows = s["rows"]
    if s.get("format") == JOINED:
        e, b, c = s.get("evidence"), s.get("base"), s.get("candidateRows")
        require(s.get("status") == "joined-evidence" and s.get("canonical") is False
                and s.get("importable") is False and s.get("continuity") is False
                and s.get("fidelity") == "rendered-dom" and "error" in s and s["error"] is None
                and nonblank(s.get("runId")) and isinstance(e, dict)
                and isinstance(b, dict) and isinstance(c, list), "Invalid joined evidence")
        require(e.get("openingVerified") is True and e.get("originalCheckpointUnchanged") is True
                and "lastConflict" in e and e["lastConflict"] is None and nonblank(e.get("expectedId"))
                and nonblank(b.get("firstId")) and nonblank(b.get("runId"))
                and isinstance(b.get("sha256"), str) and re.fullmatch(r"[0-9a-f]{64}", b["sha256"])
                and all(type(x) is int for x in (b.get("count"), e.get("added"), e.get("matched")))
                and e["added"] >= 1 and e["matched"] >= 2 and b["count"] >= e["matched"]
                and s["count"] == e["added"] + e["matched"] and len(c) == b["count"] + e["added"]
                and e.get("joinedCandidateCount") == len(c), "Invalid joined evidence counts")
        rows_map(rows, True)
        rows_map(c, True)
        require(c[0]["id"] == e["expectedId"] and c[0]["role"] == "user"
                and c[e["added"]]["id"] == b["firstId"] and rows == c[:len(rows)],
                "Joined evidence prefix mismatch")
        rows = c
    else:
        require(s.get("format") == "gal-predecessor-offline-reconciliation-candidate"
                or (s.get("format") == "gal-predecessor-chat" and s.get("status") == "completed"),
                "Only website-supported completed/evidence sources")
    mapping = rows_map(rows)
    allowed = {k: r for k, r in mapping.items() if
               r.get("identityBasis") != "unresolved-native-composite"
               and not k.startswith("assistant|composite:")
               and "compositeNative" not in r and "compositeHtml" not in r}
    return rows, allowed


def utf16_slice(text, start, end):
    raw = text.encode("utf-16-le", errors="strict")
    require(type(start) is int and type(end) is int and 0 <= start < end <= len(raw)//2,
            "Invalid UTF-16 excerpt range")
    return raw[2*start:2*end].decode("utf-16-le", errors="strict")


def excerpt(entry, row, field="text", range_field="rangeUtf16"):
    if range_field in entry:
        bounds = entry[range_field]
        require(isinstance(bounds, list) and len(bounds) == 2, "Expected [start,end] UTF-16 range")
        selected = utf16_slice(row["text"], *bounds)
        require(field not in entry or entry[field] == selected, "Text/range mismatch")
        return selected
    return entry.get(field)


def validate_pack(s, p, sha):
    rows, mapping = source_view(s)
    require(isinstance(p, dict) and p.get("format") == FORMAT and p.get("version") in (1, 2)
            and p.get("sourceSha256") == sha and p.get("chatId") == s["chatId"]
            and nonblank(p.get("manager")) and len(p["manager"].encode("utf-16-le"))//2 <= 180
            and isinstance(p.get("target"), dict) and all(nonblank(p["target"].get(k))
            for k in ("worldKey", "cycleId", "cycleTitle")), "Invalid pack header, SHA or target")
    require(p.get("version") == 2, "Build requires all six V2 sections")
    result = {k: p[k] for k in ("format", "version", "target", "sourceSha256", "chatId", "manager")}
    for field in FIELDS:
        entries = p.get(field)
        require(isinstance(entries, list), "Missing section: " + field)
        clean, last = [], -1
        for i, entry in enumerate(entries):
            require(isinstance(entry, dict), "Invalid entry: " + field)
            if field == "easterEggs":
                ids = entry.get("sourceIds")
                require(nonblank(entry.get("title")) and nonblank(entry.get("text"))
                        and entry.get("status") in ("confirmed", "uncertain")
                        and isinstance(ids, list) and len(ids) > 0
                        and all(isinstance(x, str) and x in mapping for x in ids)
                        and len(set(ids)) == len(ids), "Invalid easter egg: " + str(i))
                clean.append(entry)
                continue
            sid = entry.get("sourceId")
            require(isinstance(sid, str) and sid in mapping, "Missing source: " + field + "/" + str(i))
            row = mapping[sid]
            value = excerpt(entry, row)
            require(row["index"] > last and nonblank(value), "Duplicate/order/empty: " + field + "/" + str(i))
            allowed = row["text"]
            if field == "pilotMessages" and row["role"] == "user":
                match = MARKER.search(allowed)
                if match:
                    allowed = allowed[:match.start()]
                require(not MARKER.search(value), "Player plot marker is not copilot chat")
            require(value in allowed, "Text not in source: " + field + "/" + str(i))
            item = {"sourceId": sid, "text": value}
            if field == "rejectedEvents":
                did = entry.get("decisionSourceId")
                require(isinstance(did, str) and did in mapping and mapping[did]["role"] == "user",
                        "Rejected event requires player source")
                dt = excerpt(entry, mapping[did], "decisionText", "decisionRangeUtf16")
                require(nonblank(dt) and dt in mapping[did]["text"], "Invalid player decision excerpt")
                item.update(decisionSourceId=did, decisionText=dt)
                if "title" in entry:
                    require(nonblank(entry["title"]) and entry["title"] in row["text"], "Invalid event title")
                    item["title"] = entry["title"]
            clean.append(item)
            last = row["index"]
        result[field] = clean
    return result, {"sourceRows": len(rows), "excludedUnresolved": len(rows)-len(mapping),
                    "counts": {k: len(result[k]) for k in FIELDS}}


@mcp.tool()
def ping() -> str:
    """Check the local Python environment."""
    return "GalArchive-Python online: " + sys.version


@mcp.tool()
def sha256_text(text: str) -> str:
    """Calculate SHA-256 of UTF-8 text."""
    return digest(text.encode("utf-8"))


@mcp.tool()
def archive_status() -> dict:
    """Report tool version and archive access, without revealing secrets."""
    return {"version": VERSION, "python": sys.version.split()[0],
            "archive": root().name, "output": OUTPUT, "overwrite": False}


@mcp.tool()
def list_archive(relative_dir: str = "", offset: int = 0, limit: int = 50) -> dict:
    """List immediate JSON files and subfolders under the approved root; paginate."""
    p = resolve(relative_dir, True)
    require(0 <= offset and 1 <= limit <= 100, "Invalid pagination")
    children = sorted((x for x in p.iterdir() if not x.is_symlink() and not x.is_junction()
                       and (x.is_dir() or (x.is_file() and x.suffix.lower() == ".json"))),
                      key=lambda x: x.name.casefold())
    return {"total": len(children), "nextOffset": offset+limit if offset+limit < len(children) else None,
            "entries": [{"name": x.name, "directory": x.is_dir(),
                         "bytes": None if x.is_dir() else x.stat().st_size}
                        for x in children[offset:offset+limit]]}


@mcp.tool()
def sha256_file(relative_path: str) -> dict:
    """Hash original JSON bytes, without altering the file."""
    b = raw_file(relative_path)
    return {"bytes": len(b), "sha256": digest(b)}


@mcp.tool()
def inspect_json(relative_path: str) -> dict:
    """Validate JSON and report top-level keys, counts and SHA; not semantic validation."""
    b = raw_file(relative_path)
    x = parse(b.decode("utf-8", errors="strict"))
    result = {"bytes": len(b), "sha256": digest(b), "type": type(x).__name__}
    if isinstance(x, dict):
        result.update(keys=list(x), counts={k: len(v) for k, v in x.items() if isinstance(v, list)},
                      metadata={k: x[k] for k in ("format", "version", "status", "chatId", "target",
                                                 "manager", "sourceSha256") if k in x})
    elif isinstance(x, list):
        result["count"] = len(x)
    return result


@mcp.tool()
def read_json_text(relative_path: str, offset: int = 0, limit: int = 12000) -> dict:
    """Read bounded exact UTF-8 JSON text; offsets are Python Unicode code points, BOM retained."""
    text = raw_file(relative_path).decode("utf-8", errors="strict")
    require(0 <= offset <= len(text) and 1 <= limit <= 12000, "Invalid range")
    end = min(offset+limit, len(text))
    return {"text": text[offset:end], "offset": offset, "nextOffset": end if end < len(text) else None,
            "totalCharacters": len(text)}


@mcp.tool()
def read_source_row(relative_path: str, index: int, offset: int = 0, limit: int = 12000) -> dict:
    """Read one native source row, paginating long text by Unicode code-point offset."""
    rows, mapping = source_view(load(relative_path))
    require(0 <= index < len(rows), "Invalid source index")
    r = rows[index]
    t = r["text"]
    require(0 <= offset <= len(t) and 1 <= limit <= 12000, "Invalid range")
    end = min(offset+limit, len(t))
    return {"index": index, "id": r["id"], "role": r["role"], "sourceCreatedAt": r.get("sourceCreatedAt"),
            "attachmentCount": len(r["attachments"]), "eligible": r["id"] in mapping,
            "text": t[offset:end], "offset": offset, "nextOffset": end if end < len(t) else None,
            "totalCharacters": len(t)}


@mcp.tool()
def save_json(output_name: str, json_text: str) -> dict:
    """Save a new JSON candidate or fragment in GPT-Python-Output only. Never overwrites."""
    require(len(json_text.encode("utf-8")) <= MAX_SAVE, "Fragment exceeds 512 KiB; split into parts")
    return output_json(output_name, parse(json_text), MAX_SAVE)


@mcp.tool()
def build_bundle(source_path: str, base_pack_path: str, output_name: str,
                 section_parts: dict[str, list[str]] | None = None) -> dict:
    """Build V2 bundle from local source and a base pack. Omitted sections preserve base.
    For each supplied section, replace it with concatenated JSON array fragments in supplied order;
    [] explicitly sets that section empty. Fragments accept sourceId/text or sourceId/rangeUtf16.
    Verifies exact source excerpts and original SHA. Does not verify live website or semantic choices."""
    raw = raw_file(source_path)
    source_text = raw.decode("utf-8", errors="strict")
    source = parse(source_text)
    p = load(base_pack_path)
    require(isinstance(p, dict) and p.get("format") == FORMAT and p.get("version") in (1, 2),
            "Expected a V1/V2 base pack")
    p = dict(p)
    p["version"] = 2
    for field, paths in (section_parts or {}).items():
        require(field in FIELDS and isinstance(paths, list) and len(paths) <= 200, "Invalid section parts")
        combined = []
        for path in paths:
            part = load(path)
            require(isinstance(part, list), "Fragment must be a JSON array")
            combined.extend(part)
        p[field] = combined
    clean, checks = validate_pack(source, p, digest(raw))
    bundle = {"format": BUNDLE, "version": 1, "sourceText": source_text, "pack": clean}
    result = output_json(output_name, bundle, MAX_BUNDLE)
    # Read-back bytes were checked before returning. Original bytes are encoded exactly.
    return {**result, **checks, "sourceSha256": digest(raw),
            "target": clean["target"], "semanticReview": "not certified", "liveWebsite": "not tested"}


def self_test():
    with tempfile.TemporaryDirectory(prefix="galarchive-python-test-") as temp:
        os.environ["GALARCHIVE_ROOT"] = temp
        p = Path(temp)
        rows = [{"id":"u0","index":0,"role":"user","text":"event: storm","attachments":[]},
                {"id":"u1","index":1,"role":"user","text":"decline storm","attachments":[]},
                {"id":"a2","index":2,"role":"assistant","text":"\U0001f642 casino chat","attachments":[]}]
        source = {"format":"gal-predecessor-chat","version":1,"status":"completed","chatId":"test","count":3,"rows":rows}
        raw = b"\xef\xbb\xbf" + encode(source) + b"\r\n"
        (p/"source.json").write_bytes(raw)
        pack = {"format":FORMAT,"version":1,"target":{"worldKey":"test","cycleId":"test","cycleTitle":"test"},
                "chatId":"test","manager":"test","sourceSha256":digest(raw),
                "pilotMessages":[{"sourceId":"a2","text":"chat"}],"quizLogs":[],"easterEggs":[]}
        (p/"pack.json").write_bytes(encode(pack))
        save_json("casino.json",json.dumps([{"sourceId":"a2","rangeUtf16":[3,9]}]))
        save_json("events.json",json.dumps([{"sourceId":"u0","text":"event: storm","title":"storm",
                                            "decisionSourceId":"u1","decisionText":"decline storm"}]))
        sections = {"casinoLogs":[OUTPUT+"/casino.json"],"realChatLogs":[],
                    "rejectedEvents":[OUTPUT+"/events.json"]}
        result = build_bundle("source.json","pack.json","bundle.json",sections)
        bundle = parse((p/OUTPUT/"bundle.json").read_text(encoding="utf-8"))
        assert bundle["sourceText"].encode("utf-8") == raw
        assert bundle["pack"]["casinoLogs"][0]["text"] == "casino"
        assert result["counts"]["rejectedEvents"] == 1 and (p/"source.json").read_bytes() == raw
        assert sha256_text("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        for check in (lambda: resolve("../outside.json"), lambda: resolve("C:/outside.json"),
                      lambda: save_json("casino.json","[]"),
                      lambda: build_bundle("source.json","pack.json","missing.json",{}),
                      lambda: save_json("../bad.json","[]"),
                      lambda: save_json("invalid.json",'{"a":1,"a":2}')):
            try:
                check()
            except (ValueError, OSError):
                pass
            else:
                raise AssertionError("Unsafe operation unexpectedly accepted")
        print("GalArchive-Python 0.0.2 self-test PASS (synthetic; no archive files modified)")


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        self_test()
    elif not sys.argv[1:]:
        root()
        mcp.run(transport="stdio")
    else:
        raise SystemExit("Unsupported arguments")
