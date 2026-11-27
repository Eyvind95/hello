import concurrent.futures
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from starlette.testclient import TestClient
import galarchive_mcp_v004 as g

KEY = "ab" * 32
HEAD = {"X-GalArchive-Local-Key": KEY, "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-06-18"}

class HTTPTests(unittest.TestCase):
    def test_parallel_stateless_round_trips(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {
            "GALARCHIVE_ROOT": tmp, "GALARCHIVE_HTTP_KEY": KEY
        }):
            source = {"format":"gal-predecessor-chat", "version":1, "status":"completed",
                      "chatId":"test-http", "runId":"test-http-run", "count":1, "rows":[{"id":"u0","index":0,
                      "role":"user","text":"exact test text", "attachments":[]}]}
            raw = g.encode(source)
            Path(tmp, "source.json").write_bytes(raw)
            with TestClient(g.http_app(), base_url="http://127.0.0.1:18767") as c:
                def rpc(method, params, headers=HEAD, ident=1):
                    return c.post("/mcp", headers=headers, json={
                        "jsonrpc":"2.0","id":ident,"method":method,"params":params})
                def tool(name, args):
                    r = rpc("tools/call", {"name":name,"arguments":args})
                    self.assertEqual(r.status_code,200,r.text)
                    self.assertNotIn("mcp-session-id",r.headers)
                    return r.json()["result"]
                self.assertEqual(rpc("tools/list",{},{"Accept":HEAD["Accept"]}).status_code,403)
                self.assertEqual(rpc("tools/list",{},dict(HEAD, **{"X-GalArchive-Local-Key":"bad"})).status_code,403)
                self.assertEqual(c.get("/mcp",headers=HEAD).status_code,405)
                self.assertEqual(c.delete("/mcp",headers=HEAD).status_code,405)
                discovery = rpc("tools/list",{})
                self.assertEqual(discovery.status_code,200,discovery.text)
                self.assertEqual(len(discovery.json()["result"]["tools"]),11)
                def task(i):
                    # Two independent callers may initialize at any time, or call directly.
                    if i % 2 == 0:
                        r = rpc("initialize", {"protocolVersion":"2025-06-18","capabilities":{},
                                               "clientInfo":{"name":"test","version":"1"}})
                        self.assertEqual(r.status_code,200,r.text)
                        self.assertNotIn("mcp-session-id",r.headers)
                    read = tool("read_source_batch", {"relative_path":"source.json",
                        "expected_sha256":g.digest(raw)})
                    self.assertFalse(read.get("isError",False),read)
                    name = "worker-%d.json" % i
                    saved = tool("save_json",{"output_name":name,"json_text":"[%d]" % i})
                    self.assertFalse(saved.get("isError",False),saved)
                    reread = tool("sha256_file",{"relative_path":g.OUTPUT+"/"+name})
                    self.assertFalse(reread.get("isError",False),reread)
                    self.assertEqual(Path(tmp,g.OUTPUT,name).read_bytes(),g.encode([i]))
                with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                    list(pool.map(task,range(8)))
                bad = tool("save_json",{"output_name":"worker-0.json","json_text":"[999]"})
                self.assertTrue(bad.get("isError"),bad)
                self.assertEqual(Path(tmp,g.OUTPUT,"worker-0.json").read_bytes(),b"[0]")
                bad = tool("read_source_batch",{"relative_path":"source.json",
                         "expected_sha256":"0"*64})
                self.assertTrue(bad.get("isError"),bad)
                self.assertEqual(Path(tmp,"source.json").read_bytes(),raw)

if __name__ == "__main__":
    unittest.main()
