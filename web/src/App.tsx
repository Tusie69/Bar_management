import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'

type TableState = 'AVAILABLE' | 'RESERVED' | 'IN_USE'
type Theme = 'dark' | 'light'

interface TableView {
  id: number
  code: string
  displayName: string
  type: 'TABLE' | 'BAR_SEAT' | 'WAITING'
  capacity: number | null
  area: { code: string; name: string; floor: number }
  position: { x: number; y: number }
  state: TableState
  isBackup: boolean
  version: number
}

interface TablesResponse {
  businessDate: string
  tables: TableView[]
}

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1'
const stateLabels: Record<TableState, string> = {
  AVAILABLE: 'Trống',
  RESERVED: 'Đã giữ',
  IN_USE: 'Đang dùng',
}

const navigation = [
  { label: 'Điều phối', mark: 'Đ', enabled: true },
  { label: 'Đặt bàn', mark: 'ĐB', enabled: false },
  { label: 'Danh sách chờ', mark: 'C', enabled: false },
  { label: 'Khách', mark: 'K', enabled: false },
  { label: 'Báo cáo', mark: 'BC', enabled: false },
  { label: 'Cài đặt', mark: '⚙', enabled: false },
] as const

function todayInVietnam(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function formatBusinessDate(date: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${date}T12:00:00+07:00`))
}

function formatClock(date: Date): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function App() {
  const [businessDate, setBusinessDate] = useState(todayInVietnam)
  const [tables, setTables] = useState<TableView[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('21gam-theme')
    return stored === 'light' ? 'light' : 'dark'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('21gam-theme', theme)
  }, [theme])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const loadTables = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${apiUrl}/tables?date=${businessDate}`)
      if (!response.ok) throw new Error('Không tải được sơ đồ bàn.')
      const data = (await response.json()) as TablesResponse
      setTables(data.tables)
    } catch {
      setTables([])
      setError('Không kết nối được API hoặc MySQL.')
    } finally {
      setLoading(false)
    }
  }, [businessDate])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- state changes happen after the asynchronous fetch settles.
    void loadTables()
  }, [loadTables])

  const selectedTable = tables.find((table) => table.id === selectedId) ?? null
  const counts = useMemo(
    () => ({
      total: tables.length,
      available: tables.filter((table) => table.state === 'AVAILABLE' && !table.isBackup).length,
      reserved: tables.filter((table) => table.state === 'RESERVED').length,
      inUse: tables.filter((table) => table.state === 'IN_USE').length,
      spare: tables.filter((table) => table.isBackup).length,
    }),
    [tables],
  )
  const areas = useMemo(
    () =>
      Array.from(new Map(tables.map((table) => [table.area.code, table.area])).values()).sort((a, b) =>
        a.code.localeCompare(b.code),
      ),
    [tables],
  )

  async function updateSelected(update: { state: TableState }): Promise<void> {
    if (!selectedTable) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`${apiUrl}/tables/${selectedTable.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessDate, expectedVersion: selectedTable.version, ...update }),
      })
      const data = (await response.json()) as { table?: TableView; error?: { message: string } }
      if (!response.ok || !data.table) throw new Error(data.error?.message ?? 'Không thể cập nhật bàn.')
      setTables((current) => current.map((table) => (table.id === data.table?.id ? data.table : table)))
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Không thể cập nhật bàn.')
      await loadTables()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`dashboard ${sidebarOpen ? 'dashboard--sidebar-open' : ''}`}>
      <aside className="sidebar" aria-label="Điều hướng chính">
        <div className="brand">
          <img src="/21gam-logo.png" alt="21GAM" />
          <span>21GAM</span>
        </div>
        <nav className="nav-list">
          {navigation.map((item) => (
            <button
              key={item.label}
              type="button"
              className={item.enabled ? 'nav-item nav-item--active' : 'nav-item'}
              disabled={!item.enabled}
              title={item.enabled ? item.label : `${item.label} · Chờ API chính thức`}
            >
              <span className="nav-mark">{item.mark}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
        <button className="sidebar-toggle" type="button" onClick={() => setSidebarOpen((value) => !value)}>
          <span>{sidebarOpen ? '‹' : '›'}</span>
          <span className="nav-label">Thu gọn</span>
        </button>
      </aside>

      <section className="app-frame">
        <header className="topbar">
          <div className="topbar-title">
            <span className="eyebrow">TÀI KHOẢN VẬN HÀNH</span>
            <strong>Điều phối mặt bằng</strong>
          </div>
          <button className="booking-watch" type="button" disabled>Theo dõi đơn đặt bàn</button>
          <div className="topbar-actions">
            <span className={`connection-pill ${error ? 'connection-pill--offline' : ''}`}>
              <i />{loading ? 'Đang kết nối' : error ? 'Mất kết nối' : 'Đã kết nối API'}
            </span>
            <time>{formatClock(now)}</time>
            <button
              className="icon-button"
              type="button"
              aria-label={theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
              onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
            <button className="identity" type="button" disabled><span>LT</span><b>Lễ tân</b></button>
          </div>
        </header>

        <main className="page">
          <section className="page-toolbar">
            <div>
              <span className="eyebrow">VẬN HÀNH TRỰC TIẾP</span>
              <h1>Sơ đồ & điều phối bàn</h1>
            </div>
            <div className="view-tabs" role="tablist" aria-label="Kiểu hiển thị">
              <button type="button" disabled>Danh sách</button>
              <button type="button" disabled>Thời gian</button>
              <button type="button" className="active" role="tab" aria-selected="true">Sơ đồ</button>
            </div>
            <label className="date-control">
              <span>Ngày làm việc</span>
              <input
                type="date"
                value={businessDate}
                onChange={(event) => {
                  setSelectedId(null)
                  setBusinessDate(event.target.value)
                }}
              />
              <small>{formatBusinessDate(businessDate)}</small>
            </label>
            <button className="secondary-action" type="button" disabled>+ Walk-in</button>
            <button className="primary-action" type="button" disabled>+ Tạo đặt bàn</button>
          </section>

          {error ? <div className="error-banner" role="alert">{error} Hãy khởi động Docker/API rồi thử lại.</div> : null}

          <section className="operations-grid">
            <aside className="booking-column">
              <div className="panel-heading">
                <div><span className="eyebrow">TRONG CA</span><h2>Đặt bàn</h2></div>
                <span className="count-badge">—</span>
              </div>
              <div className="filter-tabs"><button className="active" type="button">Cần xử lý</button><button type="button" disabled>Sắp đến</button><button type="button" disabled>Tất cả</button></div>
              <div className="empty-panel">
                <strong>Chưa kết nối dữ liệu đặt bàn</strong>
                <span>Đang chờ migration và API chính thức.</span>
              </div>
            </aside>

            <section className="floor-column">
              <div className="floor-summary">
                <div className="zone-tabs"><button className="active" type="button">Tất cả</button>{areas.map((area) => <button type="button" disabled key={area.code}>{area.name}</button>)}</div>
                <span>{counts.total} vị trí · {counts.inUse} đang dùng · {counts.available} trống</span>
              </div>
              <div className="legend" aria-label="Chú thích trạng thái bàn">
                <span><i className="dot dot--available" />Trống <b>{counts.available}</b></span>
                <span><i className="dot dot--reserved" />Đã giữ <b>{counts.reserved}</b></span>
                <span><i className="dot dot--in-use" />Đang dùng <b>{counts.inUse}</b></span>
                <span><i className="dot dot--spare" />Sơ cua <b>{counts.spare}</b></span>
              </div>
              <div className="floor-canvas" aria-label="Sơ đồ bàn 21GAM">
                <div className="fixture fixture--left" /><div className="fixture fixture--right" />
                <div className="bar-counter"><img src="/21gam-logo.png" alt="" /><span>QUẦY BAR</span></div>
                {loading ? <p className="canvas-empty">Đang tải sơ đồ…</p> : null}
                {!loading && !tables.length ? <p className="canvas-empty">Chưa có dữ liệu bàn từ API</p> : null}
                {tables.map((table) => (
                  <button
                    key={table.id}
                    type="button"
                    className={`table-node table-node--${table.state.toLowerCase().replace('_', '-')} ${table.isBackup ? 'table-node--spare' : ''} ${selectedId === table.id ? 'table-node--selected' : ''}`}
                    style={{ left: `${table.position.x}%`, top: `${table.position.y}%` }}
                    title={`${table.area.name} · ${stateLabels[table.state]}`}
                    onClick={() => setSelectedId((current) => (current === table.id ? null : table.id))}
                  >
                    {table.code}
                  </button>
                ))}
              </div>
            </section>

            <aside className="shift-column">
              {selectedTable ? (
                <div className="table-detail">
                  <div className="panel-heading"><div><span className="eyebrow">CHI TIẾT BÀN</span><h2>{selectedTable.displayName}</h2></div><button className="close-button" type="button" onClick={() => setSelectedId(null)}>×</button></div>
                  <dl><div><dt>Khu vực</dt><dd>{selectedTable.area.name}</dd></div><div><dt>Trạng thái</dt><dd>{stateLabels[selectedTable.state]}</dd></div><div><dt>Sức chứa</dt><dd>{selectedTable.capacity ?? 'Chưa cập nhật'}</dd></div><div><dt>Phiên bản</dt><dd>{selectedTable.version}</dd></div></dl>
                  <div className="detail-actions">
                    {(['AVAILABLE', 'RESERVED', 'IN_USE'] as const).map((state) => (
                      <button key={state} type="button" disabled={saving || selectedTable.state === state} onClick={() => void updateSelected({ state })}>{stateLabels[state]}</button>
                    ))}
                  </div>
                  <button className="spare-action" type="button" disabled>Bàn sơ cua được cấu hình cố định trong database</button>
                </div>
              ) : (
                <>
                  <div className="panel-heading"><div><span className="eyebrow">CA HIỆN TẠI</span><h2>Tổng quan</h2></div></div>
                  <div className="metric-grid"><article><span>Vị trí</span><strong>{counts.total || '—'}</strong></article><article><span>Đang dùng</span><strong>{counts.inUse}</strong></article><article><span>Đã giữ</span><strong>{counts.reserved}</strong></article><article><span>Sơ cua</span><strong>{counts.spare}</strong></article></div>
                  <div className="shift-note"><strong>Dữ liệu ca đang được hoàn thiện</strong><span>Booking, khách chờ và cảnh báo sẽ xuất hiện khi API tương ứng sẵn sàng.</span></div>
                </>
              )}
            </aside>
          </section>
        </main>
      </section>
    </div>
  )
}

export default App
