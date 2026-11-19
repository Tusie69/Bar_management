# TU-38 — API Sổ lượt tới quán: bằng chứng kiểm thử

Endpoint duy nhất: `GET /api/v1/visits/turns/summary`, mở rộng từ TU-25/NA-34 thay vì tạo API
mới. Hợp đồng đầy đủ nằm ở `docs/api.md`, mục **Turn statistics (TU-38)**.

Môi trường đo: MySQL cục bộ, database `gam21_platform_it_test` (không phải production),
`NODE_ENV=test`, `RUN_MYSQL_INTEGRATION=1`.

## 1. Bảng endpoint

| Method | Path | Quyền | Tham số thêm của TU-38 | Trả về thêm |
| ------ | ---- | ----- | ---------------------- | ----------- |
| GET | `/api/v1/visits/turns/summary?from=&to=` | `report.read` | `includeZeroScopes=true\|false` | `scopeTotal`, `physicalTableTotal`, `averagePerScope`, `averagePerPhysicalTable`, `byMonth[]`, và các dòng `byScope` 0 lượt khi bật cờ |
| GET | `/api/v1/visits/turns?from=&to=` | `report.read` | — | không đổi |

Mã lỗi: 401 khi không có phiên, 403 `PERMISSION_DENIED` khi thiếu `report.read`,
400 `INVALID_BUSINESS_DATE` / `INVALID_DATE_RANGE` / `DATE_RANGE_TOO_WIDE` /
`INVALID_INCLUDE_UNCOUNTED` / `INVALID_INCLUDE_ZERO_SCOPES` /
`INVALID_CHECKED_IN_BY_USER_ID` / `INVALID_CLOSED_BY_USER_ID`.

## 2. Bằng chứng gọi API

Bản ghi dưới đây do `api/test/tu38-evidence.mysql.test.ts` in ra khi chạy thật qua app
Express (đăng nhập, cookie, RBAC đầy đủ), không phải ví dụ viết tay:

```powershell
cd Bar_management/api
$env:RUN_MYSQL_INTEGRATION='1'; $env:DB_NAME='gam21_platform_it_test'; $env:NODE_ENV='test'
npx vitest run test/tu38-evidence.mysql.test.ts --disableConsoleIntercept
```

Dữ liệu mẫu: cụm cố định B3+B4 phục vụ 2 lượt (6 và 4 khách), bàn B5 phục vụ 1 lượt (3 khách).
Quán có 4 bàn ACTIVE không dự phòng (A1, B3, B4, B5), nên `scopeTotal` = 3 (A1, B5, cụm B3+B4)
và `physicalTableTotal` = 4.

### owner, one operating day

```http
GET /api/v1/visits/turns/summary?from=2030-10-24&to=2030-10-24

HTTP/1.1 200
```

```json
{
  "from": "2030-10-24",
  "to": "2030-10-24",
  "completedTotal": 3,
  "openTotal": 0,
  "guestTotal": 13,
  "scopeTotal": 3,
  "physicalTableTotal": 4,
  "averagePerScope": 1,
  "averagePerPhysicalTable": 0.75,
  "byBusinessDate": [
    {
      "businessDate": "2030-10-24",
      "turns": 3,
      "guests": 13
    }
  ],
  "byMonth": [
    {
      "month": "2030-10",
      "turns": 3,
      "guests": 13
    }
  ],
  "byStaff": [
    {
      "checkedInByUserId": 9801,
      "checkedInByDisplayName": "integration_reception",
      "turns": 3,
      "guests": 13
    }
  ],
  "byScope": [
    {
      "scope": "GROUP",
      "tableId": null,
      "groupId": 4556,
      "label": "G01",
      "turns": 2,
      "guests": 10
    },
    {
      "scope": "TABLE",
      "tableId": 9842,
      "groupId": null,
      "label": "B5",
      "turns": 1,
      "guests": 3
    }
  ]
}
```

### owner, including zero-turn scopes

```http
GET /api/v1/visits/turns/summary?from=2030-10-24&to=2030-10-24&includeZeroScopes=true

HTTP/1.1 200
```

