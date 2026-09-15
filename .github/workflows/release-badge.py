#!/usr/bin/env python3
"""Bake the engine release tag into the footer's `id="rel"` anchor.

Reads TAG and URL from the env (set by release-badge.yml), normalises
"v0.4.2" to "0.4.2" for display, and rewrites the badge line in
index.html in-place. No-op if the badge already matches.
"""

import os
import re
import pathlib
import sys

tag = os.environ.get("TAG", "").strip()
url = os.environ.get("URL", "").strip()
if not tag:
    print("no TAG — nothing to do", file=sys.stderr)
    sys.exit(0)
if not url:
    url = f"https://github.com/necrometer-dev/necrometer/releases/tag/{tag}"

display = f"seance {tag.lstrip('v')}"
path = pathlib.Path("index.html")
src = path.read_text()
needle = re.compile(r'<a class="fright" id="rel"[^>]*>[^<]*</a>')
new_html = needle.sub(
    f'<a class="fright" id="rel" href="{url}">{display}</a>',
    src,
)
if new_html == src:
    print("badge already up to date — no change")
else:
    path.write_text(new_html)
    print(f"updated badge: {display} -> {url}")
