# 🏭 KEBAB MES — SYSTEM CONTRACT (CRITICAL)

This system is a production MES for meat processing.

# 🔴 CORE RULES

1. Backend is the ONLY source of truth

2. STOCK MUST BE TRACEABLE
Every stock change MUST create a stock_movement

3. NO DIRECT STOCK MUTATION
Never update stock without movement

4. PRODUCTION = TRANSFORMATION
Input batches → Output batch + movements

5. RESERVATION ≠ CONSUMPTION
Use kg_available and kg_reserved separately

6. TRACEABILITY MUST WORK BOTH WAYS
raw → finished
finished → raw

7. NO DATA LOSS
No silent updates, no deletes

8. USE DATABASE TRANSACTIONS

# 🧠 ARCHITECTURE

API → SERVICE → CORE → DB

CORE = LOCKED

# ⚠️ AI RULES

DO NOT:
- modify stock logic
- break traceability

YOU MAY:
- add movement system
- add validation
- improve UI

# 🧪 TESTS

1000 kg → use 200 → expect 800

Every stock change → must be logged

# 🚨 WARNING

If stock changes without movement:
SYSTEM IS BROKEN
