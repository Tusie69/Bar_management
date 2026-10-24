-- SYNTHETIC demo for migrations/0001_initial_schema.sql and 21gam-platform.
-- Run AFTER the migration, on an EMPTY *_dev or *_test database only:
--   mysql --default-character-set=utf8mb4 --database=gam21_dev < database/seeds/demo.sql
-- Run in batch mode without --force; stop on the FIRST error and ROLLBACK.
-- Re-running is rejected, not an upsert/reset. No existing data is deleted.
-- Scenario: 21:30 Asia/Ho_Chi_Minh on today's business date (05:00 cutoff).
-- Dates move with the run date; historical data covers the previous 30 days.
-- Frontend defaults to its OWN in-memory seed; this file seeds MySQL only.
-- Users are DISABLED with unusable password markers. Provision real passwords
-- through the backend before enabling login. RBAC comes from the migration.
-- shortcut: phone fields are NULL because backend encryption keys/helpers do
-- not exist here yet; add encrypted synthetic phones through that backend.
-- Layout: 23 tables + 21 bar seats, including 3 spare tables, BAR21 unavailable.
-- B1/B2/A6L are presets, not physical tables; their catalogue remains provisional.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
SET @seed_date = DATE(UTC_TIMESTAMP(3) + INTERVAL 2 HOUR);
-- UTC instant of local midnight; local HH:mm = @day + that many minutes.
SET @day = TIMESTAMP(@seed_date) - INTERVAL 7 HOUR;
SET @scenario = @day + INTERVAL 1290 MINUTE;

CREATE TEMPORARY TABLE _gam_seed_guard (
  ok TINYINT NOT NULL,
  CONSTRAINT ck_gam_seed_guard CHECK (ok = 1)
);
START TRANSACTION;
INSERT INTO _gam_seed_guard VALUES (
  IF(COALESCE(DATABASE() REGEXP '(_dev|_test)$', 0)
    AND (SELECT COUNT(*) FROM roles WHERE code IN ('OWNER_ADMIN','RECEPTIONIST','CUSTOMER_CARE','CASHIER')) = 4
    AND (SELECT COUNT(*) FROM permissions) = 28
    AND (SELECT COUNT(*) FROM organizations) = 0
    AND (SELECT COUNT(*) FROM venues) = 0
    AND (SELECT COUNT(*) FROM users) = 0
    AND (SELECT COUNT(*) FROM memberships) = 0
    AND (SELECT COUNT(*) FROM membership_roles) = 0
    AND (SELECT COUNT(*) FROM auth_sessions) = 0
    AND (SELECT COUNT(*) FROM floors) = 0
    AND (SELECT COUNT(*) FROM zones) = 0
    AND (SELECT COUNT(*) FROM dining_tables) = 0
    AND (SELECT COUNT(*) FROM table_combinations) = 0
    AND (SELECT COUNT(*) FROM table_combination_members) = 0
    AND (SELECT COUNT(*) FROM customers) = 0
    AND (SELECT COUNT(*) FROM booking_sources) = 0
    AND (SELECT COUNT(*) FROM visits) = 0
    AND (SELECT COUNT(*) FROM reservations) = 0
    AND (SELECT COUNT(*) FROM waitlist_entries) = 0
    AND (SELECT COUNT(*) FROM waitlist_table_preferences) = 0
    AND (SELECT COUNT(*) FROM waitlist_contact_attempts) = 0
    AND (SELECT COUNT(*) FROM table_holds) = 0
    AND (SELECT COUNT(*) FROM table_groups) = 0
    AND (SELECT COUNT(*) FROM table_allocations) = 0
    AND (SELECT COUNT(*) FROM operation_log) = 0
    AND (SELECT COUNT(*) FROM idempotency_keys) = 0, 1, 0)
);

INSERT INTO organizations (id, code, name) VALUES
  (1, 'GAM21', '21GAM (giả)'), (2, 'DEMO2', 'Tổ chức khác (giả)');
INSERT INTO venues (id, organization_id, code, name) VALUES
  (1, 1, '21GAM', '21GAM (giả)'), (2, 2, 'DEMO2', 'Venue khác (giả)');
INSERT INTO users (id, username, display_name, password_hash, status) VALUES
  (1, 'demo_reception1', 'Lễ tân 1 (giả)', '!DEMO_NO_LOGIN', 'DISABLED'),
  (2, 'demo_reception2', 'Lễ tân 2 (giả)', '!DEMO_NO_LOGIN', 'DISABLED'),
  (3, 'demo_owner', 'Chủ quán (giả)', '!DEMO_NO_LOGIN', 'DISABLED'),
  (4, 'demo_care', 'CSKH (giả)', '!DEMO_NO_LOGIN', 'DISABLED'),
  (5, 'demo_cashier', 'Thu ngân (giả)', '!DEMO_NO_LOGIN', 'DISABLED'),
  (6, 'demo_other', 'Nhân viên tổ chức khác (giả)', '!DEMO_NO_LOGIN', 'DISABLED');
