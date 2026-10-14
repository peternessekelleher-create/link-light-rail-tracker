"""RAPTOR limited to two rides: a first bus, then at most one transfer.

    labels = search(day, footpaths, access, t0, limit)
    labels[stop] -> Label for every stop you can step off a bus at by `limit`

Only stops reached by riding count; walking alone reaches nothing. Each
label keeps its path, so the ridden segments can be drawn:

    Label.legs = ((pattern index, trip index, board stop index, alight stop index), ...)

with one leg for a direct ride and two after a transfer. `access` is
[(stop, seconds to reach it from the station)], `footpaths` maps a stop to
[(stop, walking seconds)] within the transfer radius, itself included at 0.
"""
from typing import NamedTuple


class Label(NamedTuple):
    time: int  # arrival at the stop, seconds after midnight
    legs: tuple
    access_stop: str
    access_s: int  # station to first stop, including the exit penalty
    transfer_from: str | None = None  # stop stepped off the first bus at
    transfer_s: int = 0  # walk from there to the second bus


def _ride(day, starts, limit, best, make, skip_pattern=None):
    """Board the earliest trip at each start, ride it until `limit`, and keep
    any arrival that beats `best`. starts: [(stop, ready time, context)]."""
    out = {}
    scanned = {}  # (pattern, trip) -> earliest stop index already ridden from
    for stop, ready, ctx in starts:
        if ready > limit:
            continue
        for p, i in day.stop_patterns.get(stop, ()):
            if skip_pattern is not None and p == skip_pattern(ctx):
                continue
            pat = day.patterns[p]
            k = pat.board(i, ready)
            if k is None or pat.dep[k][i] > limit:
                continue
            done = scanned.get((p, k))
            if done is not None and done <= i:
                continue  # same trip already ridden from an earlier stop
            scanned[(p, k)] = i
            arr, drop, stops = pat.arr[k], pat.dropoff, pat.stops
            for j in range(i + 1, len(stops)):
                a = arr[j]
                if a > limit:
                    break
                if not drop[j]:
                    continue
                s = stops[j]
                cur = out.get(s)
                if (cur is None or a < cur.time) and a < best(s):
                    out[s] = make(a, (p, k, i, j), ctx)
    return out


def search(day, footpaths, access, t0, limit):
    inf = float("inf")

    # Round 1: walk from the station, ride one bus.
    first = _ride(
        day,
        [(s, t0 + w, (s, w)) for s, w in access],
        limit,
        lambda s: inf,
        lambda a, leg, ctx: Label(a, (leg,), ctx[0], ctx[1]),
    )

    # Transfer walks: the earliest you can be at each stop after one ride.
    ready = {}
    for s, lab in first.items():
        for s2, w in footpaths.get(s, ((s, 0),)):
            t = lab.time + w
            if s2 not in ready or t < ready[s2][0]:
                ready[s2] = (t, s, w)

    # Round 2: one more bus, kept only where it beats the direct ride. The same
    # route is allowed on another pattern: short-turn and through-routed trips
    # (e.g. a 50 that ends at Seward Park, then one that starts there) are a
    # real change of trip.
    second = _ride(
        day,
        [(s2, t, (s, w)) for s2, (t, s, w) in ready.items()],
        limit,
        lambda s: first[s].time if s in first else inf,
        lambda a, leg, ctx: Label(a, (first[ctx[0]].legs[0], leg), first[ctx[0]].access_stop, first[ctx[0]].access_s, ctx[0], ctx[1]),
        skip_pattern=lambda ctx: first[ctx[0]].legs[0][0],
    )
    return {**first, **second}
