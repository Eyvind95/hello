"""GalArchive-Python v0.0.5. Restricted local MCP, no shell or arbitrary code."""
from pathlib import Path, PureWindowsPath
import hashlib
import hmac
import time
import json
import os
import re
import sys
import tempfile
import threading
from collections import OrderedDict

from mcp.server.fastmcp import FastMCP

VERSION = "0.0.5"
OUTPUT = "GPT-Python-Output"
MAX_FILE = 64 * 1024 * 1024
MAX_SAVE = 512 * 1024
MAX_BUNDLE = 128 * 1024 * 1024
FIELDS = ("pilotMessages", "quizLogs", "easterEggs", "casinoLogs", "realChatLogs", "rejectedEvents")
FORMAT = "gal-predecessor-cycle-overwrite"
BUNDLE = "gal-predecessor-import-bundle"
JOINED = "gal-predecessor-prefix-supplement-evidence"
MARKER = re.compile(r"(?:^|\n)[ \t]*(?:[\uFF08(][ \t]*)?(?:\u6211|\u4ed6)[ \t]*[\uFF1A:][ \t]*(?:[\uFF09)])?")
mcp = FastMCP("GalArchive-Python", stateless_http=True, json_response=True, host="127.0.0.1", port=18767)


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
            "archive": root().name, "output": OUTPUT, "overwrite": False,
            "transport": "stateless-http" if sys.argv[1:] == ["--http"] else "stdio"}


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



# Only the new, read-only archaeology endpoint uses this cache.
# Cache is per server process, not a cross-session lock or platform quota bypass.
_BATCH_CACHE = OrderedDict()
_BATCH_LOCK = threading.RLock()
_BATCH_CACHE_LIMIT = 2
_BATCH_RAW_LIMIT = 128 * 1024 * 1024


def _stamp(p):
    st = p.stat()
    return (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns)


def _batch_source(relative, expected_sha256, view):
    require(isinstance(expected_sha256, str) and re.fullmatch(r"[0-9a-f]{64}", expected_sha256),
            "Expected original SHA-256 required")
    require(view in ("rows", "candidateRows"), "Invalid explicit source view")
    with _BATCH_LOCK:
        p = resolve(relative)
        before = _stamp(p)
        key = (str(p), expected_sha256, view)
        saved = _BATCH_CACHE.get(key)
        if saved and saved[0] == before:
            _BATCH_CACHE.move_to_end(key)
            return saved[1], True
        # Drop every cached view for a changed file before reading.
        for k in list(_BATCH_CACHE):
            if k[0] == str(p) and _BATCH_CACHE[k][0] != before:
                del _BATCH_CACHE[k]
        raw = raw_file(relative)
        require(_stamp(p) == before and len(raw) == before[2], "Source changed during read")
        require(digest(raw) == expected_sha256, "Original SHA-256 mismatch")
        x = parse(raw.decode("utf-8", errors="strict"))
        require(isinstance(x, dict) and x.get("version") == 1 and nonblank(x.get("chatId"))
                and nonblank(x.get("runId")), "Invalid archaeology source identity")
        fmt, status = x.get("format"), x.get("status")
        require((fmt == "gal-predecessor-chat" and status in ("completed", "failed") and view == "rows")
                or (fmt == JOINED and status in ("joined-evidence", "joined-observed-prefix")
                    and x.get("canonical") is False and x.get("importable") is False),
                "Unsupported archaeology view; no implied import approval")
        raw_rows = x.get(view)
        require(isinstance(raw_rows, list) and bool(raw_rows), "Missing source rows")
        expected = x.get("count") if view == "rows" else (x.get("evidence") or {}).get("joinedCandidateCount")
        require(type(expected) is int and expected == len(raw_rows), "Source view count mismatch")
        rows_map(raw_rows)
        rows = []
        for r in raw_rows:
            t = r["text"]
            isolated = (r.get("identityBasis") == "unresolved-native-composite"
                        or r["id"].startswith("assistant|composite:")
                        or "compositeNative" in r or "compositeHtml" in r)
            rows.append({"id": r["id"], "index": r["index"], "role": r["role"],
                         "sourceCreatedAt": r.get("sourceCreatedAt"), "attachmentCount": len(r["attachments"]),
                         "isolated": isolated, "text": t, "totalCharacters": len(t),
                         "utf16Count": len(t.encode("utf-16-le", errors="strict"))//2,
                         "textSha256": digest(t.encode("utf-8", errors="strict"))})
        source = {"chatId": x["chatId"], "runId": x["runId"], "format": fmt, "status": status,
                  "view": view, "count": len(rows), "sourceSha256": expected_sha256,
                  "canonical": False, "importable": False, "reviewOnly": True,
                  "trueOpeningUnverified": status == "joined-observed-prefix"}
        require(_stamp(p) == before, "Source changed during parse")
        record = {"source": source, "rows": rows}
        _BATCH_CACHE[key] = (before, record)
        _BATCH_CACHE.move_to_end(key)
        while (len(_BATCH_CACHE) > _BATCH_CACHE_LIMIT
               or sum(v[0][2] for v in _BATCH_CACHE.values()) > _BATCH_RAW_LIMIT):
            _BATCH_CACHE.popitem(last=False)
        return record, False