INSERT INTO memberships (id, organization_id, user_id) VALUES
  (1,1,1), (2,1,2), (3,1,3), (4,1,4), (5,1,5), (6,2,6);
INSERT INTO membership_roles (organization_id, membership_id, role_id, venue_id)
SELECT m.organization_id, m.id, r.id, m.organization_id
FROM memberships m JOIN roles r ON r.code = CASE m.user_id
  WHEN 3 THEN 'OWNER_ADMIN' WHEN 4 THEN 'CUSTOMER_CARE'
  WHEN 5 THEN 'CASHIER' ELSE 'RECEPTIONIST' END;

-- Same IDs/order and geometry as src/domain/venue-layout.ts + mock/seed.ts.
INSERT INTO zones (id, organization_id, venue_id, code, name, is_bookable, is_waiting_area, sort_order) VALUES
  (1,1,1,'C','Khu C',0,1,0), (2,1,1,'B','Khu B',1,0,1),
  (3,1,1,'A','Khu A',1,0,2), (4,1,1,'BAR','Quầy Bar',1,0,3),
  (5,2,2,'A','Khu A (giả)',1,0,0);
INSERT INTO dining_tables
  (id,organization_id,venue_id,zone_id,code,display_name,kind,capacity,is_spare,pos_x,pos_y,width,height) VALUES
  (1,1,1,3,'A7','Bàn A7','TABLE',4,0,80,382,46,32),
  (2,1,1,3,'A6','Bàn A6','TABLE',4,0,80,419,46,32),
  (3,1,1,3,'A5','Bàn A5','TABLE',4,0,80,468,46,32),
  (4,1,1,3,'A4','Bàn A4','TABLE',4,0,80,516,46,32),
  (5,1,1,3,'A3','Bàn A3','TABLE',4,0,80,562,46,32),
  (6,1,1,3,'A2','Bàn A2','TABLE',4,0,80,609,46,32),
  (7,1,1,3,'A1','Bàn A1','TABLE',4,0,80,654,46,32),
  (8,1,1,3,'A0','Bàn A0','TABLE',4,0,80,696,46,32),
  (9,1,1,3,'A10','Bàn A10','TABLE',4,1,231,685,38,38),
  (10,1,1,2,'B7','Bàn B7','TABLE',4,0,107,213,34,30),
  (11,1,1,2,'B8','Bàn B8','TABLE',4,0,67,259,34,30),
  (12,1,1,2,'B6','Bàn B6','TABLE',4,0,107,259,34,30),
  (13,1,1,2,'B5','Bàn B5','TABLE',4,0,107,306,34,30),
  (14,1,1,2,'B3','Bàn B3','TABLE',4,0,248,223,42,42),
  (15,1,1,2,'B4','Bàn B4','TABLE',4,0,248,285,42,42),
  (16,1,1,2,'B21','Bàn B21','TABLE',4,0,381,205,48,30),
  (17,1,1,2,'B22','Bàn B22','TABLE',4,0,381,243,48,30),
  (18,1,1,2,'B11','Bàn B11','TABLE',4,0,381,286,48,30),
  (19,1,1,2,'B12','Bàn B12','TABLE',4,0,381,325,48,30),
  (20,1,1,1,'C4','Bàn C4','TABLE',4,1,284,80,34,34),
  (21,1,1,1,'C5','Bàn C5','TABLE',4,1,284,127,34,34),
  (22,1,1,1,'C1','Bàn C1','TABLE',4,0,337,75,44,32),
  (23,1,1,1,'C2','Bàn C2','TABLE',4,0,391,75,44,32),
  (201,2,2,5,'A1','Bàn A1 (giả)','TABLE',4,0,80,654,46,32);
