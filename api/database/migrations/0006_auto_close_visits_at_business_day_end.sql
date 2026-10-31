ALTER TABLE visits
  DROP CHECK ck_visits_end_reason,
  DROP CHECK ck_visits_end,
  ADD CONSTRAINT ck_visits_end_reason CHECK (
    end_reason IS NULL OR end_reason IN ('GUEST_LEFT','MERGED','ENTRY_ERROR','BUSINESS_DAY_END')
  ),
  ADD CONSTRAINT ck_visits_end CHECK (
    (ended_at IS NULL AND ended_by_user_id IS NULL AND end_reason IS NULL)
    OR
    (ended_at IS NOT NULL AND end_reason IS NOT NULL AND ended_at >= started_at
      AND (
        (end_reason = 'BUSINESS_DAY_END' AND ended_by_user_id IS NULL)
        OR
        (end_reason <> 'BUSINESS_DAY_END' AND ended_by_user_id IS NOT NULL)
      ))
  );

ALTER TABLE table_allocations
  DROP CHECK ck_alloc_release,
  DROP CHECK ck_alloc_release_reason,
  ADD CONSTRAINT ck_alloc_release CHECK (
    (released_at IS NULL AND released_by_user_id IS NULL AND release_reason IS NULL)
    OR
    (released_at IS NOT NULL AND release_reason IS NOT NULL
      AND (
        (release_reason = 'BUSINESS_DAY_END' AND released_by_user_id IS NULL)
        OR
        (release_reason <> 'BUSINESS_DAY_END' AND released_by_user_id IS NOT NULL)
      ))
  ),
  ADD CONSTRAINT ck_alloc_release_reason CHECK (
    release_reason IS NULL OR release_reason IN
    ('CONVERTED_TO_USAGE','MOVED','REGROUPED','SPLIT','MERGED','GUEST_LEFT','HOLD_RELEASED',
     'RESERVATION_CANCELLED','NO_SHOW','ENTRY_ERROR','UNDO','BUSINESS_DAY_END')
  );