@mcp.tool()
def read_source_batch(relative_path: str, expected_sha256: str, start_index: int = 0,
                      start_offset: int = 0, max_rows: int = 20,
                      max_bytes: int = 32768, view: str = "rows") -> dict:
    """Read exact original text and full-row SHA/UTF-16 counts in bounded batches.
    Cursor offset is Unicode code points; ranges are both UTF-16 and code points.
    Explicit candidateRows is archaeology-only, never a verified join/import.
    Cache hits rely on unchanged file metadata and immutable source contract.
    Use returned next cursor; do not skip or infer omitted text."""
    require(type(max_rows) is int and 1 <= max_rows <= 30
            and type(max_bytes) is int and 8192 <= max_bytes <= 49152, "Invalid batch limits")
    data, hit = _batch_source(relative_path, expected_sha256, view)
    rows = data["rows"]
    require(type(start_index) is int and 0 <= start_index <= len(rows)
            and type(start_offset) is int and start_offset >= 0, "Invalid cursor")
    require((start_index == len(rows) and start_offset == 0)
            or (start_index < len(rows) and (start_offset < rows[start_index]["totalCharacters"]
                 or (start_offset == 0 and rows[start_index]["totalCharacters"] == 0))),
            "Invalid offset")
    out = {"source": data["source"], "cacheHit": hit, "rows": [],
           "next": None if start_index == len(rows) else {"index": start_index, "offset": start_offset}}
    i, pos = start_index, start_offset
    while i < len(rows) and len(out["rows"]) < max_rows:
        r = rows[i]
        t = r["text"]
        u0 = len(t[:pos].encode("utf-16-le"))//2
        def trial(end):
            piece = t[pos:end]
            item = {**{k: v for k, v in r.items() if k != "text"}, "text": piece,
                    "rangeCodePoint": [pos, end], "rangeUtf16": [u0, u0+len(piece.encode("utf-16-le"))//2],
                    "completeRow": pos == 0 and end == len(t)}
            next_i, next_pos = (i+1, 0) if end == len(t) else (i, end)
            cursor = None if next_i == len(rows) else {"index": next_i, "offset": next_pos}
            proposed = {**out, "rows": out["rows"] + [item], "next": cursor}
            return proposed, next_i, next_pos
        low, high = pos if not t else pos+1, min(len(t), pos+12000)
        best = None
        while low <= high:
            mid = (low+high)//2
            proposed, ni, np = trial(mid)
            if len(encode(proposed)) <= max_bytes:
                best = (proposed, ni, np)
                low = mid+1
            else:
                high = mid-1
        if best is None:
            require(bool(out["rows"]), "Single row metadata exceeds batch budget")
            break
        out, i, pos = best
        # Long row pages stay contiguous; do not emit multiple chunks of one row per response.
        if pos:
            break
    require(len(encode(out)) <= max_bytes, "Batch exceeds encoded budget")
    return out


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



# Live self-recording is an independent, append-only source layer. It does not
# validate ChatGPT delivery, promote archaeology, or touch website/Firebase data.
import base64
import binascii
from datetime import datetime, timezone, timedelta
import uuid

LIVE = "GPT-Live-Archive"
LIVE_FORMAT = "gal-predecessor-live-turn"
MAX_LIVE = 1024 * 1024
MAX_IMAGE = 8 * 1024 * 1024
LIVE_LOCK = threading.RLock()
LIVE_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
LIVE_NAME = re.compile(r"([0-9]{8})-(" + LIVE_UUID + r")\.json")
HASH_RE = re.compile(r"[0-9a-f]{64}")
IMAGE_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}