INSERT INTO dining_tables
  (id,organization_id,venue_id,zone_id,code,display_name,kind,capacity,seq_no,status,pos_x,pos_y,width,height) VALUES
  (101,1,1,4,'BAR01','Ghế Bar 1','BAR_SEAT',1,1,'ACTIVE',353,696,20,20),
  (102,1,1,4,'BAR02','Ghế Bar 2','BAR_SEAT',1,2,'ACTIVE',378,672,20,20),
  (103,1,1,4,'BAR03','Ghế Bar 3','BAR_SEAT',1,3,'ACTIVE',353,648,20,20),
  (104,1,1,4,'BAR04','Ghế Bar 4','BAR_SEAT',1,4,'ACTIVE',378,623,20,20),
  (105,1,1,4,'BAR05','Ghế Bar 5','BAR_SEAT',1,5,'ACTIVE',353,600,20,20),
  (106,1,1,4,'BAR06','Ghế Bar 6','BAR_SEAT',1,6,'ACTIVE',378,575,20,20),
  (107,1,1,4,'BAR07','Ghế Bar 7','BAR_SEAT',1,7,'ACTIVE',353,551,20,20),
  (108,1,1,4,'BAR08','Ghế Bar 8','BAR_SEAT',1,8,'ACTIVE',378,525,20,20),
  (109,1,1,4,'BAR09','Ghế Bar 9','BAR_SEAT',1,9,'ACTIVE',353,502,20,20),
  (110,1,1,4,'BAR10','Ghế Bar 10','BAR_SEAT',1,10,'ACTIVE',378,478,20,20),
  (111,1,1,4,'BAR11','Ghế Bar 11','BAR_SEAT',1,11,'ACTIVE',353,454,20,20),
  (112,1,1,4,'BAR12','Ghế Bar 12','BAR_SEAT',1,12,'ACTIVE',378,428,20,20),
  (113,1,1,4,'BAR13','Ghế Bar 13','BAR_SEAT',1,13,'ACTIVE',353,405,20,20),
  (114,1,1,4,'BAR14','Ghế Bar 14','BAR_SEAT',1,14,'ACTIVE',378,377,20,20),
  (115,1,1,4,'BAR15','Ghế Bar 15','BAR_SEAT',1,15,'ACTIVE',409,358,20,20),
  (116,1,1,4,'BAR16','Ghế Bar 16','BAR_SEAT',1,16,'ACTIVE',428,387,20,20),
  (117,1,1,4,'BAR17','Ghế Bar 17','BAR_SEAT',1,17,'ACTIVE',445,358,20,20),
  (118,1,1,4,'BAR18','Ghế Bar 18','BAR_SEAT',1,18,'ACTIVE',462,387,20,20),
  (119,1,1,4,'BAR19','Ghế Bar 19','BAR_SEAT',1,19,'ACTIVE',481,358,20,20),
  (120,1,1,4,'BAR20','Ghế Bar 20','BAR_SEAT',1,20,'ACTIVE',499,387,20,20),
  (121,1,1,4,'BAR21','Ghế Bar 21','BAR_SEAT',1,21,'OUT_OF_SERVICE',514,358,20,20);
INSERT INTO table_combinations (id,organization_id,venue_id,code,display_name) VALUES
  (1,1,1,'B1','B1 (B11 + B12)'), (2,1,1,'B2','B2 (B21 + B22)'), (3,1,1,'A6L','A6 dài (A6 + A7)');
INSERT INTO table_combination_members (venue_id,combination_id,table_id) VALUES
  (1,1,18), (1,1,19), (1,2,16), (1,2,17), (1,3,2), (1,3,1);
INSERT INTO booking_sources (id,organization_id,code,name,sort_order) VALUES
  (1,1,'HOTLINE','Hotline',0), (2,1,'FANPAGE','Fanpage',1), (3,1,'ZALO','Zalo',2),
  (4,1,'SHAREHOLDER','Cổ đông',3), (5,1,'STAFF','Nhân viên',4), (6,1,'SOCIAL','Social',5),
  (7,1,'OTHER','Khác',6), (8,2,'HOTLINE','Hotline',0);
INSERT INTO customers (id,organization_id,display_name,name_search,created_by_user_id) VALUES
  (1,1,'Nguyễn Minh Anh (giả)','nguyen minh anh (gia)',1),
  (2,1,'Trần Thu Hà (giả)','tran thu ha (gia)',1),
  (3,1,'Lê Gia Long (giả)','le gia long (gia)',1),
  (4,1,'Phạm Ngọc Bảo (giả)','pham ngoc bao (gia)',1),
  (5,1,'Hoàng Thanh Trâm (giả)','hoang thanh tram (gia)',1),
  (6,1,'Vũ Quốc Huy (giả)','vu quoc huy (gia)',1),
  (7,1,'Võ Khánh Linh (giả)','vo khanh linh (gia)',1),
  (8,1,'Đặng Hải Tùng (giả)','dang hai tung (gia)',1),
  (9,1,'Bùi Phương Thảo (giả)','bui phuong thao (gia)',1),
  (10,1,'Đỗ Đức Khoa (giả)','do duc khoa (gia)',1),
  (11,1,'Hồ Bảo Yến (giả)','ho bao yen (gia)',1),
  (12,1,'Ngô Quang Thịnh (giả)','ngo quang thinh (gia)',1),
  (13,1,'Dương Anh Thư (giả)','duong anh thu (gia)',1),
  (14,1,'Lý Mỹ Ngọc (giả)','ly my ngoc (gia)',1),
  (15,1,'Phan Tuấn Vy (giả)','phan tuan vy (gia)',1),
  (16,1,'Trịnh Minh Nam (giả)','trinh minh nam (gia)',1),
  (17,1,'Mai Gia Phúc (giả)','mai gia phuc (gia)',1),
  (18,1,'Đinh Thu Hân (giả)','dinh thu han (gia)',1),
  (19,1,'Tạ Quốc Duy (giả)','ta quoc duy (gia)',1),
  (20,1,'Châu Ngọc My (giả)','chau ngoc my (gia)',1),
  (21,2,'Khách tổ chức khác (giả)','khach to chuc khac (gia)',6);

