import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { assertAuditDatabase, requireAuditRun } from "./ui-audit-launch.mjs"

const guest = "Nguyễn Hoàng Gia Minh Anh Phương Thanh Hải, đại diện nhóm khách"
const note = "Khách muốn chỗ ngồi yên tĩnh, ưu tiên ghế tựa và giữ lối đi bên cạnh thông thoáng. "
const orderNote = "Ít đá, để riêng sốt và báo lại nhân viên khi món sẵn sàng. "
const displayNames = ["Bia", "Cocktail", "Đồ ăn", "Shisha"]
const menuItems = [
  ["Bia Sài Gòn Special", "Bia thủ công Pale Ale", "Bia lúa mì vị cam"],
  ["Gin Tonic vỏ bưởi", "Old Fashioned", "Mojito chanh dây"],
  ["Khoai tây chiên truffle", "Gà nướng sả ớt", "Mực chiên giòn", "Sườn nướng mật ong"],
  ["Shisha bạc hà", "Shisha táo xanh", "Shisha dưa hấu"],
]

async function openDatabase(database) {
  assertAuditDatabase(database)
  const require = createRequire(new URL("../../api/package.json", import.meta.url))
  const { name, ...connection } = database
  return require("mysql2/promise").createConnection({
    ...connection,
    database: name,
    charset: "utf8mb4",
  })
}

async function catalog(database) {
  const db = await openDatabase(database)
  try {
    const [[row]] = await db.query("SELECT DATABASE() AS name")
    assert.equal(row.name, database.name)
    await db.beginTransaction()
    const [[owner]] = await db.execute("SELECT id FROM users WHERE username = ?", [process.env.E2E_OWNER_USERNAME])
    assert(owner, "Seed the audit OWNER before loading the catalog")
    const [[existing]] = await db.query("SELECT id FROM menu_categories WHERE venue_id=1 AND code='NA40_0'")
    if (!existing) {
      for (const [index, name] of displayNames.entries()) {
        const [category] = await db.execute(
          "INSERT INTO menu_categories (venue_id,code,name,display_order) VALUES (1,?,?,?)",
          ["NA40_" + index, name, index + 1],
        )
        for (const [i, itemName] of menuItems[index].entries()) {
          const code = "NA40_" + index + "_" + i
          const normalized = itemName.normalize("NFD").replace(/\p{M}/gu, "").replaceAll("đ", "d").toLowerCase()
          const [item] = await db.execute(
            `INSERT INTO menu_items
            (venue_id, category_id, code, name, normalized_name, preparation_station, source_status, verified_digest, verified_at, verified_by_user_id)
            VALUES (1, ?, ?, ?, ?, ?, 'VERIFIED', SHA2(?,256), NOW(3), ?)`,
            [category.insertId, code, itemName, normalized, index === 2 ? "KITCHEN" : "BAR", code, owner.id],
          )
          const units = [
            [index === 0 ? "CAN" : index === 1 ? "GLASS" : "PORTION", ["Lon", "Ly", "Phần", "Suất"][index]],
          ]
          if (index === 0) units.push(["BOTTLE", "Chai"])
          for (const [unit, unitName] of units) {
            const [variant] = await db.execute(
              `INSERT INTO menu_item_variants (venue_id, menu_item_id, code, unit_code, display_name)
              VALUES (1, ?, ?, ?, ?)`,
              [item.insertId, unit, unit, unitName],
            )
            await db.execute(
              `INSERT INTO menu_variant_prices (venue_id, variant_id, amount_vnd, effective_from, is_active, source)
              VALUES (1, ?, ?, '2020-01-01', 1, 'NA40')`,
              [variant.insertId, 65000 + index * 30000 + i * 11000],
            )
          }
        }
      }
    }
    // The owner seed lays out A1–A4. Add bar seats to the throwaway catalog using the demo geometry.
    await db.execute(`INSERT IGNORE INTO zones (id,organization_id,venue_id,code,name,is_bookable,sort_order)
      VALUES (9002,1,1,'BAR','Quầy Bar',1,3)`)
    const [[bar]] = await db.query("SELECT id FROM zones WHERE venue_id=1 AND code='BAR'")
    for (let i = 1; i <= 4; i++) {
      await db.execute(
        `INSERT IGNORE INTO dining_tables
        (id,organization_id,venue_id,zone_id,code,display_name,kind,capacity,seq_no,pos_x,pos_y,width,height)
        VALUES (?,1,1,?,?,?,'BAR_SEAT',1,?,156,?,20,20)`,
        [9200 + i, bar.id, "BAR0" + i, "Ghế Bar " + i, i, 686 - i * 24],
      )
    }
    await db.commit()
  } catch (error) {
    await db.rollback()
    throw error
  } finally {
    await db.end()
  }
}

