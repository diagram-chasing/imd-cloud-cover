"""Build latest/obs.json — near-real-time observed cloud & rain per station.

Runs every ~30 min (obs-refresh.yml), independent of the daily scrape. Each
source is optional: INSAT-3DS CMK cloud mask + HEM rain (MOSDAC GetMap pixel
sampling) and IMD synop (oktas, present weather, 3-h rain via the wmo join in
stations.json). The map uses obs only to correct the current-time frame.
"""

import datetime

from dotenv import load_dotenv

import mosdac
import synop
from common import c100, load_manifest
from render_sky import render_sky
from storage import get_store, SHORT

load_dotenv()

SYNOP_MAX_AGE = datetime.timedelta(hours=4.5)
ARCHIVE_KEEP = 60  # snapshots per daily QA archive file
LAYER_CLOUD_GATE = 40  # need CMK cloud >= this before OLR altitude is meaningful


def build_obs(now):
    files = mosdac.latest_files(now)
    cmk = mosdac.fetch_cmk_grid(files["CMK"]) if "CMK" in files else None
    cmk_file = files.get("CMK") if cmk is not None else None
    hem = mosdac.fetch_hem_grid(files["HEM"]) if "HEM" in files else None
    olr = mosdac.fetch_olr_grid(files["OLR"]) if "OLR" in files else None
    syn = synop.fetch_synop()

    stations = {}
    for code, s in load_manifest()["stations"].items():
        row = {}
        sc = mosdac.sample(cmk, s["lat"], s["lon"])
        if sc is not None:
            row["sc"] = c100(sc * 100)
        rr = mosdac.sample(hem, s["lat"], s["lon"])
        if rr:
            row["rr"] = round(rr, 1)

        # OLR gives the cloud-top temperature; only classify altitude where the
        # mask agrees there's cloud to place (CMK gates, OLR locates the layer).
        ow = mosdac.sample(olr, s["lat"], s["lon"])
        if ow is not None and row.get("sc", 0) >= LAYER_CLOUD_GATE:
            row["ol"] = round(ow)
            row["layer"] = ("high" if ow < mosdac.OLR_HIGH
                            else "mid" if ow < mosdac.OLR_MID else "low")

        ob = syn.get(str(s.get("wmo"))) if syn and s.get("wmo") else None
        if ob and ob["t"] and now - ob["t"] <= SYNOP_MAX_AGE:
            if ob["ok"] is not None:
                row["ok"] = ob["ok"]
            if ob["wx"] is not None:
                row["wx"] = ob["wx"]
            if ob["r3"]:
                row["r3"] = round(ob["r3"], 1)

        # merged observed cloud %. The IR mask is binary (cloud present, not
        # sky fraction) and saturates to ~0/100 at station scale, so weight
        # the observer's oktas higher when both are fresh.
        okpct = row["ok"] / 8 * 100 if "ok" in row else None
        if "sc" in row and okpct is not None:
            row["oc"] = c100(0.4 * row["sc"] + 0.6 * okpct)
        elif okpct is not None:
            row["oc"] = c100(okpct)
        elif "sc" in row:
            row["oc"] = row["sc"]

        if row:
            stations[code] = row

    syn_t = max((o["t"] for o in syn.values() if o["t"]), default=None) if syn else None
    return {
        "generated_at": now.isoformat(timespec="seconds"),
        "sources": {
            "synop": syn_t and syn_t.isoformat(timespec="seconds"),
            "cmk": files.get("CMK") if cmk is not None else None,
            "hem": files.get("HEM") if hem is not None else None,
            "olr": files.get("OLR") if olr is not None else None,
        },
        "stations": stations,
    }, cmk, cmk_file, olr


def append_archive(store, doc, now):
    """Best-effort daily QA archive of synop-joined rows (feeds validate_sources)."""
    key = f"obs/archive/{now.date().isoformat()}.json"
    try:
        arch = store.get_json(key) or {"date": now.date().isoformat(), "snapshots": []}
        arch["snapshots"].append({
            "t": doc["generated_at"], "sources": doc["sources"],
            "stations": {c: r for c, r in doc["stations"].items()
                         if "ok" in r or "wx" in r}})
        arch["snapshots"] = arch["snapshots"][-ARCHIVE_KEEP:]
        store.put_json(key, arch, cache_control=SHORT)
    except Exception as e:  # noqa: BLE001 — QA trail must never fail the run
        print(f"archive append failed (ignored): {e}")


def put_sky(store, cmk, cmk_file, olr=None):
    """Best-effort styled sky image from the CMK grid already in hand, shaded by
    OLR cloud-top height when that frame is available."""
    try:
        png = render_sky(cmk, cmk_file, olr)
        if png:
            store.put_bytes("latest/sky.png", png, "image/png",
                            cache_control=SHORT)
            print(f"Wrote latest/sky.png ({len(png) // 1024} KB)")
    except Exception as e:  # noqa: BLE001 — illustration must never fail the run
        print(f"sky render failed (ignored): {e}")


def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    doc, cmk, cmk_file, olr = build_obs(now)
    store = get_store()
    store.put_json("latest/obs.json", doc, cache_control="public, max-age=60")
    print(f"Wrote latest/obs.json: {len(doc['stations'])} stations, "
          f"sources {doc['sources']}")
    put_sky(store, cmk, cmk_file, olr)
    append_archive(store, doc, now)


if __name__ == "__main__":
    main()
