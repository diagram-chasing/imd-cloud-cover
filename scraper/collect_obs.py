"""Build latest/obs.json — near-real-time observed cloud & rain per station.

Runs every ~30 min (obs-refresh.yml), independent of the daily scrape. Each
source is optional. Cloud = max of two satellite grids (IMD CTBT + MOSDAC OLR);
IMD synop adds observer oktas, present weather and 3-h rain via the wmo join
in stations.json. sources.sat carries a per-run satellite-vs-observer trust
flag that obs.ts uses to gate corrections.
"""

import datetime
import statistics

import numpy as np
from dotenv import load_dotenv

import imd_sat
import mosdac
import synop
from common import c100, load_manifest
from render_sky import render_sky
from storage import get_store, SHORT

load_dotenv()

SYNOP_MAX_AGE = datetime.timedelta(hours=4.5)
ARCHIVE_KEEP = 60  # snapshots per daily QA archive file
LAYER_CLOUD_GATE = 40  # need cloud % >= this before a cloud layer is meaningful


def build_obs(now):
    # Primary satellite source: IMD's live INSAT CTBT (cloud fraction + cloud-top
    # temperature, decoded and warped onto the same grid mosdac.sample() expects).
    frame = imd_sat.latest_frame(now)
    cloud, temp = imd_sat.grids(frame[0]) if frame else (None, None)
    ctbt_dt = frame[1] if frame else None

    # Second satellite source, best-effort: MOSDAC INSAT-3DS (HEM rain + OLR).
    mfiles = mosdac.latest_files(now)
    hem = mosdac.fetch_hem_grid(mfiles["HEM"]) if "HEM" in mfiles else None
    molr = mosdac.fetch_olr_grid(mfiles["OLR"]) if "OLR" in mfiles else None
    syn = synop.fetch_synop()

    # Each satellite misses different cloud; take whichever shows more.
    olr_cloud = mosdac.olr_to_frac(molr)
    if cloud is not None and olr_cloud is not None:
        cloud = np.fmax(cloud, olr_cloud)
    elif cloud is None:
        cloud = olr_cloud

    stations = {}
    for code, s in load_manifest()["stations"].items():
        row = {}
        sc = mosdac.sample(cloud, s["lat"], s["lon"])
        if sc is not None:
            row["sc"] = c100(sc * 100)
        rr = mosdac.sample(hem, s["lat"], s["lon"])
        if rr:
            row["rr"] = round(rr, 1)

        # Cloud-top height/layer, only where the mask agrees there's cloud to
        # place. Prefer CTBT temperature (deg C); fall back to MOSDAC OLR (W/m^2)
        # if that channel is alive.
        if row.get("sc", 0) >= LAYER_CLOUD_GATE:
            tc = mosdac.sample(temp, s["lat"], s["lon"])
            if tc is not None:
                row["ol"] = round(tc)
                row["layer"] = imd_sat.layer_of(tc)
            else:
                ow = mosdac.sample(molr, s["lat"], s["lon"])
                if ow is not None:
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
            "ctbt": ctbt_dt and ctbt_dt.isoformat(timespec="seconds"),
            "hem": mfiles.get("HEM") if hem is not None else None,
            "olr": mfiles.get("OLR") if molr is not None else None,
            "sat": sat_trust(stations),
        },
        "stations": stations,
    }, cloud, ctbt_dt, temp


def sat_trust(stations):
    """Satellite-vs-observer check: {bias, mae, n, ok} or None. obs.ts only
    lets the satellite erase forecast cloud when ok is true."""
    diffs = [r["sc"] - r["ok"] / 8 * 100
             for r in stations.values() if "sc" in r and "ok" in r]
    if not diffs:
        return None
    bias = statistics.median(diffs)
    mae = statistics.mean(abs(d) for d in diffs)
    return {"bias": round(bias), "mae": round(mae), "n": len(diffs),
            "ok": len(diffs) >= 30 and abs(bias) <= 20 and mae <= 30}


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


def put_sky(store, cloud, frame_dt, temp=None):
    """Best-effort styled sky image from the CTBT cloud grid already in hand,
    shaded by cloud-top temperature when that frame is available."""
    try:
        png = render_sky(cloud, frame_dt, temp)
        if png:
            store.put_bytes("latest/sky.png", png, "image/png",
                            cache_control=SHORT)
            print(f"Wrote latest/sky.png ({len(png) // 1024} KB)")
    except Exception as e:  # noqa: BLE001 — illustration must never fail the run
        print(f"sky render failed (ignored): {e}")


def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    doc, cloud, frame_dt, temp = build_obs(now)
    store = get_store()
    store.put_json("latest/obs.json", doc, cache_control="public, max-age=60")
    print(f"Wrote latest/obs.json: {len(doc['stations'])} stations, "
          f"sources {doc['sources']}")
    put_sky(store, cloud, frame_dt, temp)
    append_archive(store, doc, now)


if __name__ == "__main__":
    main()
