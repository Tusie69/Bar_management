import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'

type TableState = 'AVAILABLE' | 'RESERVED' | 'IN_USE'

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

interface TablesResponse { businessDate: string; tables: TableView[] }

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1'
const stateLabels: Record<TableState, string> = { AVAILABLE: 'Chưa đặt', RESERVED: 'Đang đặt', IN_USE: 'Đang sử dụng' }

function todayInVietnam(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function formatBusinessDate(date: string): string {
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${date}T12:00:00+07:00`))
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`} aria-label="21GAM">
      <svg className="brand-mark" viewBox="0 0 100 100" role="img" aria-hidden="true">
        <circle cx="50" cy="50" r="42" />
        <path d="M25 28h50M31 28v50M69 28v50M39 28l4 50M61 28l-4 50M31 78h38M43 78c0-14 14-14 14 0" />
        <text x="50" y="56" textAnchor="middle">21</text>
      </svg>
      {!compact && <><strong>21GAM</strong><span>QUẢN LÝ VẬN HÀNH</span></>}
    </div>
  )
}

function App() {
  const [businessDate, setBusinessDate] = useState(todayInVietnam)
  const [tables, setTables] = useState<TableView[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadTables = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/tables?date=${businessDate}`)
      if (!response.ok) throw new Error('Không tải được sơ đồ bàn.')
      const data = (await response.json()) as TablesResponse
      setTables(data.tables)
    } catch {
      setTables([])
      setError('Không kết nối được API hoặc MySQL. Hãy khởi động database và chạy migration.')
    } finally { setLoading(false) }
  }, [businessDate])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- state changes happen after the asynchronous fetch settles.
    void loadTables()
  }, [loadTables])

  const selectedTable = tables.find((table) => table.id === selectedId) ?? null
  const counts = useMemo(() => ({
    available: tables.filter((table) => table.state === 'AVAILABLE' && !table.isBackup).length,
    reserved: tables.filter((table) => table.state === 'RESERVED').length,
    inUse: tables.filter((table) => table.state === 'IN_USE').length,
    backup: tables.filter((table) => table.isBackup).length,
  }), [tables])

  async function updateSelected(update: { state?: TableState; isBackup?: boolean }): Promise<void> {
    if (!selectedTable) return
    setSaving(true); setError(null)
    try {
      const response = await fetch(`${apiUrl}/tables/${selectedTable.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessDate, expectedVersion: selectedTable.version, ...update }) })
      const data = await response.json() as { table?: TableView; error?: { message: string } }
      if (!response.ok || !data.table) throw new Error(data.error?.message ?? 'Không thể cập nhật bàn.')
      setTables((current) => current.map((table) => table.id === data.table?.id ? data.table : table))
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Không thể cập nhật bàn.')
      await loadTables()
    } finally { setSaving(false) }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <BrandMark />
        <div className="side-divider" />
        <p className="side-label">TÍNH NĂNG</p>
        <button className="side-nav side-nav--active" type="button"><i />Lễ tân · Đặt bàn</button>
        <div className="side-placeholder">Khu vực chọn tính năng<br />(bổ sung sau)</div>
      </aside>

      <section className="main-shell">
        <header className="topbar">
          <div className="page-title"><h1>Sơ đồ bàn</h1><span>LỄ TÂN · ĐẶT BÀN</span></div>
          <label className="date-control"><span>NGÀY LÀM VIỆC (17:00 → 05:00)</span><input type="date" value={businessDate} onChange={(event) => { setLoading(true); setError(null); setSelectedId(null); setBusinessDate(event.target.value) }} /></label>
          <div className="auto-control"><span>TRẠNG THÁI TỰ ĐỘNG</span><div className="segmented"><button type="button" disabled>Chờ migration</button></div></div>
          <div className="history-actions"><button type="button" disabled>↶ Hoàn tác</button><button type="button" disabled>↷ Làm lại</button></div>
          <div className="primary-actions"><button type="button" disabled>Bàn chờ</button><button type="button" disabled>Tìm khách</button><button type="button" disabled>Xuất text</button><button className="add-booking" type="button" disabled>+ Đặt bàn</button></div>
        </header>
        {error && <div className="error-banner" role="alert">{error}</div>}

        <main className="workspace">
          <section className="map-panel">
            <div className="legend" aria-label="Tổng hợp trạng thái bàn">
              <span><i className="dot dot--available" />Chưa đặt <b>{counts.available}</b></span><span><i className="dot dot--reserved" />Đang đặt <b>{counts.reserved}</b></span><span><i className="dot dot--in-use" />Đang sử dụng <b>{counts.inUse}</b></span><span><i className="dot dot--backup" />Sơ cua <b>{counts.backup}</b></span>
            </div>
            <div className="map-stage" aria-label="Sơ đồ bàn 21GAM">
              <div className="fixture fixture--left" /><div className="fixture fixture--right" />
              <div className="bar-block"><BrandMark compact /><strong>QUẦY BAR</strong></div>
              {loading && <p className="empty-state">Đang tải sơ đồ bàn…</p>}{!loading && tables.length === 0 && <p className="empty-state">Chưa có dữ liệu bàn</p>}
              {tables.map((table) => <button key={table.id} type="button" className={`table-node table-node--${table.state.toLowerCase().replace('_', '-')} ${table.isBackup ? 'table-node--backup' : ''} ${selectedId === table.id ? 'table-node--selected' : ''}`} style={{ left: `${table.position.x}%`, top: `${table.position.y}%` }} onClick={() => setSelectedId(table.id)} title={`${table.area.name} · ${stateLabels[table.state]}`}>{table.code}</button>)}
              {tables.length > 0 && <><span className="area-label area-label--a">KHU A</span><span className="area-label area-label--b">KHU B</span><span className="area-label area-label--c">KHU C</span><span className="entrance">↑ LỐI VÀO</span></>}
              {selectedTable && <div className="table-popover" role="dialog" aria-label={`Thao tác ${selectedTable.displayName}`}><button className="popover-close" type="button" onClick={() => setSelectedId(null)}>×</button><p>THAO TÁC BÀN</p><h2>{selectedTable.displayName}</h2><span>{selectedTable.area.name} · {stateLabels[selectedTable.state]} · v{selectedTable.version}</span><div className="popover-actions">{(['AVAILABLE', 'RESERVED', 'IN_USE'] as const).map((state) => <button key={state} type="button" disabled={saving || selectedTable.state === state || (selectedTable.isBackup && state !== 'AVAILABLE')} onClick={() => void updateSelected({ state })}>{stateLabels[state]}</button>)}</div><button className="backup-button" type="button" disabled={saving || selectedTable.state !== 'AVAILABLE'} onClick={() => void updateSelected({ isBackup: !selectedTable.isBackup })}>{selectedTable.isBackup ? 'Tắt bàn sơ cua' : 'Bật bàn sơ cua'}</button></div>}
            </div>
          </section>

          <section className="booking-panel">
            <header className="booking-header"><div><h2>Đặt bàn</h2><strong>Ngày làm việc {formatBusinessDate(businessDate)}</strong><p>Dữ liệu sẽ được kết nối sau khi có migration và API booking chính thức.</p></div></header>
            <div className="booking-empty"><strong>Chưa có dữ liệu đặt bàn</strong><span>Đang chờ migration chính thức.</span></div>
          </section>
        </main>
      </section>
    </div>
  )
}

export default App
