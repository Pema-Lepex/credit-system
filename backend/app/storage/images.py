"""Image compression and thumbnailing.

STORAGE OPTIMISATION (spec: "compress uploaded images automatically",
"store thumbnails instead of full-resolution previews whenever possible")
-------------------------------------------------------------------------
A phone photo of a handwritten ledger page is typically 3-6 MB. Stored raw, a
shop uploading five a day fills a free tier in months. The pipeline below:

  1. Strips EXIF (also a privacy win -- phone photos carry GPS coordinates).
  2. Applies EXIF orientation first, so the stripped image is not sideways.
  3. Downscales the long edge to IMAGE_MAX_DIMENSION (1600px default) -- still
     legible for a receipt, ~10x smaller.
  4. Re-encodes as WebP, which beats JPEG by ~25-35% at equal quality.
  5. Emits a 320px thumbnail for list/grid views, so a customer table with 50 rows
     downloads ~200 KB of thumbnails instead of ~150 MB of originals.

Typical result: 4.2 MB -> ~180 KB, a ~95% saving, with no visible loss at the size
these images are ever displayed at.

Non-image uploads (PDF invoices) pass through untouched.
"""

from __future__ import annotations

import asyncio
import io
from dataclasses import dataclass

from PIL import Image, ImageOps

from app.core.config import settings

# Formats we will decode. Anything else is stored as-is.
SUPPORTED_IMAGE_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/tiff",
    "image/heic",
    "image/heif",
}

# Decompression-bomb guard: a 10 KB PNG can declare 50000x50000 pixels and OOM the
# process on decode. Pillow warns above ~89M pixels; we cap far lower since no
# legitimate receipt photo is over 50 megapixels.
Image.MAX_IMAGE_PIXELS = 50_000_000


@dataclass(frozen=True, slots=True)
class ProcessedImage:
    data: bytes
    content_type: str
    extension: str
    width: int | None
    height: int | None
    thumbnail: bytes | None
    thumbnail_extension: str | None
    original_size: int


def is_image(content_type: str) -> bool:
    return content_type.lower() in SUPPORTED_IMAGE_TYPES


async def process_upload(
    data: bytes,
    content_type: str,
    *,
    make_thumbnail: bool = True,
) -> ProcessedImage:
    """Compress an image; pass non-images through unchanged. Never blocks the loop."""
    if not is_image(content_type):
        return ProcessedImage(
            data=data,
            content_type=content_type,
            extension=_extension_for(content_type),
            width=None,
            height=None,
            thumbnail=None,
            thumbnail_extension=None,
            original_size=len(data),
        )
    # Pillow is CPU-bound C code; a 6 MB decode would stall every other request if
    # run inline on the event loop.
    return await asyncio.to_thread(_process_image_sync, data, make_thumbnail)


def _process_image_sync(data: bytes, make_thumbnail: bool) -> ProcessedImage:
    original_size = len(data)
    try:
        with Image.open(io.BytesIO(data)) as img:
            # Honour the EXIF orientation tag BEFORE we discard EXIF, or portrait
            # phone photos come out rotated 90 degrees.
            img = ImageOps.exif_transpose(img) or img

            # WebP needs RGB/RGBA. Palette and CMYK images must be converted, and
            # transparency has to be preserved where it exists.
            has_alpha = img.mode in ("RGBA", "LA") or (
                img.mode == "P" and "transparency" in img.info
            )
            img = img.convert("RGBA" if has_alpha else "RGB")

            full = _fit(img, settings.IMAGE_MAX_DIMENSION)
            data_out = _encode_webp(full, settings.IMAGE_QUALITY)

            # Guard against the pathological case: a tiny, already-optimised PNG can
            # come out LARGER as WebP. Never make a file bigger "for optimisation".
            if len(data_out) >= original_size and not has_alpha:
                data_out = data
                width, height = img.size
            else:
                width, height = full.size

            thumb_bytes: bytes | None = None
            if make_thumbnail:
                thumb = _fit(img, settings.THUMBNAIL_DIMENSION)
                thumb_bytes = _encode_webp(thumb, 70)

            return ProcessedImage(
                data=data_out,
                content_type="image/webp",
                extension="webp",
                width=width,
                height=height,
                thumbnail=thumb_bytes,
                thumbnail_extension="webp" if thumb_bytes else None,
                original_size=original_size,
            )
    except Exception:
        # A corrupt or unsupported image must not lose the user's upload -- store the
        # original bytes and let the UI deal with a broken preview.
        return ProcessedImage(
            data=data,
            content_type="application/octet-stream",
            extension="bin",
            width=None,
            height=None,
            thumbnail=None,
            thumbnail_extension=None,
            original_size=original_size,
        )


def _fit(img: Image.Image, max_edge: int) -> Image.Image:
    """Downscale so the long edge is at most ``max_edge``. Never upscales."""
    width, height = img.size
    if max(width, height) <= max_edge:
        return img
    scale = max_edge / max(width, height)
    new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
    return img.resize(new_size, Image.Resampling.LANCZOS)


def _encode_webp(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    # method=6 is the slowest/densest WebP setting. Worth it: uploads are rare,
    # reads are constant, and the bytes are stored forever.
    img.save(buf, format="WEBP", quality=quality, method=6)
    return buf.getvalue()


def _extension_for(content_type: str) -> str:
    return {
        "application/pdf": "pdf",
        "text/csv": "csv",
        "application/json": "json",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
        "application/zip": "zip",
    }.get(content_type.lower(), "bin")
