#!/usr/bin/env python3
"""Rasteryzuje SVG-i z www/icons/ do PNG-ów wymaganych przez PWA / Capacitor / Play Store.

Użycie:
    pip install cairosvg
    python3 scripts/build-icons.py
"""
import os, sys
try:
    import cairosvg
except ImportError:
    sys.exit("Brak cairosvg. Zainstaluj: pip install cairosvg")

ICONS = os.path.join(os.path.dirname(__file__), "..", "www", "icons")

TARGETS = [
    ("icon.svg",          "icon-192.png",            192),
    ("icon.svg",          "icon-512.png",            512),
    ("icon.svg",          "icon-playstore-512.png",  512),
    ("icon-maskable.svg", "icon-maskable-512.png",   512),
    ("splash.svg",        "splash-2732.png",         2732),
]

for src, dst, size in TARGETS:
    s = os.path.join(ICONS, src)
    d = os.path.join(ICONS, dst)
    cairosvg.svg2png(url=s, write_to=d, output_width=size, output_height=size)
    print(f"  {dst}  ({size}x{size})")

print("OK")