```json
{
  "from": "2030-10-24",
  "to": "2030-10-24",
  "completedTotal": 3,
  "openTotal": 0,
  "guestTotal": 13,
  "scopeTotal": 3,
  "physicalTableTotal": 4,
  "averagePerScope": 1,
  "averagePerPhysicalTable": 0.75,
  "byBusinessDate": [
    {
      "businessDate": "2030-10-24",
      "turns": 3,
      "guests": 13
    }
  ],
  "byMonth": [
    {
      "month": "2030-10",
      "turns": 3,
      "guests": 13
    }
  ],
  "byStaff": [
    {
      "checkedInByUserId": 9801,
      "checkedInByDisplayName": "integration_reception",
      "turns": 3,
      "guests": 13
    }
  ],
  "byScope": [
    {
      "scope": "GROUP",
      "tableId": null,
      "groupId": 4556,
      "label": "G01",
      "turns": 2,
      "guests": 10
    },
    {
      "scope": "TABLE",
      "tableId": 9842,
      "groupId": null,
      "label": "B5",
      "turns": 1,
      "guests": 3
    },
    {
      "scope": "TABLE",
      "tableId": 9801,
      "groupId": null,
      "label": "A1",
      "turns": 0,
      "guests": 0
    }
  ]
}
```

### owner, a month

```http
GET /api/v1/visits/turns/summary?from=2030-10-01&to=2030-10-31

HTTP/1.1 200
```

```json
{
  "from": "2030-10-01",
  "to": "2030-10-31",
  "completedTotal": 3,
  "openTotal": 0,
  "guestTotal": 13,
  "scopeTotal": 3,
  "physicalTableTotal": 4,
  "averagePerScope": 1,
  "averagePerPhysicalTable": 0.75,
  "byBusinessDate": [
    {
      "businessDate": "2030-10-24",
      "turns": 3,
      "guests": 13
    }
  ],
  "byMonth": [
    {
      "month": "2030-10",
      "turns": 3,
      "guests": 13
    }
  ],
  "byStaff": [
    {
      "checkedInByUserId": 9801,
      "checkedInByDisplayName": "integration_reception",
      "turns": 3,
      "guests": 13
    }
  ],
  "byScope": [
    {
      "scope": "GROUP",
      "tableId": null,
      "groupId": 4556,
      "label": "G01",
      "turns": 2,
      "guests": 10
    },
    {
      "scope": "TABLE",
      "tableId": 9842,
      "groupId": null,
      "label": "B5",
      "turns": 1,
      "guests": 3
    }
  ]
}
```

### receptionist, no report.read

```http
GET /api/v1/visits/turns/summary?from=2030-10-24&to=2030-10-24

HTTP/1.1 403
```

```json
{
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "Tài khoản không có quyền thực hiện thao tác này."
  }
}
```

### owner, invalid includeZeroScopes

```http
GET /api/v1/visits/turns/summary?from=2030-10-24&to=2030-10-24&includeZeroScopes=1

HTTP/1.1 400
```

```json
{
  "error": {
    "code": "INVALID_INCLUDE_ZERO_SCOPES",
    "message": "includeZeroScopes phải là true hoặc false."
  }
}
```

## 3. Benchmark và EXPLAIN

```powershell
cd Bar_management/api
$env:RUN_MYSQL_INTEGRATION='1'; $env:DB_NAME='gam21_platform_it_test'; $env:NODE_ENV='test'
npx vitest run test/tu38-turn-statistics-benchmark.mysql.test.ts --disableConsoleIntercept
```

Dữ liệu mẫu: 3 tháng (30 bàn × 30 ngày vận hành × 2 lượt/đêm = 5 400 lượt), truy vấn 1 tháng.
Ba tháng thay vì một, vì nếu bảng chỉ chứa đúng tháng được hỏi thì optimizer quét cả bảng là
đúng và kế hoạch truy vấn không chứng minh được gì về index.

Kết quả đo: `[TU-38 AC07] 1800 turns / 30 days — median 102.9ms, slowest 119.0ms, budget 2000ms`

Median 102.9ms trên ngân sách 2000ms. Các kế hoạch truy vấn:

