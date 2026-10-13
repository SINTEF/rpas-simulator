#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Naming guard (ARCHITECTURE.md section 8): every name a partner sees is made of whole words.

Checks the names in our .stl files (not external/: partner-owned), the keys and
`name:` values of our YAML files and the compose files. A name fails when one of its camelCase /
snake_case parts is a known short form of ours (DENY) that docs/GLOSSARY.md does not allow.
  scripts/check_names.py        # exit 1 and one line per offending name
"""
import glob
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DENY = set("pos vel msg cmd req cfg nav fcu gcs fdm daa nfz eo c2 cpa poi pois dsim alt lat lon fov deg accel "
           "info eu ext wp mm".split())
STL_WORDS = set("import package class struct enum variant abstract extends sequence array optional quantity alias "
                "var fn event true false static confirmed writable f32 f64 u8 u16 u32 u64 i8 i16 i32 i64 bool "
                "string".split())


def allowed():  # the backticked words of the glossary's "Allowed short forms" section
    text = open(os.path.join(ROOT, "docs/GLOSSARY.md")).read()
    section = text.split("## Allowed short forms", 1)[1].split("\n## ", 1)[0]
    return {w.lower() for w in re.findall(r"`([A-Za-z0-9]+)`", section)}


def parts(name):
    words = r"[A-Z]+\d*(?![a-z])|[A-Z]?[a-z]+\d*|\d+"  # camelCase parts, digits kept on their word (c2)
    return [p.lower() for chunk in re.split(r"[_.@\-]+", name) for p in re.findall(words, chunk)]


def stl_names(text):
    text = re.sub(r"//[^\n]*|\"[^\"]*\"|quantity<[^>]*>|\[[^\]]*\]", " ", text)  # comments, imports, units, attributes
    text = re.sub(r"\b\w+\.\w+", " ", text)  # qualified names (aucc.Waypoint): the other package's names
    return set(re.findall(r"[A-Za-z_]\w*", text)) - STL_WORDS


def yaml_names(text):
    text = re.sub(r"#[^\n]*", " ", text)
    return set(re.findall(r"^[\s-]*([A-Za-z_][\w.]*)\s*:", text, re.M)) | set(re.findall(r"\bname:\s*([\w@()]+)", text))


files = [f for f in glob.glob(os.path.join(ROOT, "**/*.stl"), recursive=True)
         if not re.search(r"/(build|external)/", f)]
checks = [(f, stl_names(open(f).read())) for f in files]
for pattern in ("config/*.yaml", "packages/**/*.yaml", "examples/**/*.yaml", "scenarios/*.yaml",
                "docker-compose.yml", "docker/*.yml"):
    checks += [(f, yaml_names(open(f).read())) for f in glob.glob(os.path.join(ROOT, pattern), recursive=True)]
ok_words = allowed()
bad = [(os.path.relpath(f, ROOT), n) for f, names in checks for n in sorted(names) if (set(parts(n)) & DENY) - ok_words]
for f, n in bad:
    print(f"check_names: {f}: '{n}' uses a short form (docs/GLOSSARY.md)")
print(f"check_names: {'FAIL' if bad else 'ok'} ({sum(len(n) for _, n in checks)} names in {len(checks)} files)")
sys.exit(1 if bad else 0)