-- One finished visit per day, varied sources/tables, plus 01:30 after midnight.
INSERT INTO visits
  (id,organization_id,venue_id,origin,customer_id,guest_count,started_at,business_date,
   ended_at,ended_by_user_id,end_reason,paid_marked_at,paid_marked_by_user_id,created_by_user_id,created_at)
WITH RECURSIVE days(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM days WHERE n<30)
SELECT 1000+n,1,1,IF(MOD(n,2)=0,'RESERVATION','WALK_IN'),1+MOD(n,20),2+MOD(n,3),
  @day - INTERVAL n DAY + INTERVAL (IF(n=1,1530,1080+MOD(n,6)*30)) MINUTE,
  @seed_date - INTERVAL n DAY,
  @day - INTERVAL n DAY + INTERVAL (IF(n=1,1620,1170+MOD(n,6)*30)) MINUTE,
  5,'GUEST_LEFT',@day - INTERVAL n DAY + INTERVAL (IF(n=1,1610,1160+MOD(n,6)*30)) MINUTE,
  5,1,@day - INTERVAL n DAY + INTERVAL 600 MINUTE FROM days;
INSERT INTO reservations
  (id,organization_id,venue_id,customer_id,source_id,party_size,expected_at,business_date,
   status,visit_id,checked_in_at,checked_in_by_user_id,created_by_user_id,created_at)
SELECT id,1,1,customer_id,1+MOD(id,7),guest_count,started_at-INTERVAL 4 MINUTE,business_date,
  'CHECKED_IN',id,started_at,1,1,created_at FROM visits WHERE origin='RESERVATION';
INSERT INTO table_allocations
  (organization_id,venue_id,table_id,kind,visit_id,starts_at,business_date,
   released_at,released_by_user_id,release_reason,created_by_user_id,created_at)
SELECT 1,1,CASE MOD(id,4) WHEN 0 THEN 1 WHEN 1 THEN 5 WHEN 2 THEN 14 ELSE 18 END,
  'USAGE',id,started_at,business_date,ended_at,5,'GUEST_LEFT',1,started_at FROM visits;
INSERT INTO reservations
  (id,organization_id,venue_id,customer_id,source_id,party_size,expected_at,business_date,
   status,closed_at,closed_by_user_id,close_reason_code,created_by_user_id) VALUES
  (901,1,1,11,1,4,@day-INTERVAL 1 DAY+INTERVAL 1200 MINUTE,@seed_date-INTERVAL 1 DAY,
   'CANCELLED',@day-INTERVAL 1 DAY+INTERVAL 1140 MINUTE,1,'CUSTOMER_REQUEST',1),
  (902,1,1,12,2,4,@day-INTERVAL 2 DAY+INTERVAL 1200 MINUTE,@seed_date-INTERVAL 2 DAY,
   'NO_SHOW',@day-INTERVAL 2 DAY+INTERVAL 1240 MINUTE,1,'NO_SHOW_CONFIRMED',1);

-- Live visits: reservation, paid-but-still-seated, bar, walk-in, ended, waitlist, merged.
INSERT INTO visits
  (id,organization_id,venue_id,origin,customer_id,contact_name,guest_count,started_at,business_date,
   paid_marked_at,paid_marked_by_user_id,created_by_user_id) VALUES
  (1,1,1,'RESERVATION',1,NULL,4,@day+INTERVAL 1144 MINUTE,@seed_date,NULL,NULL,1),
  (2,1,1,'RESERVATION',2,NULL,7,@day+INTERVAL 1176 MINUTE,@seed_date,@scenario-INTERVAL 6 MINUTE,5,1),
  (3,1,1,'RESERVATION',3,NULL,2,@day+INTERVAL 1202 MINUTE,@seed_date,NULL,NULL,1),
  (4,1,1,'RESERVATION',4,NULL,3,@day+INTERVAL 1188 MINUTE,@seed_date,NULL,NULL,1),
  (5,1,1,'WALK_IN',NULL,'Nhóm áo xanh (giả)',7,@day+INTERVAL 1268 MINUTE,@seed_date,NULL,NULL,1),
  (6,1,1,'WALK_IN',NULL,'Khách Bar (giả)',1,@day+INTERVAL 1274 MINUTE,@seed_date,NULL,NULL,1),
  (7,1,1,'WALK_IN',7,NULL,2,@day+INTERVAL 1080 MINUTE,@seed_date,@day+INTERVAL 1160 MINUTE,5,1),
  (8,1,1,'WAITLIST',8,NULL,4,@day+INTERVAL 1240 MINUTE,@seed_date,NULL,NULL,1),
  (9,1,1,'WALK_IN',NULL,'Nhóm nhập chung (giả)',3,@day+INTERVAL 1250 MINUTE,@seed_date,NULL,NULL,1);
