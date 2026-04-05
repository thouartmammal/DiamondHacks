#!/usr/bin/env python3
"""
stdin: JSON { "viewport": "data:image/...;base64,...", "portraits": [ { id, name, relationship, customRelationship, picture } ] }
stdout: single-line JSON (last line wins for the Node runner): { "match": {...}, "distance": n } or { "reason": "..." }
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import tempfile


def data_url_to_path(data_url: str) -> str:
    m = re.match(r"data:image/([^;+]+);base64,(.+)", str(data_url), re.I | re.S)
    if not m:
        raise ValueError("bad data url")
    raw = base64.b64decode(m.group(2))
    fd, path = tempfile.mkstemp(suffix=".png")
    os.write(fd, raw)
    os.close(fd)
    return path


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        emit({"reason": "bad_input"})
        return

    viewport = data.get("viewport") or ""
    portraits = data.get("portraits") or []
    paths_to_unlink: list[str] = []

    try:
        if not str(viewport).startswith("data:image"):
            emit({"reason": "bad_input"})
            return

        try:
            from deepface import DeepFace  # type: ignore
        except ImportError:
            emit({"reason": "deepface_not_installed"})
            return

        try:
            vp_path = data_url_to_path(viewport)
            paths_to_unlink.append(vp_path)
        except Exception:
            emit({"reason": "bad_viewport"})
            return

        best: dict | None = None
        best_dist = 1.0

        for p in portraits:
            if not isinstance(p, dict):
                continue
            pic = p.get("picture") or ""
            if not str(pic).startswith("data:image"):
                continue
            try:
                pr_path = data_url_to_path(pic)
                paths_to_unlink.append(pr_path)
            except Exception:
                continue
            try:
                res = DeepFace.verify(
                    img1_path=vp_path,
                    img2_path=pr_path,
                    enforce_detection=False,
                    silent=True,
                )
                dist = float(res.get("distance", 1.0))
                verified = bool(res.get("verified"))
                if verified or dist < best_dist:
                    best_dist = dist
                    best = p
            except Exception:
                continue

        if best is None:
            emit({"reason": "no_face_match"})
            return

        match = {
            "id": best.get("id", ""),
            "name": best.get("name", ""),
            "relationship": best.get("relationship", ""),
            "customRelationship": best.get("customRelationship", ""),
        }
        emit({"match": match, "distance": best_dist})
    finally:
        for pt in paths_to_unlink:
            try:
                os.unlink(pt)
            except OSError:
                pass


if __name__ == "__main__":
    main()