def live_now():
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="milliseconds")

def owner_key(value):
    require(isinstance(value, str) and re.fullmatch(r"[a-z][a-z0-9-]{0,47}", value) is not None
            and not PureWindowsPath(value).is_reserved(), "Invalid predecessor ID")
    return value

def local_uuid(value):
    require(isinstance(value, str) and re.fullmatch(LIVE_UUID, value) is not None
            and str(uuid.UUID(value)) == value, "Use a stable lowercase UUID for local identity")
    return value

def hash_value(value):
    require(isinstance(value, str) and HASH_RE.fullmatch(value) is not None, "Invalid SHA-256")
    return value

def safe_live_dir(*parts):
    p = root()
    for part in (LIVE, *parts):
        require(isinstance(part, str) and part not in ("", ".", "..") and
                not re.search(r'[<>:"/\\|?*\x00-\x1f]', part)
                and not part.endswith((" ", ".")) and not PureWindowsPath(part).is_reserved(),
                "Unsafe live path")
        p = p / part
        require(not p.is_symlink() and not p.is_junction(), "Unsafe live directory")
        p.mkdir(exist_ok=True)
        require(p.is_dir() and not p.is_symlink() and not p.is_junction()
                and p.resolve().is_relative_to(root()), "Unsafe live directory")
    return p

def live_read(path, limit):
    require(path.is_file() and not path.is_symlink() and not path.is_junction()
            and path.resolve().is_relative_to(root()), "Unsafe or missing live file")
    with path.open("rb") as f:
        raw = f.read(limit + 1)
    require(len(raw) <= limit, "Live file exceeds limit")
    return raw

def live_publish(path, data, limit):
    # Publish only complete bytes. Windows rename refuses existing destinations;
    # POSIX hard link is atomic and fails on an existing name. Do not fall back
    # to non-atomic overwrite if the private Drive volume lacks support.
    require(len(data) <= limit and path.parent.is_dir()
            and not path.parent.is_symlink() and not path.parent.is_junction()
            and path.parent.resolve().is_relative_to(root()), "Unsafe live output")
    require(not path.exists() and not path.is_symlink(), "Live output already exists")
    fd, temp = tempfile.mkstemp(prefix=".live-", suffix=".tmp", dir=path.parent)
    t = Path(temp)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        require(t.read_bytes() == data, "Temporary write mismatch")
        if os.name == "nt":
            os.rename(t, path)
        else:
            os.link(t, path)
        require(live_read(path, limit) == data, "Published read-back mismatch")
    finally:
        t.unlink(missing_ok=True)

def live_json(path):
    raw = live_read(path, MAX_LIVE)
    value = parse(raw.decode("utf-8", errors="strict"))
    require(isinstance(value, dict), "Invalid live object")
    return value, raw

def live_metadata(predecessor_id, generation_id):
    owner_key(predecessor_id)
    local_uuid(generation_id)
    path = safe_live_dir("generations") / (generation_id + ".json")
    m, raw = live_json(path)
    require(m.get("format") == "gal-predecessor-live-generation" and
            m.get("predecessorId") == predecessor_id and m.get("generationId") == generation_id,
            "Generation does not belong to this predecessor")
    return m, digest(raw)

