-- Whether the user is an active VAT payer. Decides the KUP basis:
--   true  → net amounts (input VAT is deducted, so it isn't a cost)
--   false → gross amounts (VAT can't be deducted, so it is part of the cost —
--           art. 23 ust. 1 pkt 43 ustawy o PIT)
--   null  → not set yet; the assistant shows both totals and asks.
alter table user_profiles add column if not exists vat_payer boolean;
