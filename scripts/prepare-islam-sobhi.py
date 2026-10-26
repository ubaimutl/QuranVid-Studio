"""Build static verse timings only. No audio downloads or runtime dependencies."""
import argparse
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
RECITER_ID = 9001  # QuranVid's external-provider namespace; not a Quran Foundation ID.
RELEASE = "https://github.com/QUD-Technologies/quranic-universal-audio/releases/tag/v4.0.0"
PACKAGE = RELEASE.replace("/tag/", "/download/") + "/islam_sobhi_mp3quran.zip"
SHA256 = "6d2eea9e86c30bb4fdf685a1999f1258f4e54a6b8180ece9f0eb2b2a0966c88d"
TIMING_CREDIT = {
    "title": "Islam Sobhi verse timings, v4.0.0 (adapted for QuranVid)",
    "creator": "Quranic Universal Audio contributors",
    "sourceUrl": RELEASE,
    "license": "CC BY 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
}


def convert_chapter(rows, chapter, count):
    """Include adjacent repeats, reject backtracking/overlap, require every ayah."""
    timings = []
    complete = set()
    previous_end = 0
    for row in rows:
        if not isinstance(row, list) or len(row) != 5:
            raise ValueError("Unsupported verse row")
        key, start, end, canonical, silence = row
        if not isinstance(key, str) or len(key.split(":")) != 2:
            raise ValueError("Invalid verse reference")
        surah, verse = map(int, key.split(":"))
        if surah != chapter:
            continue
        if (not 1 <= verse <= count or type(canonical) is not bool
                or any(type(n) not in (int, float) or not math.isfinite(n) for n in (start, end, silence))
                or start < previous_end or end <= start or silence < 0):
            raise ValueError(f"Invalid or overlapping timing at {key}")
        previous_end = end
        if canonical:
            if key in complete:
                raise ValueError(f"Duplicate canonical verse {key}")
            complete.add(key)
        if timings and timings[-1]["key"] == key:
            timings[-1]["end"] = end / 1000
        else:
            if verse != len(timings) + 1:
                raise ValueError(f"Missing or out-of-order verse {key}")
            timings.append({"key": key, "start": start / 1000, "end": end / 1000})
    if len(timings) != count or len(complete) != count:
        raise ValueError("Complete verse timings unavailable")
    return timings


def atomic_json(file, value):
    with tempfile.NamedTemporaryFile(mode="w", dir=file.parent, delete=False) as temporary:
        json.dump(value, temporary, separators=(",", ":"), ensure_ascii=False)
        temporary.write("\n")
    Path(temporary.name).replace(file)


def prepare(package, root=ROOT):
    if hashlib.sha256(package).hexdigest() != SHA256:
        raise ValueError("Timing package checksum mismatch; existing catalog preserved")
    with zipfile.ZipFile(io.BytesIO(package)) as archive:
        catalog = json.loads(archive.read("catalog.json"))
        data = json.loads(gzip.decompress(archive.read("verse_timestamps.json.gz")))
    meta = data["_meta"]
    if (catalog["slug"] != "islam_sobhi_mp3quran" or catalog["riwayah"] != "hafs_an_asim"
            or meta["schema_version"] != 3 or meta["units"] != "ms" or meta["tier"] != "verse"):
        raise ValueError("Unsupported timing package")
    output = root / "public/data/recitations"
    current = json.loads((output / "catalog.json").read_text())
    if any(r["id"] == RECITER_ID and r["name"] != "Islam Sobhi" for r in current["reciters"]):
        raise ValueError("External reciter ID is already assigned")
    chapters = json.loads((root / "public/data/chapters.json").read_text())
    recordings, skipped = {}, []
    for chapter in chapters:
        number = chapter["id"]
        url = catalog["audio"]["chapter_urls"].get(str(number))
        if not url:
            skipped.append(number)
            continue
        if url != f"https://cdn.mp3quran.net/audio/islam-sobhi/r1/{number:03d}.mp3":
            raise ValueError(f"Unexpected audio source for chapter {number}")
        try:
            timings = convert_chapter(data["rows"], number, chapter["count"])
        except ValueError:
            skipped.append(number)
            continue
        recordings[number] = {"version": 1, "reciterId": RECITER_ID, "chapter": number,
                              "audioUrl": url, "timings": timings}
    if not recordings:
        raise ValueError("No complete recordings; existing catalog preserved")
    target = output / str(RECITER_ID)
    target.mkdir(exist_ok=True)
    for chapter, recording in recordings.items():
        atomic_json(target / f"{chapter}.json", recording)
    entry = {"id": RECITER_ID, "name": "Islam Sobhi", "style": "Murattal",
             "chapters": sorted(recordings), "source": {
                 "title": "Islam Sobhi recitation", "creator": "Islam Sobhi",
                 "sourceUrl": "https://www.mp3quran.net/eng/islam", "provider": "MP3Quran",
                 "timing": TIMING_CREDIT,
             }}
    current["reciters"] = [r for r in current["reciters"] if r["id"] != RECITER_ID] + [entry]
    # Retain QF's environment/generatedAt: this pinned dataset has independent provenance.
    atomic_json(output / "catalog.json", current)
    print(f"Prepared {len(recordings)} complete surahs. Unavailable: {','.join(map(str, skipped))}.")
    print(f"Verse metadata: {sum(p.stat().st_size for p in target.glob('*.json')):,} bytes. No audio stored.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, help="Use a previously downloaded, checksum-verified package")
    args = parser.parse_args()
    if args.archive:
        package = args.archive.read_bytes()
    else:
        with urllib.request.urlopen(PACKAGE, timeout=45) as response:
            package = response.read(1_000_001)
        if len(package) > 1_000_000:
            raise ValueError("Timing package exceeds the expected size")
    prepare(package)
