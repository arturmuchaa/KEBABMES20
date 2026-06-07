from app.services.wz_service import format_wz_number


def test_basic_format():
    # year_month = "RRMM" (np. "2606" = czerwiec 2026); numer = WZ/NN/MM/RR
    assert format_wz_number(7, "2606") == "WZ/7/06/26"


def test_pads_month_keeps_seq():
    assert format_wz_number(12, "2601") == "WZ/12/01/26"


def test_seq_one():
    assert format_wz_number(1, "2612") == "WZ/1/12/26"
