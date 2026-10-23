CREATE TABLE IF NOT EXISTS roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(100) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_code (code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_id BIGINT UNSIGNED NOT NULL,
  username VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS business_settings (
  setting_key VARCHAR(100) NOT NULL,
  setting_value JSON NOT NULL,
  description VARCHAR(500) NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS areas (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(100) NOT NULL,
  floor_number SMALLINT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_areas_code (code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tables (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  area_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(20) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  table_type ENUM('TABLE', 'BAR_SEAT', 'WAITING') NOT NULL DEFAULT 'TABLE',
  capacity SMALLINT UNSIGNED NULL,
  position_x DECIMAL(7, 3) NOT NULL,
  position_y DECIMAL(7, 3) NOT NULL,
  default_visible BOOLEAN NOT NULL DEFAULT TRUE,
  is_reservable BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_tables_code (code),
  KEY idx_tables_area_sort (area_id, sort_order),
  CONSTRAINT fk_tables_area FOREIGN KEY (area_id) REFERENCES areas (id),
  CONSTRAINT chk_tables_capacity CHECK (capacity IS NULL OR capacity > 0),
  CONSTRAINT chk_tables_position_x CHECK (position_x >= 0 AND position_x <= 100),
  CONSTRAINT chk_tables_position_y CHECK (position_y >= 0 AND position_y <= 100)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS table_combinations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(50) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  capacity SMALLINT UNSIGNED NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_table_combinations_code (code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS table_combination_members (
  combination_id BIGINT UNSIGNED NOT NULL,
  table_id BIGINT UNSIGNED NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (combination_id, table_id),
  CONSTRAINT fk_combination_members_combination FOREIGN KEY (combination_id)
    REFERENCES table_combinations (id) ON DELETE CASCADE,
  CONSTRAINT fk_combination_members_table FOREIGN KEY (table_id)
    REFERENCES tables (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(150) NULL,
  phone_encrypted VARBINARY(512) NULL,
  phone_last3 CHAR(3) NULL,
  customer_type ENUM('NEW', 'REGULAR', 'VIP', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  visit_count INT UNSIGNED NOT NULL DEFAULT 0,
  total_spend DECIMAL(15, 2) NOT NULL DEFAULT 0,
  last_visit_at DATETIME(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_customers_name (name),
  KEY idx_customers_phone_last3 (phone_last3),
  CONSTRAINT chk_customers_phone_last3 CHECK (phone_last3 IS NULL OR phone_last3 REGEXP '^[0-9]{3}$')
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bookings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NULL,
  business_date DATE NOT NULL,
  arrival_at DATETIME(3) NOT NULL,
  party_size SMALLINT UNSIGNED NOT NULL,
  booking_type ENUM('RESERVATION', 'WALK_IN') NOT NULL DEFAULT 'RESERVATION',
  source ENUM('HOTLINE', 'FANPAGE', 'ZALO', 'SOCIAL', 'SHAREHOLDER', 'EMPLOYEE', 'HR', 'WK', 'WALK_IN', 'OTHER') NOT NULL,
  status ENUM('PENDING_ASSIGNMENT', 'RESERVED', 'CONTACTED', 'LATE', 'NO_SHOW', 'SEATED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_ASSIGNMENT',
  guest_name_snapshot VARCHAR(150) NULL,
  phone_last3_snapshot CHAR(3) NULL,
  notes TEXT NULL,
  requested_table_note VARCHAR(255) NULL,
  is_priority BOOLEAN NOT NULL DEFAULT FALSE,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_bookings_business_date_status (business_date, status),
  KEY idx_bookings_arrival_at (arrival_at),
  KEY idx_bookings_guest_name (guest_name_snapshot),
  KEY idx_bookings_phone_last3 (phone_last3_snapshot),
  CONSTRAINT fk_bookings_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_bookings_created_by FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_bookings_updated_by FOREIGN KEY (updated_by) REFERENCES users (id),
  CONSTRAINT chk_bookings_party_size CHECK (party_size > 0),
  CONSTRAINT chk_bookings_identity CHECK (
    booking_type = 'WALK_IN'
    OR guest_name_snapshot IS NOT NULL
    OR phone_last3_snapshot IS NOT NULL
  )
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS booking_tables (
  booking_id BIGINT UNSIGNED NOT NULL,
  table_id BIGINT UNSIGNED NOT NULL,
  assigned_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  assigned_by BIGINT UNSIGNED NULL,
  PRIMARY KEY (booking_id, table_id),
  KEY idx_booking_tables_table (table_id, booking_id),
  CONSTRAINT fk_booking_tables_booking FOREIGN KEY (booking_id)
    REFERENCES bookings (id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_tables_table FOREIGN KEY (table_id)
    REFERENCES tables (id),
  CONSTRAINT fk_booking_tables_assigned_by FOREIGN KEY (assigned_by)
    REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS table_daily_states (
  business_date DATE NOT NULL,
  table_id BIGINT UNSIGNED NOT NULL,
  state ENUM('AVAILABLE', 'RESERVED', 'IN_USE') NOT NULL DEFAULT 'AVAILABLE',
  is_backup BOOLEAN NOT NULL DEFAULT FALSE,
  active_booking_id BIGINT UNSIGNED NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (business_date, table_id),
  KEY idx_table_daily_states_state (business_date, state, is_backup),
  CONSTRAINT fk_table_daily_states_table FOREIGN KEY (table_id) REFERENCES tables (id),
  CONSTRAINT fk_table_daily_states_booking FOREIGN KEY (active_booking_id) REFERENCES bookings (id),
  CONSTRAINT fk_table_daily_states_updated_by FOREIGN KEY (updated_by) REFERENCES users (id),
  CONSTRAINT chk_backup_only_available CHECK (is_backup = FALSE OR state = 'AVAILABLE')
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS booking_status_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id BIGINT UNSIGNED NOT NULL,
  from_status VARCHAR(32) NULL,
  to_status VARCHAR(32) NOT NULL,
  reason VARCHAR(500) NULL,
  changed_by BIGINT UNSIGNED NULL,
  changed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_booking_status_history_booking (booking_id, changed_at),
  CONSTRAINT fk_booking_status_history_booking FOREIGN KEY (booking_id)
    REFERENCES bookings (id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_status_history_user FOREIGN KEY (changed_by) REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS table_state_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_date DATE NOT NULL,
  table_id BIGINT UNSIGNED NOT NULL,
  from_state VARCHAR(32) NULL,
  to_state VARCHAR(32) NOT NULL,
  from_backup BOOLEAN NOT NULL DEFAULT FALSE,
  to_backup BOOLEAN NOT NULL DEFAULT FALSE,
  reason VARCHAR(500) NULL,
  changed_by BIGINT UNSIGNED NULL,
  changed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_table_state_history_table (business_date, table_id, changed_at),
  CONSTRAINT fk_table_state_history_table FOREIGN KEY (table_id) REFERENCES tables (id),
  CONSTRAINT fk_table_state_history_user FOREIGN KEY (changed_by) REFERENCES users (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS waiting_list_entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_date DATE NOT NULL,
  customer_id BIGINT UNSIGNED NULL,
  guest_name_snapshot VARCHAR(150) NULL,
  phone_last3_snapshot CHAR(3) NULL,
  party_size SMALLINT UNSIGNED NOT NULL,
  entry_type ENUM('CALLBACK', 'AT_VENUE') NOT NULL,
  status ENUM('WAITING', 'CONTACTED', 'SEATED', 'CANCELLED', 'LEFT') NOT NULL DEFAULT 'WAITING',
  requested_at DATETIME(3) NOT NULL,
  notes TEXT NULL,
  created_by BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_waiting_list_order (business_date, status, requested_at),
  CONSTRAINT fk_waiting_list_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_waiting_list_created_by FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_waiting_list_party_size CHECK (party_size > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS action_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_id VARCHAR(100) NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  action_type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(100) NOT NULL,
  before_data JSON NULL,
  after_data JSON NULL,
  undone_at DATETIME(3) NULL,
  undone_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_action_logs_device (device_id, undone_at, created_at),
  KEY idx_action_logs_entity (entity_type, entity_id, created_at),
  CONSTRAINT fk_action_logs_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_action_logs_undone_by FOREIGN KEY (undone_by) REFERENCES users (id)
) ENGINE=InnoDB;

