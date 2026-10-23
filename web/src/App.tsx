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

interface TablesResponse {
  businessDate: string
  tables: TableView[]
}

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1'
const stateLabels: Record<TableState, string> = {
  AVAILABLE: 'Chưa đặt',
  RESERVED: 'Đang đặt',
  IN_USE: 'Đang sử dụng',
}

function todayInVietnam(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
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
    } finally {
      setLoading(false)
    }
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
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`${apiUrl}/tables/${selectedTable.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessDate,
          expectedVersion: selectedTable.version,
          ...update,
        }),
      })
      const data = await response.json() as { table?: TableView; error?: { message: string } }
      if (!response.ok || !data.table) throw new Error(data.error?.message ?? 'Không thể cập nhật bàn.')
      setTables((current) => current.map((table) => table.id === data.table?.id ? data.table : table))
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Không thể cập nhật bàn.')
      await loadTables()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">21GAM · QUẢN LÝ VẬN HÀNH</p>
          <h1>Sơ đồ bàn</h1>
        </div>
        <label className="date-control">
          <span>Ngày làm việc 17:00 → 05:00</span>
          <input
            type="date"
            value={businessDate}
            onChange={(event) => {
              setLoading(true)
              setError(null)
              setBusinessDate(event.target.value)
            }}
          />
        </label>
      </header>

      <div className="legend" aria-label="Tổng hợp trạng thái bàn">
        <span><i className="dot dot--available" />Chưa đặt <b>{counts.available}</b></span>
        <span><i className="dot dot--reserved" />Đang đặt <b>{counts.reserved}</b></span>
        <span><i className="dot dot--in-use" />Đang sử dụng <b>{counts.inUse}</b></span>
        <span><i className="dot dot--backup" />Sơ cua <b>{counts.backup}</b></span>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <main className="workspace">
        <section className="floor-card" aria-label="Sơ đồ bàn 21GAM">
          {loading && <p className="empty-state">Đang tải sơ đồ bàn…</p>}
          {!loading && tables.length === 0 && (
            <div className="empty-state">
              <strong>Chưa có dữ liệu bàn</strong>
              <span>Chạy MySQL và lệnh migration để nạp sơ đồ thật.</span>
            </div>
          )}
          {tables.map((table) => (
            <button
              key={table.id}
              type="button"
              className={`table-node table-node--${table.state.toLowerCase().replace('_', '-')} ${table.isBackup ? 'table-node--backup' : ''} ${selectedId === table.id ? 'table-node--selected' : ''}`}
              style={{ left: `${table.position.x}%`, top: `${table.position.y}%` }}
              onClick={() => setSelectedId(table.id)}
              title={`${table.area.name} · ${stateLabels[table.state]}`}
            >
              {table.code}
            </button>
          ))}
          {tables.length > 0 && (
            <>
              <span className="area-label area-label--a">KHU A</span>
              <span className="area-label area-label--b">KHU B</span>
              <span className="area-label area-label--c">KHU C</span>
              <span className="area-label area-label--bar">QUẦY BAR</span>
              <span className="entrance">↑ LỐI VÀO</span>
            </>
          )}
        </section>

        <aside className="inspector">
          <p className="eyebrow">THAO TÁC BÀN</p>
          {!selectedTable && <p className="muted">Chọn một bàn trên sơ đồ để xem và cập nhật trạng thái.</p>}
          {selectedTable && (
            <>
              <div className="table-heading">
                <h2>{selectedTable.displayName}</h2>
                <span>{selectedTable.area.name} · Tầng {selectedTable.area.floor}</span>
              </div>
              <dl>
                <div><dt>Trạng thái</dt><dd>{stateLabels[selectedTable.state]}</dd></div>
                <div><dt>Sức chứa</dt><dd>{selectedTable.capacity ?? 'Chưa chốt'}</dd></div>
                <div><dt>Phiên bản</dt><dd>{selectedTable.version}</dd></div>
              </dl>
              <div className="action-grid">
                {(['AVAILABLE', 'RESERVED', 'IN_USE'] as const).map((state) => (
                  <button
                    key={state}
                    type="button"
                    disabled={saving || selectedTable.state === state || (selectedTable.isBackup && state !== 'AVAILABLE')}
                    onClick={() => void updateSelected({ state })}
                  >
                    {stateLabels[state]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="backup-button"
                disabled={saving || selectedTable.state !== 'AVAILABLE'}
                onClick={() => void updateSelected({ isBackup: !selectedTable.isBackup })}
              >
                {selectedTable.isBackup ? 'Tắt bàn sơ cua' : 'Bật bàn sơ cua'}
              </button>
            </>
          )}
        </aside>
      </main>
    </div>
  )
}

export default App

