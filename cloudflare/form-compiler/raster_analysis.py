"""Bounded Sentinel-2 neighbourhood analysis. Runs in an isolated child process."""
import base64
from collections import deque
from hashlib import sha256
from io import BytesIO
import json
import math
import os
import sys
from urllib.parse import urlsplit

import numpy as np
from PIL import Image
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from rasterio.warp import transform

METHOD = "sentinel2-red-nir-scl-change@1"
SIZE = 32
RESOLUTION = 10
ALLOWED_CLASSES = (4, 5, 6)


def valid_asset(url):
    if not isinstance(url, str) or len(url) > 2048:
        return False
    value = urlsplit(url)
    return (value.scheme == "https" and value.netloc == "sentinel-cogs.s3.us-west-2.amazonaws.com"
            and not value.username and not value.password and not value.query and not value.fragment
            and value.path.startswith("/sentinel-s2-l2a-cogs/") and value.path.endswith(".tif")
            and ".." not in value.path and "%" not in value.path)


def grid_for(longitude, latitude):
    if (not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
                for v in (longitude, latitude)) or abs(longitude) >= 179.99 or not -80 < latitude < 84):
        raise ValueError("unsupported-analysis-location")
    zone = min(60, int((longitude + 180) // 6) + 1)
    crs = f"EPSG:{32600 + zone if latitude >= 0 else 32700 + zone}"
    x, y = transform("EPSG:4326", crs, [longitude], [latitude])
    # Snap to a stable 10 m grid, not a different resampling origin per date.
    x0 = math.floor(x[0] / RESOLUTION) * RESOLUTION - SIZE // 2 * RESOLUTION
    y0 = math.floor(y[0] / RESOLUTION) * RESOLUTION + SIZE // 2 * RESOLUTION
    return crs, from_origin(x0, y0, RESOLUTION, RESOLUTION)


def read_band(asset, crs, affine, reader=None):
    if not isinstance(asset, dict) or not valid_asset(asset.get("url")):
        raise ValueError("unsupported-raster-asset")
    if reader is not None:
        return reader(asset, crs, affine)
    # No directory listings, alternative formats, credentials, retry loop or arbitrary destination.
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_CACHEMAX=32 * 1024 * 1024,
                      CPL_VSIL_CURL_CACHE_SIZE=1024 * 1024, GDAL_HTTP_TIMEOUT="10",
                      GDAL_HTTP_CONNECTTIMEOUT="5", GDAL_HTTP_MAX_RETRY="0",
                      CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_HTTP_MULTIRANGE="SERIAL",
                      GDAL_NUM_THREADS="1", GDAL_HTTP_UNSAFESSL="NO",
                      CURL_CA_BUNDLE=os.environ.get("SSL_CERT_FILE", "/etc/ssl/certs/ca-certificates.crt")):
        with rasterio.open(asset["url"], allowed_drivers=["GTiff"]) as dataset:
            if (dataset.crs is None or dataset.count != 1 or max(dataset.width, dataset.height) > 25000
                    or any(rows * cols > 4194304 for rows, cols in dataset.block_shapes)):
                raise ValueError("invalid-raster-grid")
            with WarpedVRT(dataset, crs=crs, transform=affine, width=SIZE, height=SIZE,
                           resampling=Resampling.nearest, nodata=0) as warped:
                return warped.read(1, masked=True)


def preview(ndvi, valid):
    # A quantitative index image, not a natural-colour photograph.
    pixels = np.full((SIZE, SIZE, 3), 40, dtype=np.uint8)
    value = np.clip((ndvi + 1) / 2, 0, 1)
    pixels[valid, 0] = (210 * (1 - value[valid])).astype(np.uint8)
    pixels[valid, 1] = (80 + 175 * value[valid]).astype(np.uint8)
    pixels[valid, 2] = 70
    output = BytesIO()
    Image.fromarray(pixels).save(output, format="PNG")
    return base64.b64encode(output.getvalue()).decode("ascii")


def sample(scene, crs, affine, reader=None):
    arrays = {}; valid = np.ones((SIZE, SIZE), dtype=bool)
    for name in ("red", "nir", "scl"):
        asset = scene["assets"][name]
        raw = np.ma.asarray(read_band(asset, crs, affine, reader))
        if raw.shape != (SIZE, SIZE):
            raise ValueError("invalid-raster-window")
        valid &= ~np.ma.getmaskarray(raw)
        if name == "scl":
            valid &= np.isin(raw.filled(0), ALLOWED_CLASSES)
        else:
            scale, offset = asset.get("scale"), asset.get("offset")
            if (not isinstance(scale, (int, float)) or not isinstance(offset, (int, float))
                    or not math.isfinite(scale) or not math.isfinite(offset) or not 0 < scale <= 0.01
                    or not -1 <= offset <= 1):
                raise ValueError("invalid-reflectance-calibration")
            values = np.asarray(raw.filled(0), dtype=np.float64) * scale + offset
            valid &= np.isfinite(values) & (values >= 0) & (values <= 1.5)
            arrays[name] = values
    total = arrays["nir"] + arrays["red"]
    valid &= total > 1e-6
    # Two-pixel exclusion around cloud/no-data/invalid reflectance. Image edges are unknown.
    padded = np.pad(valid, 2, constant_values=False)
    valid = np.logical_and.reduce([padded[y:y+SIZE, x:x+SIZE] for y in range(5) for x in range(5)])
    ndvi = np.divide(arrays["nir"] - arrays["red"], total, out=np.zeros_like(total), where=total > 1e-6)
    encoded = {name: [round(float(value), 6) if keep else None for value, keep in zip(values.ravel(), valid.ravel())]
               for name, values in arrays.items()}
    digest = sha256(json.dumps(encoded, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {"ndvi": ndvi, "valid": valid, "red": arrays["red"], "nir": arrays["nir"],
            "snapshot": {"pixels": encoded, "sampleSha256": digest, "validPixels": int(valid.sum()),
                         "meanNdvi": round(float(ndvi[valid].mean()), 6) if valid.any() else None,
                         "previewPng": preview(ndvi, valid)}}


def components(classes, crs, affine):
    seen = set(); found = []
    for y, x in zip(*np.nonzero(classes)):
        if (int(y), int(x)) in seen:
            continue
        kind = int(classes[y, x]); cells = []; queue = deque([(int(y), int(x))]); seen.add((int(y), int(x)))
        while queue:
            row, col = queue.popleft(); cells.append((row, col))
            for a, b in ((row-1, col), (row+1, col), (row, col-1), (row, col+1)):
                if 0 <= a < SIZE and 0 <= b < SIZE and (a, b) not in seen and classes[a, b] == kind:
                    seen.add((a, b)); queue.append((a, b))
        if len(cells) < 4:
            continue
        rows, cols = zip(*cells); left, top = affine * (min(cols), min(rows)); right, bottom = affine * (max(cols)+1, max(rows)+1)
        lon, lat = transform(crs, "EPSG:4326", [left, right, right, left, left], [top, top, bottom, bottom, top])
        found.append({"kind": {1: "vegetation-loss", 2: "vegetation-gain", 3: "surface-reflectance-change"}[kind],
                      "pixels": len(cells), "areaM2": len(cells) * RESOLUTION ** 2,
                      "geometry": {"type": "Polygon", "coordinates": [[[round(a, 8), round(b, 8)] for a, b in zip(lon, lat)]]},
                      "cells": [row * SIZE + col for row, col in sorted(cells)]})
    found.sort(key=lambda candidate: (-candidate["pixels"], candidate["kind"], candidate["cells"][0]))
    return [{"id": index + 1, **candidate} for index, candidate in enumerate(found[:20])], max(0, len(found)-20)


def analyse(payload, reader=None):
    location = payload["location"]
    crs, affine = grid_for(location["longitude"], location["latitude"])
    accuracy = location.get("accuracy")
    if not isinstance(accuracy, (int, float)) or not math.isfinite(accuracy) or not 0 <= accuracy <= 50:
        return {"status": "withheld", "reason": "reported-accuracy-unavailable-or-over-50m", "method": METHOD}
    before = sample(payload["before"], crs, affine, reader)
    after = sample(payload["after"], crs, affine, reader)
    valid = before["valid"] & after["valid"]
    ratio = float(valid.mean())
    delta = after["ndvi"] - before["ndvi"]
    brightness = np.abs((after["red"] + after["nir"] - before["red"] - before["nir"]) / 2)
    parameters = {"ndviDelta": 0.2, "reflectanceDelta": 0.15, "minimumComponentPixels": 4,
                  "minimumPairedCoverage": 0.5, "validSclClasses": list(ALLOWED_CLASSES), "cloudBufferPixels": 2}
    result = {"method": METHOD, "grid": {"crs": crs, "transform": list(affine)[:6], "width": SIZE, "height": SIZE,
              "resolutionM": RESOLUTION, "resampling": "nearest"}, "parameters": parameters,
              "before": before["snapshot"], "after": after["snapshot"], "pairedValidPixels": int(valid.sum()),
              "pairedCoverage": round(ratio, 6), "candidates": [], "omittedCandidates": 0}
    # The declared positional-accuracy neighbourhood must also be clear in both dates.
    radius = max(1, int(math.ceil(accuracy / RESOLUTION)))
    yy, xx = np.ogrid[:SIZE, :SIZE]
    centre = (xx-SIZE//2)**2 + (yy-SIZE//2)**2 <= radius**2
    if ratio < 0.5 or not valid[centre].all():
        return {**result, "status": "withheld", "reason": "insufficient-clear-comparable-pixels"}
    classes = np.zeros((SIZE, SIZE), dtype=np.uint8)
    classes[valid & (brightness >= 0.15)] = 3
    classes[valid & (delta >= 0.2)] = 2
    classes[valid & (delta <= -0.2)] = 1
    candidates, omitted = components(classes, crs, affine)
    return {**result, "status": "analysed", "reason": None, "candidates": candidates, "omittedCandidates": omitted,
            "meanNdviDelta": round(float(delta[valid].mean()), 6),
            "changedPixelFraction": round(float(np.count_nonzero(classes) / valid.sum()), 6)}


if __name__ == "__main__":
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (40, 40))
        resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))
        payload = json.load(sys.stdin)
        print(json.dumps(analyse(payload), allow_nan=False, separators=(",", ":")))
    except Exception:
        print(json.dumps({"status": "withheld", "reason": "raster-unavailable-or-invalid", "method": METHOD}))