def turn_folder(predecessor_id, generation_id):
    live_metadata(predecessor_id, generation_id)
    return safe_live_dir("predecessors", predecessor_id, generation_id, "turns")

def turn_files(folder):
    found = []
    ids = set()
    for p in sorted(folder.glob("*.json")):
        m = LIVE_NAME.fullmatch(p.name)
        require(m is not None and not p.is_symlink() and not p.is_junction(),
                "Unexpected live turn filename")
        require(int(m.group(1)) == len(found) + 1 and m.group(2) not in ids,
                "Live sequence gap or duplicate turn ID")
        ids.add(m.group(2))
        found.append((p, m.group(2)))
    return found

def read_turn(item, owner, generation, sequence):
    p, ident = item
    value, raw = live_json(p)
    require(value.get("format") == LIVE_FORMAT and value.get("version") == 1
            and value.get("predecessorId") == owner and value.get("generationId") == generation
            and value.get("sequence") == sequence and value.get("turnId") == ident
            and value.get("canonical") is False and value.get("provenance") == "assistant-self-recorded"
            and isinstance(value.get("request"), dict), "Invalid live turn identity")
    require(value["request"].get("turnId") == ident, "Invalid request identity")
    return value, raw

def optional_time(value):
    if value is None:
        return None
    require(isinstance(value, str) and len(value) <= 50
            and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", value),
            "Timestamp must be ISO-8601 with offset")
    t = datetime.fromisoformat(value.replace("Z", "+00:00"))
    require(t.tzinfo is not None, "Timestamp must have offset")
    return value

def optional_id(value):
    require(value is None or (isinstance(value, str) and 0 < len(value) <= 256
                              and not re.search(r"[\x00-\x1f\x7f]", value)), "Invalid reported source ID")
    return value

@mcp.tool()
def begin_live_generation(predecessor_id: str, generation_id: str, chat_id: str | None = None,
                          parent_generation_id: str | None = None,
                          parent_turn_sha256: str | None = None) -> dict:
    """Register a stable local UUID under one predecessor; optional reported native chat ID.
    An optional parent link must identify a real saved turn from the same predecessor.
    Same registration is idempotent. Shared connector is not per-predecessor authentication."""
    owner_key(predecessor_id)
    local_uuid(generation_id)
    optional_id(chat_id)
    require((parent_generation_id is None) == (parent_turn_sha256 is None),
            "Parent generation and turn hash must be supplied together")
    request = {"predecessorId": predecessor_id, "generationId": generation_id,
               "reportedChatId": chat_id, "parentGenerationId": parent_generation_id,
               "parentTurnSha256": parent_turn_sha256}
    with LIVE_LOCK:
        path = safe_live_dir("generations") / (generation_id + ".json")
        if path.exists():
            m, raw = live_json(path)
            require(m.get("format") == "gal-predecessor-live-generation"
                    and all(m.get(k) == v for k, v in request.items()), "Generation registration conflict")
            return {"generationId": generation_id, "sha256": digest(raw), "idempotent": True,
                    "readback": True, "serverTime": live_now()}
        if parent_generation_id is not None:
            require(parent_generation_id != generation_id, "Self parent")
            hash_value(parent_turn_sha256)
            parent = turn_files(turn_folder(predecessor_id, parent_generation_id))
            require(any(digest(read_turn(item, predecessor_id, parent_generation_id, i+1)[1])
                        == parent_turn_sha256 for i, item in enumerate(parent)), "Parent turn not found")
        m = {"format": "gal-predecessor-live-generation", "version": 1, **request,
             "createdAt": live_now(), "canonical": False, "importable": False,
             "provenance": "assistant-self-recorded"}
        data = encode(m)
        live_publish(path, data, MAX_LIVE)
        return {"generationId": generation_id, "sha256": digest(data), "idempotent": False,
                "readback": True, "serverTime": live_now()}

