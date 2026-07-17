from app.services.cmr_service import format_cmr_number


def test_format_cmr_number_jak_hdi():
    # numeracja per miesiąc: NN/MM/RR (jak HDI), od 1 w nowym miesiącu
    assert format_cmr_number(1, "2607") == "1/07/26"
    assert format_cmr_number(3, "2607") == "3/07/26"
    assert format_cmr_number(1, "2608") == "1/08/26"
    assert format_cmr_number(12, "2701") == "12/01/27"
