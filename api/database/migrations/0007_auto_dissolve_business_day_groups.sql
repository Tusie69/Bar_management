-- Preserve manual actor attribution while allowing audited business-day automation.
ALTER TABLE table_groups
  ADD COLUMN dissolve_reason VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NULL,
  DROP CHECK ck_table_groups_dissolve,
  ADD CONSTRAINT ck_table_groups_dissolve CHECK (
    (dissolved_at IS NULL AND dissolved_by_user_id IS NULL AND dissolve_reason IS NULL)
    OR
    (dissolved_at IS NOT NULL AND dissolved_at >= formed_at
      AND (
        (dissolved_by_user_id IS NOT NULL AND dissolve_reason IS NULL)
        OR
        (dissolved_by_user_id IS NULL AND dissolve_reason IS NOT NULL AND dissolve_reason = 'BUSINESS_DAY_END')
      ))
  );
