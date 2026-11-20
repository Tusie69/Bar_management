import { readFile, readdir } from 'node:fs/promises'

import { expect, it } from 'vitest'

it('migration files have unique numeric prefixes', async () => {
  const filenames = (await readdir(new URL('../database/migrations/', import.meta.url)))
    .filter((filename) => filename.endsWith('.sql'))
  const prefixes = filenames.map((filename) => filename.split('_')[0])
  expect(new Set(prefixes).size).toBe(filenames.length)
})

it('menu migration declares venue-scoped catalog constraints and a current-price guard', async () => {
  const sql = await readFile(new URL('../database/migrations/0033_menu_catalog.sql', import.meta.url), 'utf8')
  for (const table of ['menu_categories', 'menu_items', 'menu_item_variants', 'menu_variant_prices']) {
    expect(sql).toContain(`CREATE TABLE ${table}`)
  }
  expect(sql).toContain('uq_menu_items_venue_code')
  expect(sql).toContain('uq_menu_variants_item_code')
  expect(sql).toContain('ck_menu_prices_window')
  expect(sql).toContain('open_active_slot')
  expect(sql).toContain('uq_menu_prices_one_open_active')
})

it('sales order migration snapshots price in the line and routes tickets per station', async () => {
  const sql = await readFile(new URL('../database/migrations/0036_sales_orders.sql', import.meta.url), 'utf8')
  for (const table of ['sales_orders', 'sales_order_lines', 'preparation_tickets']) {
    expect(sql).toContain(`CREATE TABLE ${table}`)
  }
  // Bản sao giá nằm TRONG dòng đơn: thiếu một trong các cột này thì hoá đơn
  // phải đọc lại danh mục, và một lần đổi giá sẽ viết lại đơn đã gửi.
  for (const column of ['item_name', 'variant_display_name', 'unit_code', 'unit_price_vnd',
    'price_id', 'price_version', 'preparation_station']) {
    expect(sql).toContain(column)
  }
  // Tổng dòng là cột sinh, không phải một con số do application tự ghi.
  expect(sql).toContain('line_total_vnd         BIGINT UNSIGNED AS (unit_price_vnd * quantity) STORED')
  // Một đơn chỉ có một phiếu cho mỗi quầy. Dòng đơn dùng line_no làm định danh;
  // cùng biến thể vẫn có thể lặp khi ghi chú/customization khác nhau.
  expect(sql).toContain('uq_preparation_tickets_order_station')
  expect(sql).not.toContain('UNIQUE KEY uq_sales_order_lines_variant')
  // Số thứ tự đơn trong Phiên là duy nhất: hai lần bấm đồng thời không cùng số.
  expect(sql).toContain('uq_sales_orders_visit_sequence')
  // Đơn gắn với Phiên, không với bàn: một cụm bốn bàn ghép là MỘT Phiên, và
  // một đơn mang `table_id` sẽ trỏ về bàn mà đoàn khách không còn ngồi sau khi
  // đổi bàn giữa tối.
  expect(sql).toContain('fk_sales_orders_visit')
  // Trần tiền. Tiền đi qua JSON dưới dạng `number`, nên tổng lớn nhất một đơn
  // hợp lệ đạt được (50 dòng × 99 món × trần đơn giá) phải còn nằm trong khoảng
  // nguyên chính xác của JavaScript; vượt nó là một con số bị làm tròn âm thầm.
  expect(sql).toContain('unit_price_vnd BETWEEN 1 AND 1000000000')
  expect(sql).toContain('ck_sales_orders_total CHECK (total_amount_vnd <= 4950000000000)')
  expect(50 * 99 * 1_000_000_000).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER)
  for (const table of ['sales_orders', 'sales_order_lines', 'preparation_tickets']) {
    const start = sql.indexOf(`CREATE TABLE ${table} (`)
    const body = sql.slice(start, sql.indexOf(') ENGINE=InnoDB', start))
    expect(body, `${table} không được mang table_id`).not.toMatch(/\btable_id\b/)
  }
})

it('forward-only migrations never ship a destructive down step', async () => {
  const sql = await readFile(new URL('../database/migrations/0036_sales_orders.sql', import.meta.url), 'utf8')
  const down = sql.slice(sql.indexOf('-- migrate:down'))
  expect(down).toContain('irreversible')
  expect(down).not.toMatch(/DROP\s+TABLE/i)
})