UPDATE visits SET ended_at=@day+INTERVAL 1170 MINUTE,ended_by_user_id=5,end_reason='GUEST_LEFT' WHERE id=7;
UPDATE visits SET ended_at=@day+INTERVAL 1268 MINUTE,ended_by_user_id=1,end_reason='MERGED',merged_into_visit_id=5 WHERE id=9;
INSERT INTO reservations
  (id,organization_id,venue_id,customer_id,source_id,party_size,expected_at,business_date,
   status,visit_id,checked_in_at,checked_in_by_user_id,created_by_user_id) VALUES
  (1,1,1,1,1,4,@day+INTERVAL 1140 MINUTE,@seed_date,'CHECKED_IN',1,@day+INTERVAL 1144 MINUTE,1,1),
  (2,1,1,2,3,7,@day+INTERVAL 1170 MINUTE,@seed_date,'CHECKED_IN',2,@day+INTERVAL 1176 MINUTE,1,1),
  (3,1,1,3,2,2,@day+INTERVAL 1200 MINUTE,@seed_date,'CHECKED_IN',3,@day+INTERVAL 1202 MINUTE,1,1),
  (4,1,1,4,5,3,@day+INTERVAL 1185 MINUTE,@seed_date,'CHECKED_IN',4,@day+INTERVAL 1188 MINUTE,1,1);
INSERT INTO reservations
  (id,organization_id,venue_id,customer_id,source_id,party_size,expected_at,business_date,
   late_warned_at,no_show_warned_at,created_by_user_id) VALUES
  (5,1,1,5,1,4,@day+INTERVAL 1265 MINUTE,@seed_date,@day+INTERVAL 1280 MINUTE,NULL,1),
  (6,1,1,6,3,4,@day+INTERVAL 1305 MINUTE,@seed_date,NULL,NULL,1),
  (7,1,1,7,2,6,@day+INTERVAL 1255 MINUTE,@seed_date,@day+INTERVAL 1270 MINUTE,@day+INTERVAL 1285 MINUTE,1),
  (8,1,1,8,4,4,@day+INTERVAL 1320 MINUTE,@seed_date,NULL,NULL,1),
  (9,1,1,9,1,4,@day+INTERVAL 1 DAY+INTERVAL 1200 MINUTE,@seed_date+INTERVAL 1 DAY,NULL,NULL,1),
  (12,1,1,12,6,2,@day+INTERVAL 1335 MINUTE,@seed_date,NULL,NULL,1),
  (13,1,1,13,3,4,@day+INTERVAL 1380 MINUTE,@seed_date,NULL,NULL,1),
  (14,1,1,14,1,6,@day+INTERVAL 1320 MINUTE,@seed_date,NULL,NULL,1),
  (15,1,1,15,5,4,@day+INTERVAL 2 DAY+INTERVAL 1230 MINUTE,@seed_date+INTERVAL 2 DAY,NULL,NULL,1);
INSERT INTO reservations
  (id,organization_id,venue_id,customer_id,source_id,party_size,expected_at,business_date,
   status,closed_at,closed_by_user_id,close_reason_code,created_by_user_id) VALUES
  (10,1,1,10,1,4,@day+INTERVAL 1230 MINUTE,@seed_date,'CANCELLED',@day+INTERVAL 1170 MINUTE,1,'CUSTOMER_REQUEST',1),
  (11,1,1,11,2,4,@day+INTERVAL 1170 MINUTE,@seed_date,'NO_SHOW',@day+INTERVAL 1210 MINUTE,1,'NO_SHOW_CONFIRMED',1);

