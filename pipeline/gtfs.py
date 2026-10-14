"""Feed-agnostic GTFS reader (standard library only).

    feed = Feed.download(url)            # or Feed(path_to_zip)
    for row in feed.rows("stops.txt"): ...
    feed.services_on(date)               # service_ids running that day

Kept generic on purpose: the next step writes a synthetic GTFS for the ST3
lines and can reuse this to validate it before handing it to r5py / OTP.
"""
import csv
import datetime as dt
import io
import urllib.request
import zipfile
from pathlib import Path

from .config import CACHE, USER_AGENT


class Feed:
    def __init__(self, path):
        self.path = Path(path)
        self.zip = zipfile.ZipFile(self.path)

    @classmethod
    def download(cls, url, name=None):
        """Fetch a GTFS zip into the cache directory (once per run)."""
        CACHE.mkdir(exist_ok=True)
        dest = CACHE / (name or url.rstrip("/").split("/")[-1])
        if not dest.exists():
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=300) as r, open(dest, "wb") as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
        return cls(dest)

    def has(self, name):
        return name in self.zip.namelist()

    def rows(self, name):
        """Stream a table as dicts. Values are stripped strings."""
        with self.zip.open(name) as raw:
            text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
            for row in csv.DictReader(text):
                yield {k.strip(): (v or "").strip() for k, v in row.items() if k}

    def feed_info(self):
        return next(self.rows("feed_info.txt"), {}) if self.has("feed_info.txt") else {}

    def services_on(self, date):
        """service_ids active on a date, from calendar.txt + calendar_dates.txt."""
        ymd = date.strftime("%Y%m%d")
        day = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][date.weekday()]
        active = set()
        if self.has("calendar.txt"):
            for r in self.rows("calendar.txt"):
                if r["start_date"] <= ymd <= r["end_date"] and r[day] == "1":
                    active.add(r["service_id"])
        if self.has("calendar_dates.txt"):
            for r in self.rows("calendar_dates.txt"):
                if r["date"] == ymd:
                    (active.add if r["exception_type"] == "1" else active.discard)(r["service_id"])
        return active

    def representative_day(self, weekday, after=None):
        """The first date on or after `after` (default today) with this weekday
        that is not a holiday: it must run at least 90% of the most services
        seen on that weekday in the next eight weeks."""
        start = after or dt.date.today()
        start += dt.timedelta(days=(weekday - start.weekday()) % 7)
        days = [start + dt.timedelta(weeks=i) for i in range(8)]
        counts = [len(self.services_on(d)) for d in days]
        best = max(counts)
        return next(d for d, c in zip(days, counts) if c >= 0.9 * best)


def seconds(hms):
    """GTFS time (may exceed 24:00:00) to seconds after midnight."""
    h, m, s = hms.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)
