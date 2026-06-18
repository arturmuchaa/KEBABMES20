"""Druk wsadowy Zebra: identyczne etykiety → jedna etykieta + ^PQ{ilość}
(jak Zebra Designer), zamiast N× powtórzonego rastra tła."""
from app.services.zebra_labels_service import pq_grouped_zpl


def test_identical_blocks_collapse_to_one_with_pq():
    block = "^XA^FO0,0^FDX^FS^XZ"
    out = pq_grouped_zpl([block, block, block])
    assert out.count("^XA") == 1          # jedna etykieta
    assert "^PQ3" in out                  # ilość 3
    assert out.strip().endswith("^XZ")


def test_distinct_blocks_each_get_own_pq():
    a = "^XA^FDA^XZ"
    b = "^XA^FDB^XZ"
    out = pq_grouped_zpl([a, a, b])       # 2× A, 1× B
    assert "^PQ2" in out and "^PQ1" in out
    assert out.count("^XA") == 2


def test_pq_inserted_before_xz():
    out = pq_grouped_zpl(["^XA^FDX^FS^XZ"])
    assert out.index("^PQ1") < out.index("^XZ")


def test_empty_list():
    assert pq_grouped_zpl([]) == ""