@mcp.tool()
def get_live_checkpoint(predecessor_id: str, generation_id: str) -> dict:
    """Return a server-clock observation, last saved turn hash and next sequence.
    This checks filename continuity and the tail, not a complete chain audit or Drive sync."""
    with LIVE_LOCK:
        folder = turn_folder(predecessor_id, generation_id)
        files = turn_files(folder)
        _, gen_hash = live_metadata(predecessor_id, generation_id)
        result = {"predecessorId": predecessor_id, "generationId": generation_id,
                  "generationSha256": gen_hash, "count": len(files), "nextSequence": len(files)+1,
                  "lastTurnSha256": None, "lastTurnId": None,
                  "serverTime": live_now(), "timezone": "Asia/Taipei",
                  "validation": "filename-contiguity-and-tail", "cloudSync": "not-verified"}
        if files:
            value, raw = read_turn(files[-1], predecessor_id, generation_id, len(files))
            result.update(lastTurnSha256=digest(raw), lastTurnId=value["turnId"],
                          lastPreparedReplySha256=digest(value["request"]["assistantText"].encode("utf-8")),
                          lastReplyState="prepared-not-delivery-verified")
        return result

def image_signature(data, mime):
    if mime == "image/png":
        return len(data) >= 24 and data.startswith(b"\x89PNG\r\n\x1a\n") and data[12:16] == b"IHDR"
    if mime == "image/jpeg":
        return len(data) >= 4 and data.startswith(b"\xff\xd8\xff") and data.endswith(b"\xff\xd9")
    if mime == "image/gif":
        return len(data) >= 13 and data[:6] in (b"GIF87a", b"GIF89a")
    if mime == "image/webp":
        return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    return False

