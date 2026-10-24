import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import './App.css'

type TableState = 'AVAILABLE' | 'RESERVED' | 'IN_USE'
type Theme = 'dark' | 'light'
type BookingStatus = 'BOOKED' | 'CHECKED_IN' | 'CANCELLED' | 'NO_SHOW'
type FormMode = 'booking' | 'walk-in' | null

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

interface BookingView {
  id: number
  guestName: string
  phoneLast3: string | null
  partySize: number
  expectedAt: string
  businessDate: string
  status: BookingStatus
  source: string
  tableCodes: string[]
  note: string | null
  version: number
}

interface BookingsResponse {
  businessDate: string
  bookings: BookingView[]
}

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1'
const stateLabels: Record<TableState, string> = {
  AVAILABLE: 'Trống',
  RESERVED: 'Đã giữ',
  IN_USE: 'Đang dùng',
}
const bookingStatusLabels: Record<BookingStatus, string> = {
  BOOKED: 'Đang đặt',
  CHECKED_IN: 'Đã tới',
  CANCELLED: 'Đã hủy',
  NO_SHOW: 'Không đến',
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

function formatBookingTime(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function App() {
  const [businessDate, setBusinessDate] = useState(todayInVietnam)
  const [tables, setTables] = useState<TableView[]>([])
  const [bookings, setBookings] = useState<BookingView[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(null)
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [guestName, setGuestName] = useState('')
  const [partySize, setPartySize] = useState('4')
  const [arrivalTime, setArrivalTime] = useState('21:00')
  const [sourceCode, setSourceCode] = useState('HOTLINE')
  const [note, setNote] = useState('')
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

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [tableResponse, bookingResponse] = await Promise.all([
        fetch(`${apiUrl}/tables?date=${businessDate}`),
        fetch(`${apiUrl}/bookings?date=${businessDate}`),
      ])
      if (!tableResponse.ok || !bookingResponse.ok) throw new Error('Không tải được dữ liệu vận hành.')
      const tableData = (await tableResponse.json()) as TablesResponse
      const bookingData = (await bookingResponse.json()) as BookingsResponse
      setTables(tableData.tables)
      setBookings(bookingData.bookings)
    } catch {
      setTables([])
      setBookings([])
      setError('Không kết nối được API hoặc MySQL.')
    } finally {
      setLoading(false)
    }
  }, [businessDate])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- state changes happen after the asynchronous fetch settles.
    void loadData()
  }, [loadData])

  const selectedTable = tables.find((table) => table.id === selectedId) ?? null
  const selectedBooking = bookings.find((booking) => booking.id === selectedBookingId) ?? null
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

  async function requestBooking(path: string, body: Record<string, unknown>): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`${apiUrl}/bookings${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await response.json()) as { error?: { message: string } }
      if (!response.ok) throw new Error(data.error?.message ?? 'Không thể cập nhật booking.')
      await loadData()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Không thể cập nhật booking.')
      await loadData()
    } finally {
      setSaving(false)
    }
  }

  async function submitForm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const endpoint = formMode === 'walk-in' ? '/bookings/walk-ins' : '/bookings'
      const payload = formMode === 'walk-in'
        ? { guestName, partySize: Number(partySize), businessDate, tableIds: selectedTable ? [selectedTable.id] : [] }
        : {
            guestName,
            partySize: Number(partySize),
            businessDate,
            expectedAt: `${businessDate}T${arrivalTime}:00+07:00`,
            sourceCode,
            note,
          }
      const response = await fetch(`${apiUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await response.json()) as { error?: { message: string } }
      if (!response.ok) throw new Error(data.error?.message ?? 'Không thể lưu dữ liệu.')
      setFormMode(null)
      setGuestName('')
      setNote('')
      await loadData()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Không thể lưu dữ liệu.')
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
            <button className="secondary-action" type="button" disabled={!selectedTable || selectedTable.state !== 'AVAILABLE'} onClick={() => setFormMode('walk-in')}>+ Walk-in</button>
            <button className="primary-action" type="button" onClick={() => setFormMode('booking')}>+ Tạo đặt bàn</button>
          </section>

          {error ? <div className="error-banner" role="alert">{error} Hãy khởi động Docker/API rồi thử lại.</div> : null}

          <section className="operations-grid">
            <aside className="booking-column">
              <div className="panel-heading">
                <div><span className="eyebrow">TRONG CA</span><h2>Đặt bàn</h2></div>
                <span className="count-badge">{bookings.length}</span>
              </div>
              <div className="filter-tabs"><button className="active" type="button">Trong ngày</button><button type="button" disabled>Sắp đến</button><button type="button" disabled>Tìm kiếm</button></div>
              <div className="booking-list">
                {!bookings.length ? <div className="empty-panel"><strong>Chưa có đặt bàn</strong><span>Nhấn “Tạo đặt bàn” để thêm booking.</span></div> : null}
                {bookings.map((booking) => (
                  <button
                    className={`booking-card booking-card--${booking.status.toLowerCase()} ${selectedBookingId === booking.id ? 'booking-card--selected' : ''}`}
                    key={booking.id}
                    type="button"
                    onClick={() => setSelectedBookingId((current) => current === booking.id ? null : booking.id)}
                  >
                    <time>{formatBookingTime(booking.expectedAt)}</time>
                    <span><strong>{booking.guestName}</strong><small>{booking.partySize} khách · {booking.source}</small></span>
                    <b>{booking.tableCodes.length ? booking.tableCodes.join(' + ').replaceAll('BAR0', '') : 'Chưa gán'}</b>
                    <em>{bookingStatusLabels[booking.status]}</em>
                  </button>
                ))}
              </div>
              {selectedBooking ? (
                <div className="booking-actions">
                  <strong>{selectedBooking.guestName}</strong>
                  {selectedBooking.status === 'BOOKED' ? <>
                    <button type="button" disabled={saving || !selectedBooking.tableCodes.length} onClick={() => void requestBooking(`/${selectedBooking.id}/check-in`, { version: selectedBooking.version })}>Khách đã tới</button>
                    <button type="button" disabled={saving} onClick={() => void requestBooking(`/${selectedBooking.id}/no-show`, { version: selectedBooking.version })}>Không đến</button>
                    <button type="button" disabled={saving} onClick={() => void requestBooking(`/${selectedBooking.id}/cancel`, { version: selectedBooking.version })}>Hủy booking</button>
                  </> : <span>{bookingStatusLabels[selectedBooking.status]}</span>}
                </div>
              ) : null}
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
                    <button type="button" disabled={saving || selectedTable.state !== 'AVAILABLE' || selectedBooking?.status !== 'BOOKED'} onClick={() => selectedBooking && void requestBooking(`/${selectedBooking.id}/assign`, { version: selectedBooking.version, tableIds: [selectedTable.id] })}>Gán cho booking đang chọn</button>
                    <span>Trạng thái bàn được cập nhật tự động qua booking và lượt khách.</span>
                  </div>
                  <button className="spare-action" type="button" disabled>Bàn sơ cua được cấu hình cố định trong database</button>
                </div>
              ) : (
                <>
                  <div className="panel-heading"><div><span className="eyebrow">CA HIỆN TẠI</span><h2>Tổng quan</h2></div></div>
                  <div className="metric-grid"><article><span>Vị trí</span><strong>{counts.total || '—'}</strong></article><article><span>Đang dùng</span><strong>{counts.inUse}</strong></article><article><span>Đã giữ</span><strong>{counts.reserved}</strong></article><article><span>Sơ cua</span><strong>{counts.spare}</strong></article></div>
                  <div className="shift-note"><strong>Booking đã kết nối dữ liệu thật</strong><span>Danh sách chờ, cảnh báo tự động và báo cáo sẽ được nối ở giai đoạn tiếp theo.</span></div>
                </>
              )}
            </aside>
          </section>
        </main>
      </section>
      {formMode ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setFormMode(null)
        }}>
          <form className="booking-form" onSubmit={(event) => void submitForm(event)}>
            <div className="form-heading">
              <div><span className="eyebrow">{formMode === 'booking' ? 'BOOKING' : 'WALK-IN'}</span><h2>{formMode === 'booking' ? 'Tạo đặt bàn' : `Mở bàn ${selectedTable?.code ?? ''}`}</h2></div>
              <button type="button" onClick={() => setFormMode(null)}>×</button>
            </div>
            <label>Tên khách {formMode === 'walk-in' ? '(không bắt buộc)' : ''}<input value={guestName} required={formMode === 'booking'} onChange={(event) => setGuestName(event.target.value)} /></label>
            <label>Số khách<input type="number" min="1" max="500" value={partySize} required onChange={(event) => setPartySize(event.target.value)} /></label>
            {formMode === 'booking' ? <>
              <label>Giờ đến<input type="time" value={arrivalTime} required onChange={(event) => setArrivalTime(event.target.value)} /></label>
              <label>Nguồn<select value={sourceCode} onChange={(event) => setSourceCode(event.target.value)}><option value="HOTLINE">Hotline</option><option value="FANPAGE">Fanpage</option><option value="ZALO">Zalo</option><option value="SHAREHOLDER">Cổ đông</option><option value="STAFF">Nhân viên</option><option value="OTHER">Khác</option></select></label>
              <label className="form-wide">Ghi chú<textarea value={note} rows={3} onChange={(event) => setNote(event.target.value)} /></label>
            </> : <p className="form-wide form-note">Walk-in sẽ mở trực tiếp bàn đang chọn và tạo lượt khách đang sử dụng.</p>}
            <div className="form-actions"><button type="button" onClick={() => setFormMode(null)}>Đóng</button><button className="primary-action" type="submit" disabled={saving}>{saving ? 'Đang lưu…' : 'Xác nhận'}</button></div>
          </form>
        </div>
      ) : null}
    </div>
  )
}

export default App
