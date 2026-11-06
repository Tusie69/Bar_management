ALTER TABLE reservations
  ADD KEY ix_reservations_venue_date_last3 (venue_id, business_date, phone_last3);
