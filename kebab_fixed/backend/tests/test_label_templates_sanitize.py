from app.services.label_templates_service import _no_nul


def test_no_nul_strips_null_bytes():
    # EPL/rastrowe .prn zawierają bajty 0x00, których PostgreSQL TEXT nie przyjmuje
    assert _no_nul("a\x00b\x00c") == "abc"


def test_no_nul_passthrough_zpl():
    zpl = "^XA^FO50,50^FD[[QR]]^FS^XZ"
    assert _no_nul(zpl) == zpl


def test_no_nul_none():
    assert _no_nul(None) == ""
