CREATE TABLE IF NOT EXISTS table_daily_statuses (
  table_id BIGINT UNSIGNED NOT NULL,
  business_date DATE NOT NULL,
  status ENUM('AVAILABLE', 'RESERVED', 'OCCUPIED', 'DISABLED', 'BACKUP_INACTIVE') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (table_id, business_date),
  KEY idx_table_statuses_date_status (business_date, status),
  CONSTRAINT fk_table_statuses_table FOREIGN KEY (table_id) REFERENCES tables(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
)