export async function seedBusy({ browser, sessions, credentials, block }) {
  const { api, base, database } = requireAuditRun()
  await catalog(database)
  const contexts = {}
  try {
    for (const [role, session] of Object.entries(sessions)) {
      contexts[role] = await browser.newContext({ storageState: session.storage })
    }
    const req = async (role, endpoint, data) => {
      const key = randomUUID()
      const method = data === undefined ? "GET" : "POST"
      const res = await contexts[role].request.fetch(new URL("/api/v1" + endpoint, api).href, {
        method,
        maxRedirects: 0,
        headers: { origin: base.origin, "x-csrf-token": sessions[role].csrf, "idempotency-key": key },
        ...(data !== undefined && { data: { ...data, idempotencyKey: key } }),
      })
      const result = await res.json()
      assert(
        res.ok(),
        method +
          " " +
          endpoint +
          " HTTP " +
          res.status() +
          " " +
          (result.error?.code ?? "") +
          " " +
          (result.error?.message ?? ""),
      )
      return result
    }
    const trySeed = async (role, route, state, fn) => {
      try {
        return await fn()
      } catch (error) {
        block(role, route, state, error.message)
      }
    }
    const now = new Date(process.env.E2E_FIXED_NOW ?? Date.now())
    const local = new Date(now.getTime() + 7 * 3600000)
    const businessDate = new Date(local.getTime() - (local.getUTCHours() < 5 ? 86400000 : 0)).toISOString().slice(0, 10)
    const expectedAt = (i) => {
      const slot = new Date(businessDate + "T00:00:00Z")
      slot.setUTCHours(19, 15 * ((i % 23) + 1))
      return slot.toISOString().slice(0, 19) + "+07:00"
    }
    const prefix = randomUUID().slice(0, 5)
    let customerId
    let bookingCount = 0
    let waitCount = 0
    let accountsCount = 0
    let prepCounts = 0
    let pending = 0
    let rejected = 0
    for (let i = 0; i < 32; i++) {
      const booking = await trySeed("receptionist", "/floor", "booking-" + i, () =>
        req("receptionist", "/bookings", {
          guestName: guest + " (" + (i + 1) + ")",
          partySize: 2 + (i % 8),
          expectedAt: expectedAt(i),
          businessDate,
          sourceCode: "HOTLINE",
          note: note.repeat(4),
          classification: i % 2 ? "RETURNING" : "NEW",
        }),
      )
      if (!booking) break
      bookingCount++
      customerId ??= booking.booking.customerId
    }
    for (let i = 0; i < 18; i++) {
      const entry = await trySeed("receptionist", "/floor", "waitlist-" + i, () =>
        req("receptionist", "/waitlist", {
          guestName: guest + " - nhóm chờ " + (i + 1),
          partySize: 2 + (i % 6),
          businessDate,
          contactChannel: "IN_PERSON",
          note: note.repeat(3),
        }),
      )
      if (!entry) break
      waitCount++
    }
    const directory = await trySeed("admin", "/admin/accounts", "assignable-roles", () => req("owner", "/accounts"))
    const roles = (directory?.roles ?? []).map((role) => role.code ?? role.roleCode).filter((role) => role !== "ADMIN")
    for (let i = 0; roles.length && i < 22 - directory.accounts.length; i++) {
      const account = await trySeed("admin", "/admin/accounts", "create-account-" + i, () =>
        req("owner", "/accounts", {
          username: "na40_" + prefix + "_" + i,
          displayName: "Nhân viên kiểm kê giao diện ca tối " + (i + 1),
          roleCode: roles[i % roles.length],
          password: credentials("owner").password,
        }),
      )
      if (!account) break
      accountsCount++
    }
    await trySeed("receptionist", "/floor", "merged-table-group", () =>
      req("receptionist", "/tables/groups", { tableIds: [9101, 9102] }),
    )
    const visits = []
    for (const [index, tableIds] of [[9101, 9102], [9103], [9104], [9201], [9202], [9203]].entries()) {
      const visit = await trySeed("receptionist", "/floor", "walk-in-" + index, () =>
        req("receptionist", "/bookings/walk-ins", {
          tableIds,
          partySize: index < 3 ? 2 : 1,
          businessDate,
          guestName: guest + " - lượt " + (index + 1),
          phoneNumber: "09000000" + String(index + 1).padStart(2, "0"),
        }),
      )
      if (visit?.visitId) visits.push(visit.visitId)
    }
    const visitId = visits[0]
    const orders = []
    if (visitId) {
      const menu = await trySeed("waiter", "/phucvu", "menu-catalog", () =>
        req("waiter", "/waiter/menu?visitId=" + visitId),
      )
      const items = menu?.items ?? []
      if (!items.length)
        block("waiter", "/phucvu", "orders-with-10-lines", "GET /waiter/menu returned zero items for the open visit.")
      else {
        for (const [index, id] of visits.entries()) {
          const order = await trySeed("waiter", "/phucvu", "order-" + index, () =>
            req("waiter", "/waiter/orders", {
              visitId: id,
              lines: Array.from({ length: 12 }, (_, i) => {
                const variant = items[i % items.length].variants[0]
                return {
                  variantId: variant.variantId,
                  priceId: variant.priceId,
                  priceVersion: variant.priceVersion,
                  quantity: 2,
                  note: orderNote.repeat(2) + " Dòng " + (i + 1),
                }
              }),
            }),
          )
          if (order) orders.push(order.order)
        }
      }
      for (const [role, station] of [
        ["bar", "BAR"],
        ["kitchen", "KITCHEN"],
      ]) {
        const queue = await trySeed(role, "/chebien", "queue-data", () =>
          req(role, "/preparation/" + station + "/tickets"),
        )
        const tickets = queue?.tickets ?? []
        if (tickets.length < 4)
          block(
            role,
            "/chebien",
            "all-queue-columns",
            "API returned " + tickets.length + " active tickets, need at least four.",
          )
        for (const [index, ticket] of tickets.slice(1, 4).entries()) {
          let version = ticket.version
          for (const toStatus of ["ACCEPTED", "PREPARING", "READY"].slice(0, index + 1)) {
            const result = await trySeed(role, "/chebien", "ticket-" + ticket.ticketId + "-" + toStatus, () =>
              req(role, "/preparation/" + station + "/tickets/" + ticket.ticketId + "/transition", {
                toStatus,
                expectedVersion: version,
              }),
            )
            if (!result) break
            version = result.ticket?.version ?? version + 1
            prepCounts++
          }
        }
      }
      for (const [index, order] of orders.slice(0, 3).entries()) {
        const line = index === 2 ? order.lines.find((item) => item.preparationStation === "KITCHEN") : order.lines[0]
        if (!line) continue
        const path = "/waiter/orders/" + order.orderId + "/lines/" + line.lineNo + "/cancellations"
        const cancellation = await trySeed("waiter", "/phucvu/orders/" + visitId, "partial-cancel-" + index, () =>
          req("waiter", path, {
            reason: "Khách đổi ý sau khi gọi món",
            quantity: 1,
            expectedLineVersion: line.version ?? 1,
            acknowledgeWaste: true,
          }),
        )
        if (!cancellation) continue
        pending++
        if (index === 1) {
          const details = cancellation.cancellation
          const id = details.cancellationId
          const decision = await trySeed("admin", "/duyet-huy-mon", "reject-cancellation", () =>
            req("owner", "/orders/cancellations/" + id + "/reject", {
              expectedVersion: details.version ?? 1,
              note: "Món đã chuẩn bị theo yêu cầu của khách.",
            }),
          )
          if (decision) {
            pending--
            rejected++
          }
        }
      }
      const notices = await trySeed("waiter", "/phucvu", "finished-items-data", () =>
        req("waiter", "/waiter/notifications"),
      )
      if (!notices?.notifications?.length)
        block(
          "waiter",
          "/phucvu",
          "finished-item-notification",
          "GET /waiter/notifications returned zero notifications.",
        )
    } else {
      block("waiter", "/phucvu", "open-visit-dependent-states", "No walk-in visit was accepted by the API.")
    }
    const audit = await trySeed("admin", "/admin/audit", "audit-50-rows", () =>
      req("owner", "/operations/audit?from=" + businessDate + "&to=" + businessDate + "&limit=100"),
    )
    const auditCount = audit?.entries?.length
    if (auditCount !== undefined && auditCount < 50)
      block(
        "admin",
        "/admin/audit",
        "audit-50-rows",
        "Audit API returned " + auditCount + " entries for " + businessDate + ".",
      )
    const db = await openDatabase(database)
    try {
      const [[customer]] = await db.execute(
        "SELECT id FROM customers WHERE organization_id=1 AND display_name LIKE ? ORDER BY id LIMIT 1",
        [guest + "%"],
      )
      customerId ??= customer?.id
    } finally {
      await db.end()
    }
    if (!customerId)
      block("admin", "/admin/customers", "customer-detail", "No named fixture customer ID was created by the API.")
    const fixture = {
      businessDate,
      bookingCount,
      waitCount,
      accountsCount: (directory?.accounts?.length ?? 0) + accountsCount,
      auditCount,
      visits: visits.length,
      orders: orders.length,
      prepCounts,
      pending,
      rejected,
      visitId,
      customerId,
    }
    console.log("Fixture " + JSON.stringify(fixture))
    return fixture
  } finally {
    await Promise.all(Object.values(contexts).map((context) => context.close()))
  }
}