```text
[TU-38 AC07] EXPLAIN totals
-> Aggregate: sum(if((t.counted = 1),t.guest_count,0)), count((case when (t.counted = 1) then 1 end)), count((case when (t.`status` = 'OPEN') then 1 end))  (cost=141..141 rows=1)
    -> Index lookup on t using <auto_key0> (counted = 1)  (cost=69.2..72.4 rows=10)
        -> Materialize CTE turns  (cost=68.9..68.9 rows=299)
            -> Window aggregate: count((case when (raw_turns.counted = 1) then 1 end)) OVER (PARTITION BY raw_turns.business_date,raw_turns.scope,raw_turns.table_id,raw_turns.group_id ORDER BY raw_turns.seated_at,raw_turns.visit_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)   (cost=0 rows=299)
                -> Sort: raw_turns.business_date, raw_turns.scope, raw_turns.table_id, raw_turns.group_id, raw_turns.seated_at, raw_turns.visit_id  (cost=469..469 rows=299)
                    -> Table scan on raw_turns  (cost=281..287 rows=299)
                        -> Materialize union CTE raw_turns  (cost=281..281 rows=299)
                            -> Nested loop inner join  (cost=207 rows=299)
                                -> Filter: (visits.business_date between '2030-09-01' and '2030-09-30')  (cost=103 rows=299)
                                    -> Index lookup on visits using ix_visits_org_venue (organization_id = 1, venue_id = 1)  (cost=103 rows=2690)
                                -> Filter: (t.organization_id = 1)  (cost=0.25 rows=1)
                                    -> Single-row index lookup on t using uq_turn_visit (venue_id = 1, visit_id = visits.id)  (cost=0.25 rows=1)
                            -> Nested loop left join  (cost=4.45 rows=0.00299)
                                -> Nested loop left join  (cost=4.4 rows=0.00299)
                                    -> Nested loop left join  (cost=4.34 rows=0.00299)
                                        -> Nested loop left join  (cost=4.28 rows=0.0538)
                                            -> Nested loop inner join  (cost=4.25 rows=0.0538)
                                                -> Table scan on a  (cost=3.65..3.65 rows=0.969)
                                                    -> Materialize CTE open_allocations  (cost=1.15..1.15 rows=0.969)
                                                        -> Group aggregate: max(g.id), max(g.origin), count(distinct a.group_id), min(a.table_id), max(g.`name`), max(g.symbol_no), json_arrayagg(d.`code`), json_arrayagg(a.table_id)  (cost=0.931 rows=0.969)
                                                            -> Nested loop antijoin  (cost=0.708 rows=0.969)
                                                                -> Nested loop inner join  (cost=0.597 rows=0.969)
                                                                    -> Nested loop left join  (cost=0.483 rows=1)
                                                                        -> Nested loop inner join  (cost=0.369 rows=1)
                                                                            -> Sort: visit_id  (cost=0.256 rows=1)
                                                                                -> Filter: ((visits.organization_id = 1) and (visits.business_date between '2030-09-01' and '2030-09-30'))  (cost=0.256 rows=1)
                                                                                    -> Index lookup on visits using ix_visits_venue_open (venue_id = 1, ended_at = NULL), with index condition: (visits.ended_at is null)  (cost=0.256 rows=1)
                                                                            -> Filter: ((a.kind = 'USAGE') and (a.visit_id = visits.id) and (a.organization_id = 1) and (a.released_at is null))  (cost=2.05 rows=1)
                                                                                -> Index lookup on a using uq_alloc_one_active_usage (venue_id = 1)  (cost=2.05 rows=1)
                                                                        -> Filter: ((g.venue_id = 1) and (g.organization_id = 1))  (cost=2.05 rows=1)
                                                                            -> Single-row index lookup on g using PRIMARY (id = a.group_id)  (cost=2.05 rows=1)
                                                                    -> Filter: ((d.venue_id = 1) and (d.organization_id = 1))  (cost=1.99 rows=0.969)
                                                                        -> Single-row index lookup on d using PRIMARY (id = a.table_id)  (cost=1.99 rows=1)
                                                                -> Nested loop inner join  (cost=2.22 rows=1)
                                                                    -> Filter: ((visits.venue_id = 1) and (visits.organization_id = 1) and (visits.business_date between '2030-09-01' and '2030-09-30'))  (cost=2.11 rows=1)
                                                                        -> Single-row index lookup on visits using PRIMARY (id = visits.id)  (cost=2.11 rows=1)
                                                                    -> Filter: (t.organization_id = 1)  (cost=2.11 rows=1)
                                                                        -> Single-row index lookup on t using uq_turn_visit (venue_id = 1, visit_id = visits.id)  (cost=2.11 rows=1)
                                                -> Filter: ((visits.venue_id = 1) and (visits.organization_id = 1) and (visits.business_date between '2030-09-01' and '2030-09-30'))  (cost=0.253 rows=0.0556)
                                                    -> Single-row index lookup on visits using PRIMARY (id = a.visit_id)  (cost=0.253 rows=1)
                                            -> Filter: (c.organization_id = 1)  (cost=1.15 rows=1)
                                                -> Single-row index lookup on c using PRIMARY (id = visits.customer_id)  (cost=1.15 rows=1)
                                        -> Covering index lookup on vb using <auto_key0> (visit_id = a.visit_id)  (cost=1.88..3.03 rows=2)
                                            -> Materialize CTE visit_bookings  (cost=0.726..0.726 rows=0.0556)
                                                -> Group aggregate: min(r.id)  (cost=0.713 rows=0.0556)
                                                    -> Nested loop inner join  (cost=0.7 rows=0.0556)
                                                        -> Filter: (r.organization_id = 1)  (cost=0.35 rows=1)
                                                            -> Index lookup on r using ix_reservations_visit (venue_id = 1), with index condition: (r.visit_id is not null)  (cost=0.35 rows=1)
                                                        -> Filter: ((visits.venue_id = 1) and (visits.organization_id = 1) and (visits.business_date between '2030-09-01' and '2030-09-30'))  (cost=0.256 rows=0.0556)
                                                            -> Single-row index lookup on visits using PRIMARY (id = r.visit_id)  (cost=0.256 rows=1)
                                    -> Filter: ((r.venue_id = 1) and (r.organization_id = 1))  (cost=0.7 rows=1)
                                        -> Single-row index lookup on r using PRIMARY (id = vb.id)  (cost=0.7 rows=1)
                                -> Filter: (bs.organization_id = 1)  (cost=0.7 rows=1)
                                    -> Single-row index lookup on bs using PRIMARY (id = r.source_id)  (cost=0.7 rows=1)

[TU-38 AC07] EXPLAIN byBusinessDate
-> Sort: t.business_date
    -> Table scan on <temporary>
        -> Aggregate using temporary table
            -> Index lookup on t using <auto_key0> (counted = 1)  (cost=69.2..72.4 rows=10)
                -> Materialize CTE turns  (cost=68.9..68.9 rows=299)
                    -> Window aggregate: count((case when (raw_turns.counted = 1) then 1 end)) OVER (PARTITION BY raw_turns.business_date,raw_turns.scope,raw_turns.table_id,raw_turns.group_id ORDER BY raw_turns.seated_at,raw_turns.visit_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)   (cost=0 rows=299)
                        -> Sort: raw_turns.business_date, raw_turns.scope, raw_turns.table_id, raw_turns.group_id, raw_turns.seated_at, raw_turns.visit_id  (cost=469..469 rows=299)
                            -> Table scan on raw_turns  (cost=281..287 rows=299)
                                -> Materialize union CTE raw_turns  (cost=281..281 rows=299)
                                    -> Nested loop inner join  (cost=207 rows=299)
                                        -> Filter: (visits.business_date between '2030-09-01' and '2030-09-30')  (cost=103 rows=299)
                                            -> Index lookup on visits using ix_visits_org_venue (organization_id = 1, venue_id = 1)  (cost=103 rows=2690)
                                        -> Filter: (t.organization_id = 1)  (cost=0.25 rows=1)
                                            -> Single-row index lookup on t using uq_turn_visit (venue_id = 1, visit_id = visits.id)  (cost=0.25 rows=1)
                                    -> Nested loop left join  (cost=4.45 rows=0.00299)
                                        -> Nested loop left join  (cost=4.4 rows=0.00299)
                                            -> Nested loop left join  (cost=4.34 rows=0.00299)
                                                -> Nested loop left join  (cost=4.28 rows=0.0538)
                                                    -> Nested loop inner join  (cost=4.25 rows=0.0538)
                                                        -> Table scan on a  (cost=3.65..3.65 rows=0.969)
                                                            -> Materialize CTE open_allocations  (cost=1.15..1.15 rows=0.969)
                                                                -> Group aggregate: max(g.id), max(g.origin), count(distinct a.group_id), min(a.table_id), max(g.`name`), max(g.symbol_no), json_arrayagg(d.`code`), json_arrayagg(a.table_id)  (cost=0.931 rows=0.969)
                                                                    -> Nested loop antijoin  (cost=0.708 rows=0.969)
                                                                        -> Nested loop inner join  (cost=0.597 rows=0.969)
                                                                            -> Nested loop left join  (cost=0.483 rows=1)
                                                                                -> Nested loop inner join  (cost=0.369 rows=1)
                                                                                    -> Sort: visit_id  (cost=0.256 rows=1)
                                                                                        -> Filter: ((visits.organization_id = 1) and (visits.business_date between '2030-09-01' and '2030-09-30'))  (cost=0.256 rows=1)
                                                                                            -> Index lookup on visits using ix_visits_venue_open (venue_id = 1, ended_at = NULL), with index condition: (visits.ended_at is null)  (cost=0.256 rows=1)
                                                                                    -> Filter: ((a.kind = 'USAGE') and (a.visit_id = visits.id) and (a.organization_id = 1) and (a.released_at is null))  (cost=2.05 rows=1)
                                                                                        -> Index lookup on a using uq_alloc_one_active_usage (venue_id = 1)  (cost=2.05 rows=1)
                                                                                -> Filter: ((g.venue_id = 1) and (g.organization_id = 1))  (cost=2.05 rows=1)
                                                                                    -> Single-row index lookup on g using PRIMARY (id = a.group_id)  (cost=2.05 rows=1)
                                                                            -> Filter: ((d.venue_id = 1) and (d.organization_id = 1))  (cost=1.99 rows=0.969)
                                                                                -> Single-row index lookup on d using PRIMARY (id = a.table_id)  (cost=1.99 rows=1)
                                                                        -> Nested loop inner join  (cost=2.22 rows=1)
                                                                            -> Filter: ((visits.venue_id = 1) and (visits.organization_id = 1) and (visits.business_date between '2030-09-01' and '2030-09-30'))  (cost=2.11 rows=1)
                                                                                -> Single-row index lookup on visits using PRIMARY (id = visits.id)  (cost=2.11 rows=1)
                                                                            -> Filter: (t.organization_id = 1)  (cost=2.11 rows=1)
                                                                                -> Single-row index lookup on t using uq_turn_visit (venue_id = 1, visit_id = visits.id)  (cost=2.11 rows=1)
                                                        -> Filter: ((visits.venue_id = 1) and (visits.organization_id = 1) and (visits.business_date between '2030-09-01' and '2030-09-30'))  (cost=0.253 rows=0.0556)
                                                            -> Single-row index lookup on visits using PRIMARY (id = a.visit_id)  (cost=0.253 rows=1)
                                                    -> Filter: (c.organization_id = 1)  (cost=1.15 rows=1)
                                                        -> Single-row index lookup on c using PRIMARY (id = visits.customer_id)  (cost=1.15 rows=1)
                                                -> Covering index lookup on vb using <auto_key0> (visit_id = a.visit_id)  (cost=1.88..3.03 rows=2)
                                                    -> Materialize CTE visit_bookings  (cost=0.726..0.726 rows=0.0556)
                                                        -> Group aggregate: min(r.id)  (cost=0.713 rows=0.0556)
                                                            -> Nested loop inner join  (cost=0.7 rows=0.0556)
                                                                -> Filter: (r.organization_id = 1)  (cost=0.35 rows=1)
                                                                    -> Index lookup on r using ix_reservations_visit (venue_id = 1), with index condition: (r.visit_id is not null)  (cost=0.35 rows=1)
                                                                -> Filter: ((visits.venue_id = 1) and (visits.organization_id = 1) and (visits.business_date between '2030-09-01' and '2030-09-30'))  (cost=0.256 rows=0.0556)
                                                                    -> Single-row index lookup on visits using PRIMARY (id = r.visit_id)  (cost=0.256 rows=1)
                                            -> Filter: ((r.venue_id = 1) and (r.organization_id = 1))  (cost=0.7 rows=1)
                                                -> Single-row index lookup on r using PRIMARY (id = vb.id)  (cost=0.7 rows=1)
                                        -> Filter: (bs.organization_id = 1)  (cost=0.7 rows=1)
                                            -> Single-row index lookup on bs using PRIMARY (id = r.source_id)  (cost=0.7 rows=1)

[TU-38 AC07] EXPLAIN byMonth
-> Sort: month
    -> Table scan on <temporary>
        -> Aggregate using temporary table
            -> Index lookup on t using <auto_key0> (counted = 1)  (cost=69.2..72.4 rows=10)
                -> Materialize CTE turns  (cost=68.9..68.9 rows=299)
                    -> Window aggregate: count((case when (raw_turns.counted = 1) then 1 end)) OVER (PARTITION BY raw_turns.business_date,raw_turns.scope,raw_turns.table_id,raw_turns.group_id ORDER BY raw_turns.seated_at,raw_turns.visit_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)   (cost=0 rows=299)
                        -> Sort: raw_turns.business_date, raw_turns.scope, raw_turns.table_id, raw_turns.group_id, raw_turns.seated_at, raw_turns.visit_id  (cost=469..469 rows=299)
                            -> Table scan on raw_turns  (cost=281..287 rows=299)
                                -> Materialize union CTE raw_turns  (cost=281..281 rows=299)
                                    -> Nested loop inner join  (cost=207 rows=299)
                                        -> Filter: (visits.business_date between '2030-09-01' and '2030-09-30')  (cost=103 rows=299)
                                            -> Index lookup on visits using ix_visits_org_venue (organization_id = 1, venue_id = 1)  (cost=103 rows=2690)
                                        -> Filter: (t.organization_id = 1)  (cost=0.25 rows=1)
                                            -> Single-row index lookup on t using uq_turn_visit (venue_id = 1, visit_id = visits.id)  (cost=0.25 rows=1)
                                    -> Nested loop left join  (cost=4.45 rows=0.00299)
                                        -> Nested loop left join  (cost=4.4 rows=0.00299)
                                            -> Nested loop left join  (cost=4.34 rows=0.00299)
                                                -> Nested loop left join  (cost=4.28 rows=0.0538)
                                                    -> Nested loop inner join  (cost=4.25 rows=0.0538)
                                                        -> Table scan on a  (cost=3.65..3.65 rows=0.969)
                                                            -> Materialize CTE open_allocations  (cost=1.15..1.15 rows=0.969)
                                                                -> Group aggregate: max(g.id), max(g.origin), count(distinct a.group_id), min(a.table_id), max(g.`name`), max(g.symbol_no), json_arrayagg(d.`code`), json_arrayagg(a.table_id)  (cost=0.931 rows=0.969)
                                                                    -> Nested loop antijoin  (cost=0.708 rows=0.969)
                                                                        -> Nested loop inner join  (cost=0.597 rows=0.969)
                                                                            -> Nested loop left join  (cost=0.483 rows=1)
                                                                                -> Nested loop inner join  (cost=0.369 rows=1)
                                                                                    -> Sort: visit_id  (cost=0.256 rows=1)
                                                                                        -> Filter: ((visits.organization_id = 1) and (visits.business_date between '2030-09-01' and '2030-09-30'))  (cost=0.256 rows=1)
                                                                                            -> Index lookup on visits using ix_visits_venue_open (venue_id = 1, ended_at = NULL), with index condition: (visits.ended_at is null)  (cost=0.256 rows=1)
                                                                                    -> Filter: ((a.kind = 'USAGE') and (a.visit_id = visits.id) and (a.organization_id = 1) and (a.released_at is null))  (cost=2.05 rows=1)
                                                                                        -> Index lookup on a using uq_alloc_one_active_usage (venue_id = 1)  (cost=2.05 rows=1)
                                                                                -> Filter: ((g.venue_id = 1) and (g.organization_id = 1))  (cost=2.05 rows=1)
                                                                                    -> Single-row index lookup on g using PRIMARY (id = a.group_id)  (cost=2.05 rows=1)
                                                                            -> Filter: ((d.venue_id = 1) and (d.organization_id = 1))  (cost=1.99 rows=0.969)
                                                                                -> Single-row index lookup on d using PRIMARY (id = a.table_id)  (cost=1.99 rows=1)
                                                                        -> Nested loop inner join  (cost=2.22 rows=1)
                                                                            -> Filter: ((visits.venue_id = 1) and (visits.organization_id = 1) and (visits.business_date between '2030-09-01' and '2030-09-30'))  (cost=2.11 rows=1)
                                                                                -> Single-row index lookup on visits using PRIMARY (id = visits.id)  (cost=2.11 rows=1)
                                                                            -> Filter: (t.organization_id = 1)  (cost=2.11 rows=1)
                                                                                -> Single-row index lookup on t using uq_turn_visit (venue_id = 1, visit_id = visits.id)  (cost=2.11 rows=1)
                                                        -> Filter: ((visits.venue_id = 1) and (visits.organization_id = 1) and (visits.business_date between '2030-09-01' and '2030-09-30'))  (cost=0.253 rows=0.0556)
                                                            -> Single-row index lookup on visits using PRIMARY (id = a.visit_id)  (cost=0.253 rows=1)
                                                    -> Filter: (c.organization_id = 1)  (cost=1.15 rows=1)
                                                        -> Single-row index lookup on c using PRIMARY (id = visits.customer_id)  (cost=1.15 rows=1)
                                                -> Covering index lookup on vb using <auto_key0> (visit_id = a.visit_id)  (cost=1.88..3.03 rows=2)
                                                    -> Materialize CTE visit_bookings  (cost=0.726..0.726 rows=0.0556)
                                                        -> Group aggregate: min(r.id)  (cost=0.713 rows=0.0556)
                                                            -> Nested loop inner join  (cost=0.7 rows=0.0556)
                                                                -> Filter: (r.organization_id = 1)  (cost=0.35 rows=1)
                                                                    -> Index lookup on r using ix_reservations_visit (venue_id = 1), with index condition: (r.visit_id is not null)  (cost=0.35 rows=1)
                                                                -> Filter: ((visits.venue_id = 1) and (visits.organization_id = 1) and (visits.business_date between '2030-09-01' and '2030-09-30'))  (cost=0.256 rows=0.0556)
                                                                    -> Single-row index lookup on visits using PRIMARY (id = r.visit_id)  (cost=0.256 rows=1)
                                            -> Filter: ((r.venue_id = 1) and (r.organization_id = 1))  (cost=0.7 rows=1)
                                                -> Single-row index lookup on r using PRIMARY (id = vb.id)  (cost=0.7 rows=1)
                                        -> Filter: (bs.organization_id = 1)  (cost=0.7 rows=1)
                                            -> Single-row index lookup on bs using PRIMARY (id = r.source_id)  (cost=0.7 rows=1)

[TU-38 AC07] EXPLAIN byScope
-> Table scan on <temporary>
    -> Aggregate using temporary table
        -> Index lookup on t using <auto_key0> (counted = 1)  (cost=69.2..72.4 rows=10)
            -> Materialize CTE turns  (cost=68.9..68.9 rows=299)
                -> Window aggregate: count((case when (raw_turns.counted = 1) then 1 end)) OVER (PARTITION BY raw_turns.business_date,raw_turns.scope,raw_turns.table_id,raw_turns.group_id ORDER BY raw_turns.seated_at,raw_turns.visit_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)   (cost=0 rows=299)
                    -> Sort: raw_turns.business_date, raw_turns.scope, raw_turns.table_id, raw_turns.group_id, raw_turns.seated_at, raw_turns.visit_id  (cost=469..469 rows=299)
                        -> Table scan on raw_turns  (cost=281..287 rows=299)
                            -> Materialize union CTE raw_turns  (cost=281..281 rows=299)
                                -> Nested loop inner join  (cost=207 rows=299)
                                    -> Filter: (visits.business_date between '2030-09-01' and '2030-09-30')  (cost=103 rows=299)
                                        -> Index lookup on visits using ix_visits_org_venue (organization_id = 1, venue_id = 1)  (cost=103 rows=2690)
                                    -> Filter: (t.organization_id = 1)  (cost=0.25 rows=1)
                                        -> Single-row index lookup on t using uq_turn_visit (venue_id = 1, visit_id = visits.id)  (cost=0.25 rows=1)
                                -> Nested loop left join  (cost=4.45 rows=0.00299)
                                    -> Nested loop left join  (cost=4.4 rows=0.00299)
                                        -> Nested loop left join  (cost=4.34 rows=0.00299)
                                            -> Nested loop left join  (cost=4.28 rows=0.0538)
                                                -> Nested loop inner join  (cost=4.25 rows=0.0538)
                                                    -> Table scan on a  (cost=3.65..3.65 rows=0.969)
                                                        -> Materialize CTE open_allocations  (cost=1.15..1.15 rows=0.969)
                                                            -> Group aggregate: max(g.id), max(g.origin), count(distinct a.group_id), min(a.table_id), max(g.`name`), max(g.symbol_no), json_arrayagg(d.`code`), json_arrayagg(a.table_id)  (cost=0.931 rows=0.969)
                                                                -> Nested loop antijoin  (cost=0.708 rows=0.969)
                                                                    -> Nested loop inner join  (cost=0.597 rows=0.969)
                                                                        -> Nested loop left join  (cost=0.483 rows=1)
                                                                            -> Nested loop inner join  (cost=0.369 rows=1)
                                                                                -> Sort: visit_id  (cost=0.256 rows=1)
                                                                                    -> Filter: ((visits.organization_id = 1) and (visits.business_date between '2030-09-01' and '2030-09-30'))  (cost=0.256 rows=1)
                                                                                        -> Index lookup on visits using ix_visits_venue_open (venue_id = 1, ended_at = NULL), with index condition: (visits.ended_at is null)  (cost=0.256 rows=1)
                                                                                -> Filter: ((a.kind = 'USAGE') and (a.visit_id = visits.id) and (a.organization_id = 1) and (a.released_at is null))  (cost=2.05 rows=1)
                                                                                    -> Index lookup on a using uq_alloc_one_active_usage (venue_id = 1)  (cost=2.05 rows=1)
                                                                            -> Filter: ((g.venue_id = 1) and (g.organization_id = 1))  (cost=2.05 rows=1)
                                                                                -> Single-row index lookup on g using PRIMARY (id = a.group_id)  (cost=2.05 rows=1)
                                                                        -> Filter: ((d.venue_id = 1) and (d.organization_id = 1))  (cost=1.99 rows=0.969)
                                                                            -> Single-row index lookup on d using PRIMARY (id = a.table_id)  (cost=1.99 rows=1)
                                                                    -> Nested loop inner join  (cost=2.22 rows=1)
                                                                        -> Filter: ((visits.venue_id = 1) and (visits.organization_id = 1) and (visits.business_date between '2030-09-01' and '2030-09-30'))  (cost=2.11 rows=1)
                                                                            -> Single-row index lookup on visits using PRIMARY (id = visits.id)  (cost=2.11 rows=1)
                                                                        -> Filter: (t.organization_id = 1)  (cost=2.11 rows=1)
                                                                            -> Single-row index lookup on t using uq_turn_visit (venue_id = 1, visit_id = visits.id)  (cost=2.11 rows=1)
                                                    -> Filter: ((visits.venue_id = 1) and (visits.organization_id = 1) and (visits.business_date between '2030-09-01' and '2030-09-30'))  (cost=0.253 rows=0.0556)
                                                        -> Single-row index lookup on visits using PRIMARY (id = a.visit_id)  (cost=0.253 rows=1)
                                                -> Filter: (c.organization_id = 1)  (cost=1.15 rows=1)
                                                    -> Single-row index lookup on c using PRIMARY (id = visits.customer_id)  (cost=1.15 rows=1)
                                            -> Covering index lookup on vb using <auto_key0> (visit_id = a.visit_id)  (cost=1.88..3.03 rows=2)
                                                -> Materialize CTE visit_bookings  (cost=0.726..0.726 rows=0.0556)
                                                    -> Group aggregate: min(r.id)  (cost=0.713 rows=0.0556)
                                                        -> Nested loop inner join  (cost=0.7 rows=0.0556)
                                                            -> Filter: (r.organization_id = 1)  (cost=0.35 rows=1)
                                                                -> Index lookup on r using ix_reservations_visit (venue_id = 1), with index condition: (r.visit_id is not null)  (cost=0.35 rows=1)
                                                            -> Filter: ((visits.venue_id = 1) and (visits.organization_id = 1) and (visits.business_date between '2030-09-01' and '2030-09-30'))  (cost=0.256 rows=0.0556)
                                                                -> Single-row index lookup on visits using PRIMARY (id = r.visit_id)  (cost=0.256 rows=1)
                                        -> Filter: ((r.venue_id = 1) and (r.organization_id = 1))  (cost=0.7 rows=1)
                                            -> Single-row index lookup on r using PRIMARY (id = vb.id)  (cost=0.7 rows=1)
                                    -> Filter: (bs.organization_id = 1)  (cost=0.7 rows=1)
                                        -> Single-row index lookup on bs using PRIMARY (id = r.source_id)  (cost=0.7 rows=1)

[TU-38 AC07] EXPLAIN target_visits, forced
-> Aggregate: count(0)  (cost=776 rows=1)
    -> Filter: ((visits.venue_id = 1) and (visits.organization_id = 1) and (visits.business_date between '2030-09-01' and '2030-09-30'))  (cost=362 rows=1800)
        -> Covering index range scan on visits using ix_visits_org_venue_date over (organization_id = 1 AND venue_id = 1 AND '2030-09-01' <= business_date <= '2030-09-30')  (cost=362 rows=1800)

[TU-38 AC07] EXPLAIN target_visits, optimizer's choice
-> Aggregate: count(0)  (cost=171 rows=1)
    -> Filter: (visits.business_date between '2030-09-01' and '2030-09-30')  (cost=103 rows=299)
        -> Index lookup on visits using ix_visits_org_venue (organization_id = 1, venue_id = 1)  (cost=103 rows=2690)
```