INSERT INTO waitlist_entries
  (id,organization_id,venue_id,kind,reservation_id,customer_id,contact_name,party_size,preference_mode,
   contact_channel,business_date,queued_at,status,claimed_by_user_id,claimed_at,claim_expires_at,
   offered_at,visit_id,closed_at,closed_by_user_id,close_reason_code,created_by_user_id) VALUES
  (1,1,1,'ADVANCE_RESERVATION',13,NULL,NULL,NULL,'PREFERRED_ONLY','ZALO_THREAD',@seed_date,@day+INTERVAL 1120 MINUTE,'WAITING',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1),
  (2,1,1,'ADVANCE_RESERVATION',14,NULL,NULL,NULL,'PREFERRED_FIRST','PHONE_CALLBACK',@seed_date,@day+INTERVAL 1150 MINUTE,'CONTACTING',2,@scenario-INTERVAL 70 SECOND,@scenario+INTERVAL 230 SECOND,NULL,NULL,NULL,NULL,NULL,1),
  (3,1,1,'WALK_IN',NULL,NULL,'Nhóm áo vàng (giả)',4,'PREFERRED_FIRST','IN_PERSON',@seed_date,@day+INTERVAL 1272 MINUTE,'WAITING',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1),
  (4,1,1,'WALK_IN',NULL,20,NULL,2,'ANY','PHONE_CALLBACK',@seed_date,@day+INTERVAL 1258 MINUTE,'HOLD_ACTIVE',NULL,NULL,NULL,@day+INTERVAL 1276 MINUTE,NULL,NULL,NULL,NULL,1),
  (5,1,1,'WALK_IN',NULL,NULL,'Anh Tuấn (giả)',4,'ANY','ZALO_THREAD',@seed_date,@day+INTERVAL 1241 MINUTE,'HOLD_ACTIVE',NULL,NULL,NULL,@day+INTERVAL 1252 MINUTE,NULL,NULL,NULL,NULL,1),
  (6,1,1,'WALK_IN',NULL,16,NULL,2,'PREFERRED_ONLY','FANPAGE_THREAD',@seed_date,@day+INTERVAL 1270 MINUTE,'OFFERED',NULL,NULL,NULL,@scenario-INTERVAL 2 MINUTE,NULL,NULL,NULL,NULL,1),
  (7,1,1,'WALK_IN',NULL,8,NULL,4,'ANY','IN_PERSON',@seed_date,@day+INTERVAL 1230 MINUTE,'SEATED',NULL,NULL,NULL,@day+INTERVAL 1238 MINUTE,8,@day+INTERVAL 1240 MINUTE,1,NULL,1),
  (8,1,1,'WALK_IN',NULL,18,NULL,2,'ANY','OTHER',@seed_date,@day+INTERVAL 1200 MINUTE,'DECLINED',NULL,NULL,NULL,NULL,NULL,@day+INTERVAL 1220 MINUTE,4,'CUSTOMER_DECLINED',1),
  (9,1,1,'WALK_IN',NULL,19,NULL,4,'ANY','ZALO_THREAD',@seed_date,@day+INTERVAL 1210 MINUTE,'CANCELLED',NULL,NULL,NULL,NULL,NULL,@day+INTERVAL 1230 MINUTE,1,'CUSTOMER_WITHDREW',1),
  (10,1,1,'WALK_IN',NULL,17,NULL,3,'ANY','PHONE_CALLBACK',@seed_date,@day+INTERVAL 1240 MINUTE,'CONTACTING',4,@scenario-INTERVAL 8 MINUTE,@scenario-INTERVAL 3 MINUTE,NULL,NULL,NULL,NULL,NULL,1);
INSERT INTO waitlist_table_preferences (organization_id,venue_id,entry_id,pref_rank,table_id,zone_id,combination_id) VALUES
  (1,1,1,1,14,NULL,NULL), (1,1,2,1,NULL,2,NULL), (1,1,2,2,NULL,NULL,1),
  (1,1,3,1,NULL,3,NULL), (1,1,6,1,13,NULL,NULL);
INSERT INTO waitlist_contact_attempts
  (organization_id,venue_id,entry_id,attempt_no,attempted_by_user_id,channel,started_at,ended_at,outcome,offered_table_ids) VALUES
  (1,1,2,1,4,'PHONE_BY_AUTHORIZED',@day+INTERVAL 1230 MINUTE,@day+INTERVAL 1231 MINUTE,'NO_ANSWER',NULL),
  (1,1,2,2,4,'PHONE_BY_AUTHORIZED',@day+INTERVAL 1260 MINUTE,@day+INTERVAL 1261 MINUTE,'CALLBACK_REQUESTED',NULL),
  (1,1,4,1,1,'PHONE_BY_AUTHORIZED',@day+INTERVAL 1274 MINUTE,@day+INTERVAL 1276 MINUTE,'ACCEPTED',JSON_ARRAY(4)),
  (1,1,5,1,1,'ZALO_THREAD',@day+INTERVAL 1250 MINUTE,@day+INTERVAL 1252 MINUTE,'ACCEPTED',JSON_ARRAY(7)),
  (1,1,6,1,4,'FANPAGE_THREAD',@scenario-INTERVAL 3 MINUTE,@scenario-INTERVAL 2 MINUTE,'OFFER_PENDING',JSON_ARRAY(13)),
  (1,1,8,1,4,'OTHER',@day+INTERVAL 1219 MINUTE,@day+INTERVAL 1220 MINUTE,'DECLINED_OFFER',JSON_ARRAY(13)),
  (1,1,3,1,1,'IN_PERSON',@scenario-INTERVAL 5 MINUTE,@scenario-INTERVAL 4 MINUTE,'KEEP_WAITING',NULL),
  (1,1,9,1,1,'ZALO_THREAD',@day+INTERVAL 1229 MINUTE,@day+INTERVAL 1230 MINUTE,'WITHDREW',NULL),
  (1,1,10,1,4,'PHONE_BY_AUTHORIZED',@scenario-INTERVAL 7 MINUTE,@scenario-INTERVAL 6 MINUTE,'WRONG_CONTACT',NULL);

INSERT INTO table_holds (id,organization_id,venue_id,hold_kind,reservation_id,starts_at,created_by_user_id) VALUES
  (1,1,1,'RESERVATION',5,@day+INTERVAL 1265 MINUTE,1),
  (2,1,1,'RESERVATION',6,@day+INTERVAL 1305 MINUTE,1),
  (3,1,1,'RESERVATION',7,@day+INTERVAL 1255 MINUTE,1),
  (4,1,1,'RESERVATION',8,@day+INTERVAL 1320 MINUTE,1),
  (5,1,1,'RESERVATION',9,@day+INTERVAL 1 DAY+INTERVAL 1200 MINUTE,1);
