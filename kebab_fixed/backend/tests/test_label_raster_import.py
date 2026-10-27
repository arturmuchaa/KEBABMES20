import base64
import io

import pytest
from PIL import Image

from app.services.label_raster_import import (
    LabelImportError, MAX_SOURCE_BYTES, import_raster, raster_to_epl, raster_to_zpl,
)


def sample():
    # Contains NUL, newline and command-looking data INSIDE the binary bitmap.
    return Image.frombytes("1", (64, 2), b"\x00\xff\r\n^XA~" + b"GW\x00P1\xff\x80\x7f")


@pytest.mark.parametrize("dpi", [203, 300])
def test_lossless_epl_zpl_roundtrip_and_physical_dimensions(dpi):
    image = sample()
    epl = raster_to_epl(image, 24)
    imported = import_raster(epl, dpi)
    assert imported.language == "epl"
    assert imported.gap_dots == 24
    assert imported.image.tobytes() == image.tobytes()
    result = imported.as_import()
    assert result["widthMm"] == 64 * 25.4 / dpi
    assert result["heightMm"] == 2 * 25.4 / dpi
    assert len(result["sourceSha256"]) == 64
    png = Image.open(io.BytesIO(base64.b64decode(result["backgroundData"].split(",")[1])))
    assert png.tobytes() == image.tobytes()
    zpl = import_raster(result["backgroundZpl"].encode(), dpi)
    assert zpl.language == "zpl"
    assert zpl.image.tobytes() == image.tobytes()
    assert raster_to_epl(zpl.image, 24) == epl


def test_polarity_is_not_inverted():
    epl = import_raster(b"N\nq8\nQ1,0\nGW0,0,1,1,\x80\nP1\n", 203)
    assert epl.image.getpixel((0, 0)) == 255
    assert epl.image.getpixel((1, 0)) == 0
    assert "^GFA,1,1,1,7F" in raster_to_zpl(epl.image)


def test_padding_is_white_not_clipped_black_content():
    image = Image.new("1", (9, 4), 0)
    for source in (raster_to_epl(image, 10), raster_to_zpl(image).encode()):
        imported = import_raster(source, 203)
        assert imported.image.size == image.size
        assert imported.image.tobytes() == image.tobytes()
    with pytest.raises(LabelImportError, match="Obcięcie"):
        import_raster(b"N\nq9\nQ1,0\nGW0,0,2,1,\x00\x00\nP1\n", 203)


def test_gw_accepts_documented_crlf_separator():
    imported = import_raster(b"N\r\nq8\r\nQ1,0\r\nGW0,0,1,1\r\n\x00P1\r\n", 203)
    assert imported.image.getpixel((0, 0)) == 0


@pytest.mark.parametrize("source", [
    b"", b"VATAN.nlbl", b"%PDF-1.7", b"N\nq8\nQ1,0\nGW0,0,1,1,",
    b"N\nq8\nQ1,0\nGW0,0,1,1,\xff\n",  # no print terminator
    b"N\nq0\nQ1,0\nP1", b"N\nq9999\nQ9999,0\nGW0,0,1,1,\xff\nP1",
    b"N\nq8\nQ1,0\nGW0,0,9999,9999,\x00\nP1",
    b"N\nq8\nQ1,0\nGW8,0,1,1,\x00\nP1",  # outside material
    b"N\nq8\nQ1,0\nGW0,0,1,1,\xff\nP100",  # never replay copies
    b"N\nGK\"*\"\nP1", b"N\nA0,0,0,1,1,1,N,\"text\"\nP1",
    b"^XA^PW8^LL1^FO0,0^GFA,1,1,1,:Z64:xx^FS^XZ",
    b"^XA^PW8^LL1^FO0,0^GFA,1,1,1,FFFF^FS^XZ",
    b"^XA^PW8^LL1^FO0,0^GFA,2,1,1,FF^FS^XZ",
    b"^XA^PW8^LL1^FO0,0^GFA,1,1,0,FF^FS^XZ",
    b"^XA^PW8^LL1^FO0,0^GFA,1,1,1,FF^FS~JA^XZ",
    b"^XA^PW8^LL1^FO0,0^GFA,1,1,1,FF^FS^JUS^XZ",
    b"^XA^PW8^LL1^FO0,0^FDtext^FS^XZ", b"^XA^PW8^LL1^XZ",
    b"^XA^PW8^LL1^FO0,0^GFA,1,1,1,FF^FS^PQ100^XZ",
])
def test_corrupt_unsupported_and_unsafe_programs_fail_closed(source):
    with pytest.raises(LabelImportError):
        import_raster(source, 203)


def test_multiple_labels_and_overlapping_graphics_are_not_silently_merged():
    source = raster_to_epl(sample(), 24)
    with pytest.raises(LabelImportError):
        import_raster(source + source, 203)
    zpl = raster_to_zpl(sample()).encode()
    with pytest.raises(LabelImportError):
        import_raster(zpl + zpl, 203)
    with pytest.raises(LabelImportError, match="Nakładające"):
        import_raster(b"N\nq8\nQ1,0\nGW0,0,1,1,\xff\nGW0,0,1,1,\x00\nP1", 203)


@pytest.mark.parametrize("dpi", [0, -1, 200, 600, True, 203.0])
def test_dpi_is_explicit_and_validated(dpi):
    with pytest.raises(LabelImportError):
        import_raster(raster_to_epl(sample(), 0), dpi)


def test_limits_and_no_implicit_rasterization():
    with pytest.raises(LabelImportError):
        import_raster(b"x" * (MAX_SOURCE_BYTES + 1), 203)
    with pytest.raises(LabelImportError):
        raster_to_epl(Image.new("RGB", (8, 8)), 10)
    with pytest.raises(LabelImportError):
        raster_to_epl(sample(), -1)


def test_import_endpoint_closes_upload_and_returns_actionable_error():
    import asyncio
    from fastapi import HTTPException, UploadFile
    from app.routes.label_templates import import_raster_file
    file = UploadFile(filename="unknown.prn", file=io.BytesIO(b"N\nGK\"*\"\nP1"))
    with pytest.raises(HTTPException) as error:
        asyncio.run(import_raster_file(file, 203))
    assert error.value.status_code == 422
    assert "EPL" in error.value.detail
    assert file.file.closed