@mcp.tool()
def save_live_image(predecessor_id: str, generation_id: str, mime_type: str,
                    image_base64: str | None = None, inbox_name: str | None = None) -> dict:
    """Save caller-provided actual image bytes (PNG/JPEG/WebP/GIF, up to 8 MiB).
    Supply exact base64 or an existing simple filename in that generation's private inbox.
    No arbitrary paths, external URLs, image reconstruction, or automatic ChatGPT attachment access."""
    require(mime_type in IMAGE_EXT and (image_base64 is None) != (inbox_name is None),
            "Supply one supported image byte source")
    with LIVE_LOCK:
        live_metadata(predecessor_id, generation_id)
        if inbox_name is not None:
            require(isinstance(inbox_name, str) and 1 <= len(inbox_name) <= 160 and
                    not re.search(r'[<>:"/\\|?*\x00-\x1f]', inbox_name)
                    and not inbox_name.endswith((" ", ".")) and not PureWindowsPath(inbox_name).is_reserved()
                    and Path(inbox_name).suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".gif"),
                    "Use a simple image inbox filename")
            raw = live_read(safe_live_dir("predecessors", predecessor_id, generation_id, "inbox")
                            / inbox_name, MAX_IMAGE)
        else:
            require(isinstance(image_base64, str) and len(image_base64) <= ((MAX_IMAGE+2)//3)*4,
                    "Base64 exceeds image limit")
            try:
                raw = base64.b64decode(image_base64, validate=True)
            except (ValueError, binascii.Error) as exc:
                raise ValueError("Invalid image base64") from exc
        require(0 < len(raw) <= MAX_IMAGE and image_signature(raw, mime_type),
                "Image size or signature does not match")
        sha = digest(raw)
        name = sha + "." + IMAGE_EXT[mime_type]
        path = safe_live_dir("predecessors", predecessor_id, generation_id, "images") / name
        if path.exists():
            require(live_read(path, MAX_IMAGE) == raw, "Image hash or stored bytes conflict")
            reused = True
        else:
            live_publish(path, raw, MAX_IMAGE)
            reused = False
        return {"sha256": sha, "bytes": len(raw), "mimeType": mime_type,
                "path": "/".join((LIVE, "predecessors", predecessor_id, generation_id, "images", name)),
                "status": "saved", "readback": True, "idempotent": reused,
                "provenance": "caller-provided-bytes", "cloudSync": "not-verified",
                "validation": "byte-readback-and-magic-signature"}

def check_attachments(attachments, owner, generation):
    require(isinstance(attachments, list) and len(attachments) <= 100, "Invalid attachments")
    seen = set()
    for a in attachments:
        require(isinstance(a, dict) and a.get("role") in ("user", "assistant")
                and type(a.get("ordinal")) is int and 0 <= a["ordinal"] < 100
                and (a["role"], a["ordinal"]) not in seen, "Invalid attachment position")
        seen.add((a["role"], a["ordinal"]))
        if a.get("status") == "pending":
            require(set(a) == {"role", "ordinal", "status", "reason"}
                    and isinstance(a["reason"], str) and 0 < len(a["reason"]) <= 512,
                    "Pending attachment must state why bytes are unavailable")
        else:
            require(set(a) == {"role", "ordinal", "status", "sha256", "mimeType", "bytes"}
                    and a.get("status") == "saved" and a.get("mimeType") in IMAGE_EXT
                    and type(a.get("bytes")) is int and 0 < a["bytes"] <= MAX_IMAGE,
                    "Invalid saved attachment reference")
            sha = hash_value(a["sha256"])
            path = safe_live_dir("predecessors", owner, generation, "images") / (sha+"."+IMAGE_EXT[a["mimeType"]])
            raw = live_read(path, MAX_IMAGE)
            require(len(raw) == a["bytes"] and digest(raw) == sha and image_signature(raw, a["mimeType"]),
                    "Saved attachment bytes mismatch")
    for role in ("user", "assistant"):
        ordinals = sorted(a["ordinal"] for a in attachments if a["role"] == role)
        require(ordinals == list(range(len(ordinals))), "Attachment ordinal gap")
    return attachments

@mcp.tool()
def append_live_turn(predecessor_id: str, generation_id: str, turn_id: str,
                     previous_sha256: str | None, player_text: str, assistant_text: str,
                     attachments: list[dict] | None = None,
                     player_observed_at: str | None = None,
                     reply_prepared_at: str | None = None,
                     player_source_time: str | None = None,
                     assistant_source_time: str | None = None,
                     previous_reply_text: str | None = None) -> dict:
    """Save one complete player message and prepared assistant reply in an immutable JSON.
    Retry with exactly the same local turn UUID and payload. Require last checkpoint SHA
    (null only for the first turn). Timestamps supplied by callers are reported, not verified.
    Images are saved references or explicit pending entries. Previous reply text, if known,
    is assistant-reported observation, never proof of platform delivery."""
    local_uuid(turn_id)
    if previous_sha256 is not None:
        hash_value(previous_sha256)
    require(isinstance(player_text, str) and isinstance(assistant_text, str)
            and (previous_reply_text is None or isinstance(previous_reply_text, str)), "Text must be exact strings")
    for t in (player_observed_at, reply_prepared_at, player_source_time, assistant_source_time):
        optional_time(t)
    with LIVE_LOCK:
        folder = turn_folder(predecessor_id, generation_id)
        files = turn_files(folder)
        if attachments is None:
            attachments = []
        check_attachments(attachments, predecessor_id, generation_id)
        request = {"turnId": turn_id, "previousSha256": previous_sha256,
                   "playerText": player_text, "assistantText": assistant_text, "attachments": attachments,
                   "playerObservedAt": player_observed_at, "replyPreparedAt": reply_prepared_at,
                   "reportedPlayerSourceTime": player_source_time, "reportedAssistantSourceTime": assistant_source_time,
                   "previousReplyText": previous_reply_text}
        # A retry must not change a prior payload, even if other turns have been added.
        for i, item in enumerate(files):
            if item[1] == turn_id:
                value, raw = read_turn(item, predecessor_id, generation_id, i+1)
                require(value["request"] == request, "Turn ID already used with different content")
                return {"sequence": i+1, "turnId": turn_id, "sha256": digest(raw), "bytes": len(raw),
                        "idempotent": True, "readback": True, "cloudSync": "not-verified",
                        "replyState": "prepared-not-delivery-verified"}
        previous = None
        if files:
            previous, raw = read_turn(files[-1], predecessor_id, generation_id, len(files))
            require(previous_sha256 == digest(raw), "Stale or wrong checkpoint; read checkpoint and reconcile")
        else:
            require(previous_sha256 is None and previous_reply_text is None, "First turn has no predecessor")
        obs = None
        if previous_reply_text is not None:
            obs = {"turnId": previous["turnId"], "basis": "assistant-reported-visible-text",
                   "matchesPrepared": previous_reply_text == previous["request"]["assistantText"],
                   "sha256": digest(previous_reply_text.encode("utf-8"))}
        sequence = len(files)+1
        require(sequence <= 99999999, "Live sequence limit reached")
        _, gen_hash = live_metadata(predecessor_id, generation_id)
        value = {"format": LIVE_FORMAT, "version": 1, "predecessorId": predecessor_id,
                 "generationId": generation_id, "generationSha256": gen_hash,
                 "turnId": turn_id, "sequence": sequence, "previousSha256": previous_sha256,
                 "provenance": "assistant-self-recorded", "canonical": False, "importable": False,
                 "savedAt": live_now(), "timezone": "Asia/Taipei",
                 "timeBasis": {"savedAt": "local-server-clock-before-commit",
                               "otherTimes": "caller-reported-not-platform-verified"},
                 "replyState": "prepared-not-delivery-verified",
                 "previousReplyObservation": obs, "request": request}
        data = encode(value)
        path = folder / ("%08d-%s.json" % (sequence, turn_id))
        live_publish(path, data, MAX_LIVE)
        return {"sequence": sequence, "turnId": turn_id, "sha256": digest(data), "bytes": len(data),
                "path": "/".join((LIVE, "predecessors", predecessor_id, generation_id, "turns", path.name)),
                "idempotent": False, "readback": True, "cloudSync": "not-verified",
                "replyState": "prepared-not-delivery-verified", "readbackAt": live_now(),
                "pendingAttachments": sum(a["status"] == "pending" for a in attachments)}


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
        print("GalArchive-Python 0.0.5 self-test PASS (synthetic; no archive files modified)")



# An HTTP request does not inherit another caller's initialization state.
# Keep the endpoint local and require a separate random local credential.
# Never log request bodies, headers, paths, archive data or credentials.
HTTP_PORT = 18767

def http_app():
    from starlette.responses import JSONResponse
    key = os.environ.get("GALARCHIVE_HTTP_KEY", "")
    require(bool(re.fullmatch(r"[0-9a-f]{64}", key)), "Configure a 32-byte random hex GALARCHIVE_HTTP_KEY")
    app = mcp.streamable_http_app()
    async def guarded(scope, receive, send):
        if scope["type"] != "http":
            await app(scope, receive, send)
            return
        supplied = [v for k, v in scope["headers"] if k.lower() == b"x-galarchive-local-key"]
        if len(supplied) != 1 or not hmac.compare_digest(supplied[0], key.encode("ascii")):
            await JSONResponse({"error":"Forbidden"}, status_code=403)(scope, receive, send)
            return
        if scope["path"] != "/mcp":
            await JSONResponse({"error":"Not found"}, status_code=404)(scope, receive, send)
            return
        if scope["method"] != "POST":
            await JSONResponse({"error":"Stateless JSON POST only"}, status_code=405,
                               headers={"Allow":"POST"})(scope, receive, send)
            return
        started = time.monotonic()
        status = 0
        async def observed(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)
        try:
            await app(scope, receive, observed)
        finally:
            print("galarchive_http pid=%d status=%d elapsed_ms=%d" %
                  (os.getpid(), status, int((time.monotonic()-started)*1000)), file=sys.stderr, flush=True)
    return guarded

def run_http():
    import uvicorn
    root()
    uvicorn.run(http_app(), host="127.0.0.1", port=HTTP_PORT, workers=1,
                proxy_headers=False, access_log=False)

if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        self_test()
    elif sys.argv[1:] == ["--http"]:
        run_http()
    elif not sys.argv[1:]:
        root()
        mcp.run(transport="stdio")
    else:
        raise SystemExit("Unsupported arguments")