INSERT INTO table_holds
  (id,organization_id,venue_id,hold_kind,waitlist_entry_id,starts_at,customer_confirmed_at,
   deadline_at,deadline_basis,default_minutes_snapshot,deadline_warned_at,created_by_user_id) VALUES
  (6,1,1,'WAITLIST_OFFER',4,@day+INTERVAL 1276 MINUTE,@day+INTERVAL 1276 MINUTE,@day+INTERVAL 1306 MINUTE,'DEFAULT',30,NULL,1),
  (7,1,1,'WAITLIST_OFFER',5,@day+INTERVAL 1252 MINUTE,@day+INTERVAL 1252 MINUTE,@day+INTERVAL 1282 MINUTE,'DEFAULT',30,@day+INTERVAL 1282 MINUTE,1);
INSERT INTO table_holds
  (id,organization_id,venue_id,hold_kind,reservation_id,starts_at,status,converted_at,converted_visit_id,created_by_user_id) VALUES
  (8,1,1,'RESERVATION',1,@day+INTERVAL 1140 MINUTE,'CONVERTED',@day+INTERVAL 1144 MINUTE,1,1);
INSERT INTO table_holds
  (id,organization_id,venue_id,hold_kind,reservation_id,starts_at,status,released_at,released_by_user_id,release_reason_code,created_by_user_id) VALUES
  (9,1,1,'RESERVATION',10,@day+INTERVAL 1230 MINUTE,'RELEASED',@day+INTERVAL 1170 MINUTE,1,'RESERVATION_CANCELLED',1);
INSERT INTO table_groups (id,organization_id,venue_id,business_date,symbol_no,formed_at,formed_by_user_id) VALUES
  (1,1,1,@seed_date,2,@day+INTERVAL 1176 MINUTE,1),
  (2,1,1,@seed_date,5,@day+INTERVAL 1202 MINUTE,1),
  (3,1,1,@seed_date,4,@day+INTERVAL 1268 MINUTE,1),
  (4,1,1,@seed_date,1,@day+INTERVAL 1200 MINUTE,1);

INSERT INTO table_allocations
  (organization_id,venue_id,table_id,kind,visit_id,group_id,starts_at,business_date,created_by_user_id) VALUES
  (1,1,5,'USAGE',1,NULL,@day+INTERVAL 1144 MINUTE,@seed_date,1),
  (1,1,18,'USAGE',2,1,@day+INTERVAL 1176 MINUTE,@seed_date,1),
  (1,1,19,'USAGE',2,1,@day+INTERVAL 1176 MINUTE,@seed_date,1),
  (1,1,105,'USAGE',3,2,@day+INTERVAL 1202 MINUTE,@seed_date,1),
  (1,1,106,'USAGE',3,2,@day+INTERVAL 1202 MINUTE,@seed_date,1),
  (1,1,6,'USAGE',4,NULL,@day+INTERVAL 1210 MINUTE,@seed_date,1),
  (1,1,11,'USAGE',5,3,@day+INTERVAL 1268 MINUTE,@seed_date,1),
  (1,1,12,'USAGE',5,3,@day+INTERVAL 1268 MINUTE,@seed_date,1),
  (1,1,110,'USAGE',6,NULL,@day+INTERVAL 1274 MINUTE,@seed_date,1),
  (1,1,10,'USAGE',8,NULL,@day+INTERVAL 1240 MINUTE,@seed_date,1);
INSERT INTO table_allocations
  (organization_id,venue_id,table_id,kind,hold_id,group_id,starts_at,business_date,created_by_user_id) VALUES
  (1,1,14,'HOLD',1,NULL,@day+INTERVAL 1200 MINUTE,@seed_date,1),
  (1,1,3,'HOLD',2,NULL,@day+INTERVAL 1200 MINUTE,@seed_date,1),
  (1,1,1,'HOLD',3,4,@day+INTERVAL 1200 MINUTE,@seed_date,1),
  (1,1,2,'HOLD',3,4,@day+INTERVAL 1200 MINUTE,@seed_date,1),
  (1,1,15,'HOLD',4,NULL,@day+INTERVAL 1200 MINUTE,@seed_date,1),
  (1,1,14,'HOLD',5,NULL,@day+INTERVAL 1200 MINUTE,@seed_date+INTERVAL 1 DAY,1),
  (1,1,4,'HOLD',6,NULL,@day+INTERVAL 1276 MINUTE,@seed_date,1),
  (1,1,7,'HOLD',7,NULL,@day+INTERVAL 1252 MINUTE,@seed_date,1);
