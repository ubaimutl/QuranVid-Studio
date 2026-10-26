import importlib.util
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("importer", pathlib.Path(__file__).resolve().parents[1] / "scripts/prepare-islam-sobhi.py")
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class RecitationImportTest(unittest.TestCase):
    def test_keeps_full_repeated_passage_and_converts_milliseconds(self):
        rows = [["1:1", 100, 200, False, 10], ["1:1", 210, 1000, True, 20], ["1:2", 1020, 2000, True, 0]]
        self.assertEqual(importer.convert_chapter(rows, 1, 2), [
            {"key": "1:1", "start": .1, "end": 1}, {"key": "1:2", "start": 1.02, "end": 2}])

    def test_rejects_missing_incomplete_overlapping_and_backtracking_verses(self):
        for rows in [
            [["1:2", 0, 100, True, 0]],
            [["1:1", 0, 100, False, 0], ["1:2", 110, 200, True, 0]],
            [["1:1", 0, 100, True, 0], ["1:2", 90, 200, True, 0]],
            [["1:1", 0, 100, True, 0], ["1:2", 110, 200, True, 0], ["1:1", 210, 300, False, 0]],
            [["1:1", 0, 100, True, 0], ["1:1", 110, 200, True, 0], ["1:2", 210, 300, True, 0]],
        ]:
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                importer.convert_chapter(rows, 1, 2)

    def test_rejects_invalid_timestamps(self):
        for start, end in [(0, float("nan")), (-1, 100), (100, 100), (0, float("inf")), (True, 100)]:
            with self.subTest(start=start, end=end), self.assertRaises(ValueError):
                importer.convert_chapter([["1:1", start, end, True, 0]], 1, 1)

    def test_bad_package_leaves_catalog_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            catalog = root / "public/data/recitations/catalog.json"
            catalog.parent.mkdir(parents=True)
            catalog.write_text('{"reciters":[{"id":7}]}')
            before = catalog.read_bytes()
            with self.assertRaisesRegex(ValueError, "checksum"):
                importer.prepare(b"invalid package", root)
            self.assertEqual(catalog.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