export async function interactions({
  browser,
  sessions,
  dynamic,
  interactionSizes,
  openPage,
  visitScreen,
  capture,
  attempt,
  hasShot,
  block,
}) {
  const button = (page, name) => page.getByRole("button", { name }).first()
  const click = (name) => (page) => button(page, name).click()
  const visitRoute = "/phucvu/phien/" + dynamic.visitId + "/goi-mon"
  const form = async (page) => {
    await click(/^Ghế Bar 4\b/i)(page)
    await click(/^Đặt bàn$/)(page)
    await page.getByRole("dialog", { name: "Đặt bàn trên sơ đồ" }).waitFor()
    await page.locator("[data-mobile-table-sheet]").waitFor({ state: "hidden" })
    await page.getByRole("radio", { name: "1 khách", exact: true }).click()
  }
  const item = (page) => page.getByRole("button", { name: "Chọn đơn vị cho Bia Sài Gòn Special", exact: true }).click()
  const states = [
    ["receptionist", "/floor", "table-sheet", click(/^Bàn A1[ ,]|^Bàn A1$/)],
    ["receptionist", "/floor", "booking-create", form, true],
    [
      "receptionist",
      "/floor",
      "booking-edit",
      async (page) => {
        await click("Chuyển sang tìm theo tên")(page)
        await page.getByLabel("Tìm theo tên khách", { exact: true }).fill(guest + " (1)")
        await page
          .getByRole("button")
          .filter({ hasText: guest + " (1)" })
          .first()
          .click()
        await page
          .getByRole("dialog", { name: "Chi tiết booking" })
          .getByRole("button", { name: "Sửa booking", exact: true })
          .click()
        await page.getByRole("dialog", { name: "Sửa booking", exact: true }).waitFor()
      },
      true,
    ],
    ["receptionist", "/floor", "waitlist-panel", click(/^Bàn chờ/)],
    ["receptionist", "/floor", "notification-red-dot", (page) => page.getByTestId("reception-menu-unread").waitFor()],
    [
      "receptionist",
      "/floor",
      "notifications-list",
      async (page) => {
        await click(/^Menu\b/)(page)
        await page
          .locator("summary")
          .filter({ hasText: /^Thông báo/ })
          .click()
      },
    ],
    [
      "receptionist",
      "/floor",
      "zoom-pan",
      async (page) => {
        const svg = page.getByRole("group", { name: "Sơ đồ bàn, trạng thái hiện tại" })
        const map = await svg.boundingBox()
        assert(map, "Không tìm thấy vùng sơ đồ có bàn để pan.")
        const group = svg.locator(":scope > g[transform]").first()
        const before = await group.getAttribute("transform")
        await page.mouse.move(map.x + map.width / 2, map.y + map.height / 2)
        await page.keyboard.down("Control")
        try {
          await page.mouse.wheel(0, -350)
        } finally {
          await page.keyboard.up("Control")
        }
        await page.mouse.down()
        await page.mouse.move(map.x + map.width / 2 + 45, map.y + map.height / 2 + 40, { steps: 8 })
        await page.mouse.up()
        assert.notEqual(
          await group.getAttribute("transform"),
          before,
          "FloorCanvas planLocked prevents zoom and pan in the full plan at this viewport.",
        )
      },
    ],
    ["waiter", "/phucvu", "finished-items-notifications", click(/Thông báo/i)],
    [
      "waiter",
      "/duyet-huy-mon",
      "access-denied",
      (page) =>
        page
          .getByRole("heading", { name: "Không có quyền phê duyệt hủy món" })
          .waitFor()
          .then(() =>
            block(
              "waiter",
              "/duyet-huy-mon",
              "approval-access",
              "Không có quyền phê duyệt hủy món. OWNER covers this screen.",
            ),
          ),
    ],
    [
      "bar",
      "/chebien",
      "pending-cancellation",
      (page) => page.locator('[data-pending-cancellation="true"]').first().scrollIntoViewIfNeeded(),
    ],
    [
      "kitchen",
      "/chebien",
      "pending-cancellation",
      (page) => page.locator('[data-pending-cancellation="true"]').first().scrollIntoViewIfNeeded(),
    ],
    [
      "admin",
      "/admin/overview",
      "sidebar-expanded",
      async (page) => {
        await page.getByTestId("admin-sidebar").waitFor()
      },
    ],
    [
      "admin",
      "/admin/overview",
      "sidebar-collapsed",
      async (page) => {
        const toggle = button(page, /Thu gọn|Ẩn thanh bên/i)
        assert(
          await toggle.count(),
          "AdminShell only exposes a mobile drawer toggle; the desktop sidebar has fixed width.",
        )
        await toggle.click()
      },
    ],
    [
      "admin",
      "/admin/overview",
      "drawer-open",
      async (page) => {
        await page.getByTestId("admin-menu-trigger").click()
        await page.getByTestId("admin-drawer-panel").waitFor()
      },
    ],
    [
      "admin",
      "/admin/accounts",
      "account-create",
      async (page) => {
        await click(/Tạo tài khoản|Thêm tài khoản/i)(page)
        await page.getByLabel("Tên đăng nhập", { exact: true }).waitFor()
      },
      true,
    ],
    [
      "admin",
      "/admin/accounts",
      "account-edit",
      async (page) => {
        await click(/^Xem$/)(page)
        await page.getByTestId("admin-account-detail-dialog").waitFor()
      },
    ],
    [
      "admin",
      "/admin/accounts",
      "account-password-edit",
      async (page) => {
        const rowAction = button(page, /^Đổi mật khẩu$/)
        if (await rowAction.count()) await rowAction.click()
        else {
          await click(/^Xem$/)(page)
          await page.getByTestId("admin-detail-change-password").click()
        }
        await page.getByTestId("admin-password-input").waitFor()
      },
      true,
    ],
    [
      "admin",
      "/duyet-huy-mon",
      "rejected-cancellation",
      async (page) => {
        await page.getByRole("tab", { name: /Từ chối/i }).click()
        await page.getByRole("tab", { name: /Từ chối/i, selected: true }).waitFor()
      },
    ],
  ]
  if (dynamic.visitId) {
    states.push(
      [
        "waiter",
        visitRoute,
        "menu-category",
        async (page) => {
          await page.getByRole("tab", { name: "Cocktail", exact: true }).click()
          await page.getByRole("tab", { name: "Cocktail", exact: true, selected: true }).waitFor()
        },
      ],
      [
        "waiter",
        visitRoute,
        "menu-search",
        async (page) => {
          await page.getByLabel("Tìm món", { exact: true }).fill("Bia")
        },
        true,
      ],
      ["waiter", visitRoute, "menu-filters", click(/Lọc giá và sắp xếp/i)],
      ["waiter", visitRoute, "item-variants", item],
      [
        "waiter",
        visitRoute,
        "item-note",
        async (page) => {
          await item(page)
          await page.getByRole("radio", { name: /Chai/ }).click()
          await page.getByLabel("Ghi chú cho Bar", { exact: true }).fill(orderNote)
        },
        true,
      ],
      [
        "waiter",
        visitRoute,
        "cart",
        async (page) => {
          await item(page)
          await page.getByRole("radio", { name: /Chai/ }).click()
          await click(/Thêm vào giỏ/)(page)
          await click(/Giỏ gọi món/)(page)
        },
      ],
    )
  }
  const capabilityChecks = [
    [
      "owner",
      "/guests",
      "Chưa hỗ trợ hồ sơ khách hàng",
      "Backend v1 chưa hỗ trợ tìm kiếm và quản lý hồ sơ khách hàng.",
    ],
    ["owner", "/reports", "Chưa hỗ trợ báo cáo", "Backend v1 chưa hỗ trợ báo cáo và thống kê chi tiết."],
    ["admin", "/admin/reports", "Báo cáo kinh doanh — đang xây dựng", "Màn đợt 2 thiếu dữ liệu tiền và hóa đơn."],
    [
      "admin",
      "/admin/reconciliation",
      "Đối soát cuối ngày — đang xây dựng",
      "Màn đợt 2 thiếu dữ liệu tiền và hóa đơn.",
    ],
    [
      "admin",
      "/admin/customers",
      "Chưa kết nối dữ liệu khách hàng",
      "Máy chủ chưa có API tìm khách và xem hồ sơ khách.",
    ],
  ]
  if (dynamic.customerId) {
    capabilityChecks.push([
      "admin",
      "/admin/customers/" + dynamic.customerId,
      "Chưa kết nối dữ liệu khách hàng",
      "Máy chủ chưa có API xem hồ sơ khách.",
    ])
  }
  {
    const { page, context } = await openPage(browser, sessions.owner.storage, interactionSizes[0])
    try {
      for (const [role, route, title, reason] of capabilityChecks) {
        await attempt(role, route, "populated-view", async () => {
          await visitScreen(page, role, route)
          if (await page.getByText(title, { exact: true }).first().isVisible())
            block(role, route, "populated-view", title + ". " + reason)
        })
      }
    } finally {
      await context.close()
    }
  }
  for (const [role, route, state, action, keyboard] of states) {
    const sizes = state.startsWith("sidebar-")
      ? interactionSizes.filter(([width]) => width >= 1024)
      : state === "drawer-open"
        ? interactionSizes.filter(([width]) => width < 1024)
        : interactionSizes
    for (const size of [...sizes, ...(keyboard ? [[390, 500]] : [])]) {
      if (hasShot(role, route, state + (size[1] === 500 ? "-keyboard" : ""), size)) continue
      await attempt(role, route, state + "-" + size.join("x"), async () => {
        const { page, errors, context } = await openPage(
          browser,
          sessions[role === "admin" ? "owner" : role].storage,
          size,
        )
        try {
          await visitScreen(page, role, route)
          await action(page)
          if (size[1] === 500) {
            const dialogInput = page.getByRole("dialog").locator("input:visible,textarea:visible").first()
            const field = (await dialogInput.count())
              ? dialogInput
              : page.locator("input:visible,textarea:visible").first()
            await field.focus()
          }
          // Let dialog and focus-triggered motion finish before measuring the layout.
          await page.waitForTimeout(400)
          if (state === "booking-create") {
            await page.getByRole("button", { name: /Đang kiểm tra bàn/ }).waitFor({ state: "hidden" })
          }
          await capture(page, errors, role, route, state + (size[1] === 500 ? "-keyboard" : ""))
        } finally {
          await context.close()
        }
      })
    }
  }
  for (const role of ["bar", "kitchen"]) {
    for (const size of interactionSizes) {
      if (hasShot(role, "/chebien", "drag-after", size)) continue
      await attempt(role, "/chebien", "drag-" + size.join("x"), async () => {
        const { page, errors, context } = await openPage(browser, sessions[role].storage, size)
        try {
          await visitScreen(page, role, "/chebien")
          const submitted = page.locator('[data-queue-status="SUBMITTED"]')
          const card = submitted.locator("[data-ticket-id]").first()
          const handle = card.getByRole("button", { name: /^Kéo phiếu/ })
          const id = await card.getAttribute("data-ticket-id")
          const accepted = page.locator('[data-queue-status="ACCEPTED"]')
          await capture(page, errors, role, "/chebien", "drag-before")
          await handle.scrollIntoViewIfNeeded()
          const origin = await handle.boundingBox()
          assert(origin, "Drag handle is unavailable")
          await page.mouse.move(origin.x + origin.width / 2, origin.y + origin.height / 2)
          await page.mouse.down()
          try {
            await page.mouse.move(origin.x + origin.width / 2 + 8, origin.y + origin.height / 2 + 8, { steps: 3 })
            const heading = accepted.getByRole("heading").first()
            await heading.evaluate((el) => el.scrollIntoView({ block: "center" }))
            const to = await heading.boundingBox()
            await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
          } finally {
            await page.mouse.up()
          }
          await accepted.locator('[data-ticket-id="' + id + '"]').waitFor()
          await capture(page, errors, role, "/chebien", "drag-after")
        } finally {
          await context.close()
        }
      })
    }
  }
}