### Về lựa chọn index

Migration `0031_turn_statistics_visit_range_index.sql` thêm
`ix_visits_org_venue_date (organization_id, venue_id, business_date)` — đúng vị từ mà
`target_visits` mở đầu. Hai kế hoạch cuối trong khối trên là bằng chứng trực tiếp:

- khi dùng index mới: `Covering index range scan on visits using ix_visits_org_venue_date ...
  rows=1800` — quét đúng bằng số ngày được hỏi;
- khi để optimizer tự chọn ở quy mô mẫu này: `Index lookup on visits using
  ix_visits_org_venue ... rows=2690` — nó vẫn thích index 2 cột hẹp hơn, vì quét một nửa bảng
  nhỏ còn rẻ hơn quét một index rộng.

Nói thẳng: ở 5 380 visits, MySQL **chưa** chọn index mới. Nó có ý nghĩa ở quy mô mà báo cáo
này phải sống cùng: `ix_visits_org_venue` lớn dần theo toàn bộ lịch sử của quán, còn index mới
luôn chỉ bằng khoảng ngày được hỏi. Vì vậy test benchmark in cả hai kế hoạch thay vì khẳng
định optimizer chọn cái nào — một assertion như thế sẽ vỡ khi dữ liệu lớn lên, đúng lúc nó
đáng đúng nhất.
