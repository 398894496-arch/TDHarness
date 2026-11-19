#!/usr/bin/env python3
"""Proof for company-inline-media-aspect-v1 (server/site-patches/patch_media_download.py): the image
and video shown in a presented-file card keep their own proportions. The card is a flex column, so
its children were stretched to its width while maxHeight capped the height; the shared box style now
says width/height auto, align-self flex-start, object-fit contain. A pack patched before (card
already there) gets only this; a fresh pack gets the card with it; a second run changes nothing.
Ends with INLINE_MEDIA_ASPECT_PROVE_OK=1."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server" / "site-patches"))
import patch_media_download as m  # noqa: E402


def fail(why):
    print("INLINE_MEDIA_ASPECT_PROVE_FAIL " + why)
    sys.exit(1)


old_pack = "// " + m.MARK_CARD + "\n" + m.BOX_V1 + "\t\t\tif (kind === \"image\") return img(box);\n"
t, how = m.patch_presented_card(old_pack)
if how != "patched" or m.MARK_ASPECT not in t:
    fail("an already-carded pack did not get the aspect fix: " + how)
for k in ('width: "auto"', 'height: "auto"', 'alignSelf: "flex-start"', 'objectFit: "contain"', "maxHeight: 360"):
    if k not in t:
        fail("box style lacks " + k)
if m.BOX_V1 in t:
    fail("the stretching box is still there")
t2, how2 = m.patch_presented_card(t)
if how2 != "already" or t2 != t:
    fail("second run changed it: " + how2)
if m.CARD_HELPERS.count(m.BOX_V1) != 1:
    fail("a fresh pack's card has no box line to fix")
print("INLINE_MEDIA_ASPECT_PROVE_OK=1")
