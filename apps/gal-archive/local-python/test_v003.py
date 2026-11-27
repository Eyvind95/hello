import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import galarchive_mcp_v003 as m


class BatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"GALARCHIVE_ROOT": self.temp.name})
        self.env.start()
        m._BATCH_CACHE.clear()
        self.p = Path(self.temp.name)
        self.rows = [
            {"id": f"fixture-{i}", "index": i, "role": "user" if i % 2 == 0 else "assistant",
             "text": t, "attachments": [], "structure": []}
            for i, t in enumerate(["first", "長😀\n" * 18000, "", "last", "other"])
        ]
        self.src = {"format": "gal-predecessor-chat", "version": 1, "status": "completed",
                    "chatId": "fixture-chat", "runId": "fixture-run",
                    "count": len(self.rows), "rows": self.rows}
        self.sha = self.write("source.json", self.src)

    def tearDown(self):
        m._BATCH_CACHE.clear()
        self.env.stop()
        self.temp.cleanup()

    def write(self, name, value):
        b = b"\xef\xbb\xbf" + m.encode(value) + b"\r\n"
        (self.p / name).write_bytes(b)
        return m.digest(b)

    def test_exact_pagination_and_bounded_payload(self):
        received = [[] for _ in self.rows]
        cursor = {"index": 0, "offset": 0}
        calls = 0
        while cursor is not None:
            out = m.read_source_batch("source.json", self.sha, cursor["index"], cursor["offset"],
                                      max_rows=3, max_bytes=8192)
            self.assertLessEqual(len(m.encode(out)), 8192)
            self.assertEqual(out["cacheHit"], calls > 0)
            self.assertFalse(out["source"]["importable"])
            for row in out["rows"]:
                i = row["index"]
                s = self.rows[i]["text"]
                a,b = row["rangeCodePoint"]
                u,v = row["rangeUtf16"]
                self.assertEqual(row["text"], s[a:b])
                self.assertEqual(u, len(s[:a].encode("utf-16-le"))//2)
                self.assertEqual(v, len(s[:b].encode("utf-16-le"))//2)
                self.assertEqual(row["textSha256"], m.digest(s.encode()))
                self.assertEqual(row["totalCharacters"], len(s))
                self.assertEqual(a, sum(len(x) for x in received[i]))
                received[i].append(row["text"])
            cursor = out["next"]
            calls += 1
            self.assertLess(calls, 100)
        self.assertEqual(["".join(x) for x in received], [r["text"] for r in self.rows])
        self.assertTrue(received[2], "empty row must be emitted")

    def test_cache_one_read_then_invalidates_on_mutation(self):
        with patch.object(m, "raw_file", wraps=m.raw_file) as read:
            m.read_source_batch("source.json", self.sha, max_rows=1)
            m.read_source_batch("source.json", self.sha, start_index=2, max_rows=1)
            self.assertEqual(read.call_count, 1)
            self.rows[0]["text"] += "changed"
            new_sha = self.write("source.json", self.src)
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                m.read_source_batch("source.json", self.sha)
            self.assertFalse(m.read_source_batch("source.json", new_sha)["cacheHit"])

    def test_wrong_sha_cursor_and_path_rejected(self):
        for args in [
            ("source.json", "0"*64, 0, 0), ("source.json", self.sha, 0, -1),
            ("source.json", self.sha, 0, 5), ("source.json", self.sha, 9, 0),
            ("../source.json", self.sha, 0, 0)
        ]:
            with self.assertRaises((ValueError, OSError)):
                m.read_source_batch(*args)
        with self.assertRaises(ValueError):
            m.read_source_batch("source.json", self.sha, max_bytes=1000000)
        self.assertEqual(m.read_source_batch("source.json", self.sha, len(self.rows))["next"], None)

    def test_observed_prefix_read_only_not_import(self):
        c = {**self.src, "format": m.JOINED, "status": "joined-observed-prefix",
             "canonical": False, "importable": False, "rows": self.rows[:2], "count": 2,
             "candidateRows": self.rows, "evidence": {"joinedCandidateCount": len(self.rows)}}
        sha = self.write("joined.json", c)
        p = m.read_source_batch("joined.json", sha, view="candidateRows")
        self.assertEqual(p["source"]["count"], 5)
        self.assertTrue(p["source"]["trueOpeningUnverified"])
        self.assertFalse(p["source"]["importable"])
        self.assertEqual(m.read_source_batch("joined.json", sha)["source"]["count"], 2)
        with self.assertRaises(ValueError):
            m.source_view(c)
        with self.assertRaises(ValueError):
            m.read_source_batch("source.json", self.sha, view="candidateRows")

    def test_duplicate_ids_bad_view_and_failed_status(self):
        self.rows[1]["id"] = self.rows[0]["id"]
        sha = self.write("bad.json", self.src)
        with self.assertRaises(ValueError):
            m.read_source_batch("bad.json", sha)
        self.rows[1]["id"] = "fixture-1"
        failed = {**self.src, "status": "failed"}
        sha = self.write("failed.json", failed)
        self.assertEqual(m.read_source_batch("failed.json", sha)["source"]["status"], "failed")

    def test_cache_capacity_and_old_endpoint_unchanged(self):
        for i in range(3):
            name = f"fixture-{i}.json"
            sha = self.write(name, {**self.src, "runId": name})
            m.read_source_batch(name, sha, max_rows=1)
        self.assertLessEqual(len(m._BATCH_CACHE), 2)
        self.assertEqual(m.read_source_row("source.json", 0)["text"], "first")


if __name__ == "__main__":
    unittest.main()
