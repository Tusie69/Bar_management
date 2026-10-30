-- Manual O/N classification belongs to the reservation, never to the customer profile.
-- NULL remains valid for rows created before this migration and is read as UNCLASSIFIED.
ALTER TABLE reservations
  ADD COLUMN customer_classification VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER business_date,
  ADD CONSTRAINT ck_reservations_customer_classification CHECK (
    customer_classification IS NULL OR customer_classification IN ('RETURNING','NEW','UNCLASSIFIED'));