INSERT INTO table_allocations
  (organization_id,venue_id,table_id,kind,visit_id,hold_id,starts_at,business_date,
   released_at,released_by_user_id,release_reason,created_by_user_id) VALUES
  (1,1,7,'USAGE',4,NULL,@day+INTERVAL 1188 MINUTE,@seed_date,@day+INTERVAL 1210 MINUTE,1,'MOVED',1),
  (1,1,8,'USAGE',7,NULL,@day+INTERVAL 1080 MINUTE,@seed_date,@day+INTERVAL 1170 MINUTE,5,'GUEST_LEFT',1),
  (1,1,13,'USAGE',9,NULL,@day+INTERVAL 1250 MINUTE,@seed_date,@day+INTERVAL 1268 MINUTE,1,'MERGED',1),
  (1,1,5,'HOLD',NULL,8,@day+INTERVAL 1080 MINUTE,@seed_date,@day+INTERVAL 1144 MINUTE,1,'CONVERTED_TO_USAGE',1),
  (1,1,13,'HOLD',NULL,9,@day+INTERVAL 1080 MINUTE,@seed_date,@day+INTERVAL 1170 MINUTE,1,'RESERVATION_CANCELLED',1);

-- PII-free audit examples; no fabricated before/after snapshots or undo payloads.
INSERT INTO operation_log
  (organization_id,venue_id,change_seq,occurred_at,actor_kind,actor_user_id,action,entity_type,entity_id) VALUES
  (1,1,1,@day+INTERVAL 1144 MINUTE,'USER',1,'CHECKED_IN','reservation',1),
  (1,1,2,@day+INTERVAL 1210 MINUTE,'USER',1,'TABLE_MOVED','visit',4),
  (1,1,3,@day+INTERVAL 1252 MINUTE,'USER',1,'HOLD_ACCEPTED','waitlist_entry',5),
  (1,1,4,@day+INTERVAL 1268 MINUTE,'USER',1,'WALKIN_SEATED','visit',5),
  (1,1,5,@day+INTERVAL 1276 MINUTE,'USER',1,'HOLD_ACCEPTED','waitlist_entry',4),
  (1,1,6,@day+INTERVAL 1280 MINUTE,'SYSTEM',NULL,'RESERVATION_LATE_WARNING','reservation',5),
  (1,1,7,@day+INTERVAL 1282 MINUTE,'SYSTEM',NULL,'HOLD_DEADLINE_WARNING','table_hold',7),
  (1,1,8,@day+INTERVAL 1285 MINUTE,'SYSTEM',NULL,'RESERVATION_NO_SHOW_WARNING','reservation',7);
UPDATE venues SET change_seq=8 WHERE id=1;

-- Small self-check before commit: catalogue, status coverage, owner links,
-- business dates, overlap, and the overdue hold that must STILL occupy A1.
INSERT INTO _gam_seed_guard VALUES (IF(
  (SELECT COUNT(*) FROM dining_tables WHERE venue_id=1) = 44
  AND (SELECT COUNT(*) FROM dining_tables WHERE venue_id=1 AND kind='BAR_SEAT') = 21
  AND (SELECT COUNT(*) FROM dining_tables WHERE venue_id=1 AND is_spare=1) = 3
  AND (SELECT COUNT(*) FROM membership_roles) = 6
  AND (SELECT COUNT(DISTINCT status) FROM reservations) = 4
  AND (SELECT COUNT(DISTINCT status) FROM waitlist_entries) = 7
  AND (SELECT COUNT(DISTINCT outcome) FROM waitlist_contact_attempts) = 8
  AND (SELECT COUNT(*) FROM visits) = 39
  AND NOT EXISTS (
    SELECT 1 FROM reservations r JOIN visits v ON v.id=r.visit_id
    WHERE r.status='CHECKED_IN' AND (r.checked_in_at<>v.started_at OR r.business_date<>v.business_date))
  AND NOT EXISTS (
    SELECT 1 FROM visits WHERE business_date<>DATE(started_at+INTERVAL 2 HOUR))
  AND NOT EXISTS (
    SELECT 1 FROM table_allocations a JOIN table_allocations b
      ON a.venue_id=b.venue_id AND a.table_id=b.table_id AND a.business_date=b.business_date AND a.id<b.id
    WHERE a.starts_at<COALESCE(b.released_at,'9999-12-31')
      AND b.starts_at<COALESCE(a.released_at,'9999-12-31'))
  AND EXISTS (
    SELECT 1 FROM table_holds h JOIN table_allocations a ON a.hold_id=h.id
    WHERE h.id=7 AND h.status='ACTIVE' AND h.deadline_at<@scenario AND a.released_at IS NULL), 1, 0));
COMMIT;
DROP TEMPORARY TABLE _gam_seed_guard;
SELECT @seed_date AS business_date, @scenario AS scenario_utc,
  (SELECT COUNT(*) FROM dining_tables WHERE venue_id=1) AS positions,
  (SELECT COUNT(*) FROM customers WHERE organization_id=1) AS customers,
  (SELECT COUNT(*) FROM reservations WHERE venue_id=1) AS reservations,
  (SELECT COUNT(*) FROM visits WHERE venue_id=1) AS visits,
  (SELECT COUNT(*) FROM waitlist_entries WHERE venue_id=1) AS waitlist_entries;

