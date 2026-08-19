-- What a payment was for, in the payer's own words.
--
-- An entered debt has had one since V56 and a payment never did, so the two halves of the same
-- conversation were recorded differently: "he owes me 1.5b for the Kalos run" could be said, and
-- the 1.5b arriving back could not say which debt it answered.
--
-- Optional, and it stays optional. The card's arithmetic does not read it: a payment is against the
-- person's whole debt and not against a particular boss (see V51), so this is a label on the receipt
-- rather than a link to what it retires.

ALTER TABLE vestige_payment
    ADD COLUMN note TEXT CHECK (note IS NULL OR (length(note) > 0 AND length(note) <= 120));

COMMENT ON COLUMN vestige_payment.note IS
    'What the payment was for, optional and free text. Never read by the netting: a payment is '
    'against the whole debt, so this labels the receipt and does not say which piece of it went.';