it('preparation queue migration adds strict workflow, history, station permissions and print outbox', async () => {
  const sql = await readFile(new URL('../database/migrations/0037_preparation_queue.sql', import.meta.url), 'utf8')
  for (const status of ['SUBMITTED', 'ACCEPTED', 'PREPARING', 'READY']) expect(sql).toContain(status)
  for (const column of ['accepted_by_user_id', 'accepted_at', 'started_by_user_id', 'started_at',
    'ready_by_user_id', 'ready_at']) expect(sql).toContain(column)
  for (const table of ['preparation_ticket_events', 'preparation_print_outbox', 'preparation_ready_notifications']) {
    expect(sql).toContain(`CREATE TABLE ${table}`)
  }
  expect(sql).toContain('uq_preparation_print_outbox_ticket')
  expect(sql).toContain("'preparation.bar.transition'")
  expect(sql).toContain("'preparation.kitchen.transition'")
})

it('preparation queue backfill is forward-only and fills old tickets without duplicates', async () => {
  const sql = await readFile(new URL('../database/migrations/0038_preparation_queue_backfill.sql', import.meta.url), 'utf8')
  expect(sql).toContain('INSERT INTO preparation_ticket_events')
  expect(sql).toContain('INSERT INTO preparation_print_outbox')
  expect(sql).toContain('WHERE e.id IS NULL')
  expect(sql).toContain('WHERE o.id IS NULL')
  expect(sql.slice(sql.indexOf('-- migrate:down'))).not.toMatch(/DELETE|DROP/i)
})

it('preparation hardening is isolated in forward migration 0039', async () => {
  const sql = await readFile(new URL('../database/migrations/0039_preparation_queue_hardening.sql', import.meta.url), 'utf8')
  expect(sql).toContain("'COLLECTED'")
  for (const table of ['preparation_print_capabilities', 'preparation_print_retry_events',
    'preparation_ready_events', 'preparation_ready_audiences', 'preparation_ready_acknowledgements']) {
    expect(sql).toContain(`CREATE TABLE ${table}`)
  }
  expect(sql).toContain('INSERT IGNORE INTO preparation_ready_events')
  expect(sql.slice(sql.indexOf('-- migrate:down'))).not.toMatch(/DELETE|DROP/i)
})

it('order adjustment migration keeps lines, separates cancelled money and gates approval by permission', async () => {
  const sql = await readFile(
    new URL('../database/migrations/0040_order_adjustment_and_cancellation.sql', import.meta.url),
    'utf8',
  )
  for (const table of ['sales_order_line_changes', 'sales_order_cancellations']) {
    expect(sql).toContain(`CREATE TABLE ${table}`)
  }
  // Hủy món KHÔNG xoá dòng: nó cộng vào `cancelled_quantity` và để lại lịch sử.
  expect(sql).toContain('cancelled_quantity')
  expect(sql).not.toMatch(/DELETE\s+FROM\s+sales_order_lines/i)
  // Tổng lúc gửi đơn giữ nguyên; phần bị hủy nằm riêng.
  expect(sql).toContain('cancelled_amount_vnd')
  // Một dòng chỉ có một yêu cầu đang chờ.
  expect(sql).toContain('uq_sales_order_cancellations_open')
  // Đã quyết định thì phải có người quyết định và thời điểm.
  expect(sql).toContain('ck_sales_order_cancellations_decision')
  // Phục vụ gửi yêu cầu nhưng KHÔNG duyệt. Bỏ dòng comment trước khi soi: phần
  // giải thích có nhắc tên quyền, và một assert đọc cả comment sẽ báo động giả.
  const statements = sql
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
  const waiterGrant = statements.slice(
    statements.lastIndexOf('INSERT INTO role_permissions', statements.indexOf("WHERE r.code = 'WAITER'")),
    statements.indexOf("WHERE r.code = 'WAITER'"),
  )
  expect(waiterGrant).toContain('order.cancel.request')
  expect(waiterGrant).toContain('order.line.adjust')
  expect(waiterGrant).not.toContain('order.cancel.approve')
  expect(waiterGrant).not.toContain('order.cancel.ready')
})
