import base64
import concurrent.futures
import os
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

import galarchive_mcp_v005 as g

def ident():
    return str(uuid.uuid4())

# A real 1x1 PNG fixture; no private content.
PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nU0AAAAASUVORK5CYII="

class LiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.env = patch.dict(os.environ, {"GALARCHIVE_ROOT": self.tmp.name})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.owner, self.gen = "test-predecessor", ident()
        self.g = g.begin_live_generation(self.owner, self.gen)
        self.assertTrue(self.g["readback"])

    def args(self, **overrides):
        return dict(predecessor_id=self.owner, generation_id=self.gen, turn_id=ident(),
                    previous_sha256=None, player_text="exact user\n\U0001f600",
                    assistant_text="exact reply\n**format**") | overrides

    def test_sequence_retry_and_conflict(self):
        a = self.args()
        first = g.append_live_turn(**a)
        self.assertTrue(first["readback"])
        self.assertEqual(first["sequence"], 1)
        self.assertEqual(first["replyState"], "prepared-not-delivery-verified")
        self.assertTrue(g.append_live_turn(**a)["idempotent"])
        self.assertEqual(g.get_live_checkpoint(self.owner,self.gen)["lastTurnSha256"], first["sha256"])
        with self.assertRaises(ValueError):
            g.append_live_turn(**(a | {"assistant_text":"different"}))
        with self.assertRaises(ValueError):
            g.append_live_turn(**self.args())
        b = self.args(previous_sha256=first["sha256"], previous_reply_text="interrupted reply")
        second = g.append_live_turn(**b)
        row = g.parse((Path(self.tmp.name)/second["path"]).read_text(encoding="utf-8"))
        self.assertFalse(row["previousReplyObservation"]["matchesPrepared"])
        self.assertEqual(row["request"]["previousReplyText"], "interrupted reply")
        self.assertFalse(row["canonical"])
        self.assertFalse(row["importable"])
        self.assertEqual(g.get_live_checkpoint(self.owner,self.gen)["count"], 2)
        self.assertEqual(g.digest((Path(self.tmp.name)/first["path"]).read_bytes()),first["sha256"])

    def test_owner_branch_and_registration(self):
        self.assertTrue(g.begin_live_generation(self.owner,self.gen)["idempotent"])
        with self.assertRaises(ValueError):
            g.begin_live_generation("other",self.gen)
        with self.assertRaises(ValueError):
            g.append_live_turn(**self.args(predecessor_id="other"))
        first = g.append_live_turn(**self.args())
        child = ident()
        g.begin_live_generation(self.owner,child,parent_generation_id=self.gen,parent_turn_sha256=first["sha256"])
        self.assertEqual(g.get_live_checkpoint(self.owner,child)["count"],0)
        with self.assertRaises(ValueError):
            g.begin_live_generation("other",ident(),parent_generation_id=self.gen,parent_turn_sha256=first["sha256"])
        with self.assertRaises(ValueError):
            g.begin_live_generation(self.owner,ident(),parent_generation_id=self.gen,parent_turn_sha256="0"*64)
        with self.assertRaises(ValueError):
            g.begin_live_generation("../bad",ident())

    def test_images_exact_and_pending(self):
        img = g.save_live_image(self.owner,self.gen,"image/png",PNG)
        self.assertEqual((Path(self.tmp.name)/img["path"]).read_bytes(),base64.b64decode(PNG))
        self.assertTrue(g.save_live_image(self.owner,self.gen,"image/png",PNG)["idempotent"])
        saved = {k:img[k] for k in ("status","sha256","mimeType","bytes")} | {"role":"user","ordinal":0}
        pending = {"role":"user","ordinal":1,"status":"pending","reason":"original bytes inaccessible"}
        with self.assertRaises(ValueError):
            g.append_live_turn(**self.args(attachments=[saved | {"sha256":"0"*64}]))
        result = g.append_live_turn(**self.args(attachments=[saved,pending]))
        self.assertEqual(result["pendingAttachments"],1)
        self.assertNotIn(PNG,(Path(self.tmp.name)/result["path"]).read_text(encoding="utf-8"))
        with self.assertRaises(ValueError):
            g.save_live_image(self.owner,self.gen,"image/jpeg",PNG)
        with self.assertRaises(ValueError):
            g.save_live_image(self.owner,self.gen,"image/png",inbox_name="../secret.png")
        with self.assertRaises(ValueError):
            g.save_live_image(self.owner,self.gen,"image/png","not base64!")
        other = ident()
        g.begin_live_generation("other",other)
        with self.assertRaises(ValueError):
            g.append_live_turn(**self.args(predecessor_id="other",generation_id=other,attachments=[saved]))

    def test_clock_and_concurrent_same_checkpoint(self):
        self.assertTrue(g.get_live_checkpoint(self.owner,self.gen)["serverTime"].endswith("+08:00"))
        with self.assertRaises(ValueError):
            g.append_live_turn(**self.args(player_observed_at="2026-11-28T20:00:00"))
        def worker(i):
            try:
                return g.append_live_turn(**self.args(player_text=str(i)))
            except ValueError:
                return None
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results=list(pool.map(worker,range(8)))
        self.assertEqual(sum(x is not None for x in results),1)
        self.assertEqual(g.get_live_checkpoint(self.owner,self.gen)["count"],1)
        self.assertEqual(list(Path(self.tmp.name).rglob(".live-*.tmp")),[])

    def test_publication_failure_does_not_leave_final_file(self):
        with patch.object(g.os,"rename" if os.name=="nt" else "link",side_effect=OSError("synthetic publication failure")):
            with self.assertRaises(OSError):
                g.append_live_turn(**self.args())
        self.assertEqual(g.get_live_checkpoint(self.owner,self.gen)["count"],0)
        self.assertEqual(list(Path(self.tmp.name).rglob(".live-*.tmp")),[])

if __name__=="__main__":
    unittest.main()
