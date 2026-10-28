import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import './App.css'
import { FloorCanvasV2 } from './FloorCanvasV2'

type TableState = 'AVAILABLE' | 'RESERVED' | 'IN_USE'
type Theme = 'dark' | 'light'
type BookingStatus = 'BOOKED' | 'CHECKED_IN' | 'CANCELLED' | 'NO_SHOW'
type BookingDisplayStatus = 'UPCOMING' | 'WAITING' | 'LATE' | 'NO_SHOW' | 'CHECKED_IN' | 'CANCELLED'
type FormMode = 'booking' | 'edit' | 'walk-in' | 'waitlist' | null
type AssignmentMode = 'booking' | 'visit' | 'waitlist' | 'walk-in' | null
type DisplayMode = 'floor' | 'timeline'
type LeftView = 'bookings' | 'waitlist'
type PrimaryView = 'list' | 'timeline' | 'floor'

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
  activeVisit: {
    id: number
    version: number
    tableCodes: string[]
  } | null
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
  sourceCode: string
  tableCodes: string[]
  note: string | null
  version: number
  displayStatus: BookingDisplayStatus
  minutesLate: number
  autoNoShowDue: boolean
}

interface BookingsResponse {
  businessDate: string
  bookings: BookingView[]
}

interface BookingSourceView {
  code: string
  name: string
}

interface BookingSourcesResponse {
  sources: BookingSourceView[]
}

type WaitlistStatus = 'WAITING' | 'CONTACTING' | 'OFFERED' | 'HOLD_ACTIVE' | 'SEATED' | 'DECLINED' | 'CANCELLED'

interface WaitlistEntryView {
  id: number
  kind: 'ADVANCE_RESERVATION' | 'WALK_IN'
  guestName: string
  partySize: number
  businessDate: string
  queuedAt: string
  status: WaitlistStatus
  contactChannel: string
  reservationId: number | null
  visitId: number | null
  note: string | null
  version: number
}

interface WaitlistResponse {
  businessDate: string
  entries: WaitlistEntryView[]
}

interface AuthenticationView {
  user: {
    id: number
    username: string
    displayName: string
    organizationId: number
    venueId: number
  }
  permissions: string[]
  csrfToken: string
  expiresAt?: string
}

interface ApiErrorPayload {
  error?: { code?: string; message?: string }
}

class ApiRequestError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
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
const bookingDisplayStatusLabels: Record<BookingDisplayStatus, string> = {
  UPCOMING: 'Sắp tới',
  WAITING: 'Đang chờ',
  LATE: 'Đến muộn',
  CHECKED_IN: 'Đã tới',
  CANCELLED: 'Đã hủy',
  NO_SHOW: 'Không đến',
}

function bookingTimingLabel(booking: BookingView): string {
  if (booking.displayStatus === 'WAITING') {
    return booking.minutesLate === 0 ? 'Đang chờ · đúng giờ hẹn' : `Đang chờ · trễ ${booking.minutesLate} phút`
  }
  if (booking.displayStatus === 'LATE') {
    return `${bookingDisplayStatusLabels.LATE} · ${booking.minutesLate} phút${booking.autoNoShowDue ? ' · chờ server xử lý' : ''}`
  }
  return bookingDisplayStatusLabels[booking.displayStatus]
}

function bookingCardActionLabel(booking: BookingView): string {
  if (booking.status !== 'BOOKED') return ''
  return booking.tableCodes.length ? 'Check-in' : 'Xếp chỗ'
}
const waitlistStatusLabels: Record<WaitlistStatus, string> = {
  WAITING: 'Đang chờ',
  CONTACTING: 'Đang liên hệ',
  OFFERED: 'Đã mời bàn',
  HOLD_ACTIVE: 'Đang giữ bàn',
  SEATED: 'Đã vào bàn',
  DECLINED: 'Từ chối',
  CANCELLED: 'Đã hủy',
}

const navigation = [
  { label: 'Điều phối', mark: '▦', enabled: true },
  { label: 'Đặt bàn', mark: '◷', enabled: false },
  { label: 'Danh sách chờ', mark: '◌', enabled: false },
  { label: 'Khách', mark: '♙', enabled: false },
  { label: 'Báo cáo', mark: '▥', enabled: false },
  { label: 'Cài đặt', mark: '⚙', enabled: false },
] as const

const floorZoneLayouts: Record<string, { left: number; top: number; width: number; height: number; title: string }> = {
  A: { left: 3, top: 47, width: 55, height: 49, title: 'KHU A' },
  B: { left: 3, top: 20, width: 73, height: 24, title: 'KHU B' },
  C: { left: 38, top: 3, width: 48, height: 17, title: 'KHU C · khu chờ' },
  BAR: { left: 60, top: 45, width: 38, height: 52, title: 'KHU PHA CHẾ' },
}

function dateInVietnam(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value)
}

function addCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00+07:00`)
  value.setUTCDate(value.getUTCDate() + days)
  return dateInVietnam(value)
}

function todayInVietnam(): string {
  const now = new Date()
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now))
  return hour < 5 ? addCalendarDays(dateInVietnam(now), -1) : dateInVietnam(now)
}

function expectedAtForBusinessDate(date: string, time: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match) throw new Error('Giờ khách đến không hợp lệ.')
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59 || (hour >= 5 && hour < 17)) {
    throw new Error('Giờ khách đến phải nằm trong khoảng 17:00–05:00.')
  }
  const calendarDate = hour < 5 ? addCalendarDays(date, 1) : date
  return `${calendarDate}T${time}:00+07:00`
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

function normalizedTableCode(code: string): string {
  return code.replace(/^BAR0?/, '')
}

function minutesFromBusinessStart(time: string): number {
  const [hour = 17, minute = 0] = time.split(':').map(Number)
  return (hour < 5 ? hour + 24 : hour) * 60 + minute
}

function dateInputValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateFromInputValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.getFullYear() === Number(match[1])
    && date.getMonth() === Number(match[2]) - 1
    && date.getDate() === Number(match[3])
    ? date
    : null
}

interface PickerProps {
  value: string
  onChange: (value: string) => void
}

function BookingDatePicker({ value, onChange, clearable = true, showIcon = false }: PickerProps & { clearable?: boolean; showIcon?: boolean }) {
  const [open, setOpen] = useState(false)
  const selectedDate = dateFromInputValue(value)
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const initialDate = selectedDate ?? dateFromInputValue(todayInVietnam()) ?? new Date()
    return new Date(initialDate.getFullYear(), initialDate.getMonth(), 1)
  })
  const pickerRef = useRef<HTMLDivElement>(null)
  const today = todayInVietnam()
  const firstDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1)
  const calendarStart = new Date(firstDay)
  calendarStart.setDate(firstDay.getDate() - firstDay.getDay())
  const calendarDays = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(calendarStart)
    date.setDate(calendarStart.getDate() + index)
    return date
  })

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !pickerRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [open])

  const displayValue = selectedDate
    ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(selectedDate)
    : ''
  const openPicker = () => {
    const date = selectedDate ?? dateFromInputValue(today) ?? new Date()
    setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1))
    setOpen(true)
  }

  return (
    <div className="picker-control booking-date-picker" ref={pickerRef} onKeyDown={(event) => {
      if (event.key === 'Escape') setOpen(false)
    }}>
      <input
        type="text"
        value={displayValue}
        placeholder="Chọn ngày"
        readOnly
        required
        aria-label="Ngày đặt bàn"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openPicker}
        onFocus={openPicker}
      />
      {showIcon ? <svg className="date-picker-trigger-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3.5" y="5" width="17" height="16" rx="2" />
        <path d="M7.5 3v4M16.5 3v4M3.5 9.5h17" />
      </svg> : null}
      {open ? (
        <div className="date-picker-popup" role="dialog" aria-label="Chọn ngày đặt bàn">
          <div className="date-picker-heading">
            <button type="button" aria-label="Tháng trước" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}>‹</button>
            <strong>{new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric' }).format(visibleMonth)}</strong>
            <button type="button" aria-label="Tháng sau" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))}>›</button>
          </div>
          <div className="date-picker-grid date-picker-weekdays">
            {['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="date-picker-grid">
            {calendarDays.map((date) => {
              const dateValue = dateInputValue(date)
              const isCurrentMonth = date.getMonth() === visibleMonth.getMonth()
              return (
                <button
                  key={dateValue}
                  type="button"
                  className={`date-picker-day${isCurrentMonth ? '' : ' date-picker-day--outside'}${dateValue === value ? ' date-picker-day--selected' : ''}${dateValue === today ? ' date-picker-day--today' : ''}`}
                  aria-label={new Intl.DateTimeFormat('vi-VN', { dateStyle: 'full' }).format(date)}
                  aria-pressed={dateValue === value}
                  onClick={() => {
                    onChange(dateValue)
                    setOpen(false)
                  }}
                >
                  {date.getDate()}
                </button>
              )
            })}
          </div>
          <div className="date-picker-actions">
            <button type="button" onClick={() => {
              onChange(today)
              setOpen(false)
            }}>Hôm nay</button>
            {clearable ? <button type="button" onClick={() => {
              onChange('')
              setOpen(false)
            }}>Xóa</button> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function BookingTimePicker({ value, onChange }: PickerProps) {
  const [open, setOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const hourListRef = useRef<HTMLDivElement>(null)
  const minuteListRef = useRef<HTMLDivElement>(null)
  const [hourValue = '21', minuteValue = '00'] = value.split(':')
  const hour = Number(hourValue)
  const minute = Number(minuteValue)

  useEffect(() => {
    if (!open) return
    for (const list of [hourListRef.current, minuteListRef.current]) {
      list?.querySelector<HTMLElement>('.time-picker-option--selected')?.scrollIntoView({ block: 'center' })
    }
  }, [open, hour, minute])

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !pickerRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [open])

  const options = (count: number, selected: number, listRef: { current: HTMLDivElement | null }, type: 'hour' | 'minute') => (
    <div className="time-picker-column">
      <span>{type === 'hour' ? 'Giờ' : 'Phút'}</span>
      <div className="time-picker-options" ref={listRef}>
        {Array.from({ length: count }, (_, index) => (
          <button
            key={index}
            type="button"
            className={`time-picker-option${index === selected ? ' time-picker-option--selected' : ''}`}
            aria-pressed={index === selected}
            onClick={() => {
              const nextHour = type === 'hour' ? index : hour
              const nextMinute = type === 'minute' ? index : minute
              onChange(`${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`)
            }}
          >
            {String(index).padStart(2, '0')}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="picker-control booking-time-picker" ref={pickerRef} onKeyDown={(event) => {
      if (event.key === 'Escape') setOpen(false)
    }}>
      <input
        type="text"
        value={value}
        placeholder="Chọn giờ"
        readOnly
        required
        aria-label="Giờ đến"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
      />
      {open ? (
        <div className="time-picker-popup" role="dialog" aria-label="Chọn giờ đến">
          <div className="time-picker-columns">
            {options(24, hour, hourListRef, 'hour')}
            {options(60, minute, minuteListRef, 'minute')}
          </div>
          <div className="time-picker-current" aria-live="polite">{value}</div>
          <button className="time-picker-done" type="button" onClick={() => setOpen(false)}>Xong</button>
        </div>
      ) : null}
    </div>
  )
}

interface TableNodeProps {
  table: TableView
  selected: boolean
  multiSelected: boolean
  onSelect: (table: TableView) => void
  position?: { x: number; y: number }
}

function TableNode({ table, selected, multiSelected, onSelect, position = table.position }: TableNodeProps) {
  const statusClass = table.state.toLowerCase().replace('_', '-')
  const typeClass = table.type.toLowerCase().replace('_', '-')
  const codeClass = table.code.toLowerCase()
  const badge = table.isBackup ? '⋯' : table.state === 'IN_USE' ? '✓' : table.state === 'RESERVED' ? '•' : null
  const secondaryLabel = table.type === 'TABLE' && table.capacity ? `${table.capacity} chỗ` : ''
  return (
    <button
      key={table.id}
      type="button"
      aria-label={`${table.displayName} · ${stateLabels[table.state]}`}
      className={`table-node table-node--${statusClass} table-node--${typeClass} table-node--code-${codeClass} ${table.isBackup ? 'table-node--spare' : ''} ${selected ? 'table-node--selected' : ''} ${multiSelected ? 'table-node--multi-selected' : ''} group absolute z-[3]`}
      style={{ left: `${position.x}%`, top: `${position.y}%` }}
      title={`${table.area.name} · ${stateLabels[table.state]}`}
      onClick={() => onSelect(table)}
    >
      <i className="table-chair table-chair--top" aria-hidden="true" />
      <i className="table-chair table-chair--right" aria-hidden="true" />
      <i className="table-chair table-chair--bottom" aria-hidden="true" />
      <i className="table-chair table-chair--left" aria-hidden="true" />
      <span>{table.code}</span>
      {secondaryLabel ? <small>{secondaryLabel}</small> : null}
      {badge ? <b className="table-status-badge" aria-hidden="true">{badge}</b> : null}
    </button>
  )
}

function App() {
  const [authentication, setAuthentication] = useState<AuthenticationView | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [businessDate, setBusinessDate] = useState(todayInVietnam)
  const [tables, setTables] = useState<TableView[]>([])
  const [bookings, setBookings] = useState<BookingView[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<BookingView[] | null>(null)
  const [bookingDetail, setBookingDetail] = useState<BookingView | null>(null)
  const [bookingSources, setBookingSources] = useState<BookingSourceView[]>([])
  const [waitlist, setWaitlist] = useState<WaitlistEntryView[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(null)
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>(null)
  const [selectedTableIds, setSelectedTableIds] = useState<number[]>([])
  const [selectedWaitlistId, setSelectedWaitlistId] = useState<number | null>(null)
  const [leftView, setLeftView] = useState<LeftView>('bookings')
  const [displayMode, setDisplayMode] = useState<DisplayMode>('floor')
  const [primaryView, setPrimaryView] = useState<PrimaryView>('floor')
  const [timelineTime, setTimelineTime] = useState('21:00')
  const [closeVisitOpen, setCloseVisitOpen] = useState(false)
  const [closeVisitNote, setCloseVisitNote] = useState('')
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [guestName, setGuestName] = useState('')
  const [partySize, setPartySize] = useState('4')
  const [arrivalTime, setArrivalTime] = useState('21:00')
  const [formBusinessDate, setFormBusinessDate] = useState(todayInVietnam)
  const [sourceCode, setSourceCode] = useState('HOTLINE')
  const [contactChannel, setContactChannel] = useState('IN_PERSON')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [tableConfigurationId, setTableConfigurationId] = useState<number | null>(null)
  const [tableConfigurationReason, setTableConfigurationReason] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('21gam-theme')
    return stored === 'light' ? 'light' : 'dark'
  })
  const loadRequestId = useRef(0)
  const mutationInFlight = useRef(false)
  const searchRequestId = useRef(0)
  const detailRequestId = useRef(0)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('21gam-theme', theme)
  }, [theme])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 5_000)
    return () => window.clearInterval(timer)
  }, [])

  const apiFetch = useCallback(async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    const method = (init.method ?? 'GET').toUpperCase()
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && authentication?.csrfToken) {
      headers.set('X-CSRF-Token', authentication.csrfToken)
    }
    const response = await fetch(`${apiUrl}${path}`, { ...init, headers, credentials: 'include' })
    if (response.status === 401 && path !== '/auth/login') {
      setAuthentication(null)
      setTables([])
      setBookings([])
      setSearchResults(null)
      setBookingDetail(null)
      setBookingSources([])
      setWaitlist([])
    }
    return response
  }, [authentication])

  useEffect(() => {
    let active = true
    async function restoreSession() {
      try {
        const response = await fetch(`${apiUrl}/auth/me`, { credentials: 'include' })
        if (!response.ok) return
        const payload = await response.json() as AuthenticationView
        if (active) setAuthentication(payload)
      } finally {
        if (active) setAuthLoading(false)
      }
    }
    void restoreSession()
    return () => { active = false }
  }, [])

  const loadData = useCallback(async () => {
    if (!authentication) return
    const requestId = ++loadRequestId.current
    setLoading(true)
    setError(null)
    try {
      const [tableResponse, bookingResponse, sourceResponse, waitlistResponse] = await Promise.all([
        apiFetch(`/tables?date=${businessDate}`),
        apiFetch(`/bookings?date=${businessDate}`),
        apiFetch('/bookings/sources'),
        apiFetch(`/waitlist?date=${businessDate}`),
      ])
      if (!tableResponse.ok || !bookingResponse.ok || !sourceResponse.ok || !waitlistResponse.ok) {
        throw new Error('Không tải được dữ liệu vận hành.')
      }
      const tableData = (await tableResponse.json()) as TablesResponse
      const bookingData = (await bookingResponse.json()) as BookingsResponse
      const sourceData = (await sourceResponse.json()) as BookingSourcesResponse
      const waitlistData = (await waitlistResponse.json()) as WaitlistResponse
      if (requestId !== loadRequestId.current) return
      setTables(tableData.tables)
      setBookings(bookingData.bookings)
      setBookingSources(sourceData.sources)
      setWaitlist(waitlistData.entries)
    } catch {
      if (requestId !== loadRequestId.current) return
      setTables([])
      setBookings([])
      setBookingSources([])
      setWaitlist([])
      setError('Không kết nối được API hoặc MySQL.')
    } finally {
      if (requestId === loadRequestId.current) setLoading(false)
    }
  }, [apiFetch, authentication, businessDate])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- state changes happen after the asynchronous fetch settles.
    if (authentication) void loadData()
  }, [authentication, loadData])

  useEffect(() => {
    if (!authentication) return
    const timer = window.setInterval(() => void loadData(), 5_000)
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadData()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [authentication, loadData])

  const displayedBookings = searchResults ?? bookings
  const selectedTable = tables.find((table) => table.id === selectedId) ?? null
  // Prefer the latest list response over the detail snapshot. Polling and the
  // no-show worker can advance the version while the detail panel stays open.
  const selectedBooking = bookings.find((booking) => booking.id === selectedBookingId)
    ?? displayedBookings.find((booking) => booking.id === selectedBookingId)
    ?? (bookingDetail?.id === selectedBookingId ? bookingDetail : null)
  const selectedWaitlist = waitlist.find((entry) => entry.id === selectedWaitlistId) ?? null
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
  const seatedGuestCount = useMemo(
    () => bookings.filter((booking) => booking.status === 'CHECKED_IN').reduce((total, booking) => total + booking.partySize, 0),
    [bookings],
  )
  const areas = useMemo(
    () =>
      Array.from(new Map(tables.map((table) => [table.area.code, table.area])).values()).sort((a, b) => {
        const order = ['A', 'B', 'C', 'BAR']
        return (order.indexOf(a.code) < 0 ? order.length : order.indexOf(a.code)) - (order.indexOf(b.code) < 0 ? order.length : order.indexOf(b.code))
      }),
    [tables],
  )

  const can = useCallback((permission: string) => authentication?.permissions.includes(permission) ?? false, [authentication])

  async function submitSearch(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const query = searchQuery.trim()
    if (!query || !can('customer.view_masked')) return
    const requestId = ++searchRequestId.current
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const response = await apiFetch(`/bookings/search?date=${encodeURIComponent(businessDate)}&q=${encodeURIComponent(query)}`)
      const data = await response.json() as BookingsResponse & ApiErrorPayload
      if (!response.ok) throw new Error(data.error?.message ?? 'Không thể tìm booking.')
      if (requestId !== searchRequestId.current) return
      setSearchResults(data.bookings)
      setSelectedBookingId(null)
      setBookingDetail(null)
      setNotice(`Tìm thấy ${data.bookings.length} booking.`)
    } catch (caughtError) {
      if (requestId === searchRequestId.current) {
        setError(caughtError instanceof Error ? caughtError.message : 'Không thể tìm booking.')
      }
    } finally {
      if (requestId === searchRequestId.current) setSaving(false)
    }
  }

  function clearSearch(): void {
    searchRequestId.current += 1
    setSearchQuery('')
    setSearchResults(null)
    setSelectedBookingId(null)
    setBookingDetail(null)
    setNotice(null)
  }

  async function selectBooking(id: number): Promise<void> {
    if (selectedBookingId === id) {
      setSelectedBookingId(null)
      setBookingDetail(null)
      return
    }
    const requestId = ++detailRequestId.current
    setSelectedBookingId(id)
    setBookingDetail(null)
    setError(null)
    try {
      const response = await apiFetch(`/bookings/${id}`)
      const data = await response.json() as { booking?: BookingView } & ApiErrorPayload
      if (!response.ok || !data.booking) throw new Error(data.error?.message ?? 'Không tải được chi tiết booking.')
      if (requestId === detailRequestId.current) setBookingDetail(data.booking)
    } catch (caughtError) {
      if (requestId === detailRequestId.current) {
        setError(caughtError instanceof Error ? caughtError.message : 'Không tải được chi tiết booking.')
      }
    }
  }

  async function bookingExportText(): Promise<string> {
    const response = await apiFetch(`/bookings/export?date=${encodeURIComponent(businessDate)}`)
    const text = await response.text()
    if (!response.ok) {
      let message = 'Không thể xuất danh sách booking.'
      try { message = (JSON.parse(text) as ApiErrorPayload).error?.message ?? message } catch { /* plain error */ }
      throw new Error(message)
    }
    return text
  }

  async function copyBookingExport(): Promise<void> {
    if (exporting || !can('customer.view_masked')) return
    setExporting(true)
    setError(null)
    setNotice(null)
    try {
      await navigator.clipboard.writeText(await bookingExportText())
      setNotice('Đã copy TXT booking, không gồm số điện thoại.')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Không thể copy danh sách booking.')
    } finally {
      setExporting(false)
    }
  }

  async function downloadBookingExport(): Promise<void> {
    if (exporting || !can('customer.view_masked')) return
    setExporting(true)
    setError(null)
    setNotice(null)
    try {
      const text = await bookingExportText()
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `21gam-bookings-${businessDate}.txt`
      anchor.click()
      URL.revokeObjectURL(url)
      setNotice('Đã tạo file TXT booking, không gồm số điện thoại.')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Không thể tải danh sách booking.')
    } finally {
      setExporting(false)
    }
  }

  function resetBookingForm(): void {
    setGuestName('')
    setPartySize('4')
    setArrivalTime('21:00')
    setFormBusinessDate(businessDate)
    setSourceCode(bookingSources.find((source) => source.code === 'HOTLINE')?.code ?? bookingSources[0]?.code ?? '')
    setNote('')
    setContactChannel('IN_PERSON')
    setError(null)
  }

  function openCreateBooking(): void {
    resetBookingForm()
    setFormMode('booking')
  }

  function beginWalkInSelection(): void {
    if (!can('visit.walkin')) return
    setSelectedTableIds(selectedTable?.state === 'AVAILABLE' && !selectedTable.isBackup ? [selectedTable.id] : [])
    setAssignmentMode('walk-in')
    setDisplayMode('floor')
    setPrimaryView('floor')
    setError(null)
  }

  function openWalkIn(): void {
    resetBookingForm()
    setFormMode('walk-in')
  }

  function openWaitlist(): void {
    resetBookingForm()
    setFormMode('waitlist')
  }

  function openEditBooking(): void {
    if (!selectedBooking || selectedBooking.status !== 'BOOKED' || !can('reservation.update')) return
    setGuestName(selectedBooking.guestName)
    setPartySize(String(selectedBooking.partySize))
    setArrivalTime(formatBookingTime(selectedBooking.expectedAt))
    setFormBusinessDate(selectedBooking.businessDate)
    setSourceCode(selectedBooking.sourceCode)
    setNote(selectedBooking.note ?? '')
    setError(null)
    setFormMode('edit')
  }

  function beginBookingAssignment(): void {
    if (!selectedBooking || selectedBooking.status !== 'BOOKED' || !can('table.assign')) return
    const currentIds = tables
      .filter((table) => selectedBooking.tableCodes.some((code) => normalizedTableCode(code) === table.code))
      .map((table) => table.id)
    setSelectedTableIds(currentIds)
    setAssignmentMode('booking')
    setDisplayMode('floor')
    setPrimaryView('floor')
    setError(null)
  }

  function beginVisitMove(): void {
    if (!selectedTable?.activeVisit || !can('visit.move')) return
    const visitId = selectedTable.activeVisit.id
    setSelectedTableIds(tables.filter((table) => table.activeVisit?.id === visitId).map((table) => table.id))
    setAssignmentMode('visit')
    setDisplayMode('floor')
    setPrimaryView('floor')
    setError(null)
  }

  function beginWaitlistAssignment(): void {
    if (!selectedWaitlist || selectedWaitlist.kind !== 'WALK_IN' || selectedWaitlist.status !== 'WAITING') return
    setSelectedTableIds([])
    setAssignmentMode('waitlist')
    setDisplayMode('floor')
    setPrimaryView('floor')
    setError(null)
  }

  function cancelAssignment(): void {
    setAssignmentMode(null)
    setSelectedTableIds([])
  }

  function handleTableClick(table: TableView): void {
    if (!assignmentMode) {
      setSelectedId((current) => current === table.id ? null : table.id)
      return
    }
    const ownedBySelectedBooking = assignmentMode === 'booking' && selectedBooking?.tableCodes
      .some((code) => normalizedTableCode(code) === table.code)
    const ownedBySelectedVisit = assignmentMode === 'visit'
      && selectedTable?.activeVisit?.id !== undefined
      && table.activeVisit?.id === selectedTable.activeVisit.id
    if (table.isBackup) return
    if (assignmentMode === 'walk-in' && table.state !== 'AVAILABLE') return
    if (table.state !== 'AVAILABLE' && !ownedBySelectedBooking && !ownedBySelectedVisit) return
    setSelectedTableIds((current) => current.includes(table.id)
      ? current.filter((id) => id !== table.id)
      : [...current, table.id])
  }

  async function submitTableConfiguration(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const table = tables.find((item) => item.id === tableConfigurationId)
    if (!table || !can('venue.configure') || !tableConfigurationReason.trim() || mutationInFlight.current) return
    mutationInFlight.current = true
    setSaving(true)
    setError(null)
    try {
      const response = await apiFetch(`/tables/${table.id}/configuration`, {
        method: 'PATCH',
        body: JSON.stringify({ isSpare: !table.isBackup, version: table.version, reason: tableConfigurationReason.trim() }),
      })
      const data = await response.json() as ApiErrorPayload
      if (!response.ok) throw new Error(data.error?.message ?? 'Không thể cập nhật cấu hình bàn.')
      setTableConfigurationId(null)
      setTableConfigurationReason('')
      setNotice(`${table.code} đã chuyển thành ${table.isBackup ? 'bàn thường' : 'bàn sơ cua'}.`)
      await loadData()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Không thể cập nhật cấu hình bàn.')
    } finally {
      mutationInFlight.current = false
      setSaving(false)
    }
  }

  async function submitAssignment(): Promise<void> {
    if (!assignmentMode || !selectedTableIds.length || mutationInFlight.current) return
    let path = ''
    let body: Record<string, unknown>
    if (assignmentMode === 'booking' && selectedBooking) {
      if (selectedBooking.tableCodes.length && !window.confirm('Xác nhận nhả bộ bàn cũ và gán toàn bộ bộ bàn mới cho booking này?')) return
      path = `/bookings/${selectedBooking.id}/assign`
      body = { version: selectedBooking.version, tableIds: selectedTableIds }
    } else if (assignmentMode === 'visit' && selectedTable?.activeVisit) {
      if (!window.confirm('Xác nhận chuyển toàn bộ lượt khách sang bộ bàn đã chọn? Bàn cũ sẽ được lưu trong lịch sử.')) return
      path = `/visits/${selectedTable.activeVisit.id}/move`
      body = { version: selectedTable.activeVisit.version, tableIds: selectedTableIds }
    } else if (assignmentMode === 'waitlist' && selectedWaitlist) {
      path = `/waitlist/${selectedWaitlist.id}/seat`
      body = { version: selectedWaitlist.version, tableIds: selectedTableIds }
    } else if (assignmentMode === 'walk-in') {
      setAssignmentMode(null)
      openWalkIn()
      return
    } else return

    mutationInFlight.current = true
    setSaving(true)
    setError(null)
    try {
      const response = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) })
      const data = await response.json() as ApiErrorPayload
      if (!response.ok) throw new ApiRequestError(data.error?.message ?? 'Không thể gán bàn.', response.status, data.error?.code)
      cancelAssignment()
      setSelectedId(null)
      clearSearch()
      await loadData()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Không thể gán bàn.')
    } finally {
      mutationInFlight.current = false
      setSaving(false)
    }
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await response.json() as AuthenticationView & ApiErrorPayload
      if (!response.ok) throw new Error(data.error?.message ?? 'Đăng nhập không thành công.')
      setAuthentication(data)
      setPassword('')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Đăng nhập không thành công.')
    } finally {
      setSaving(false)
    }
  }

  async function logout(): Promise<void> {
    setSaving(true)
    try {
      await apiFetch('/auth/logout', { method: 'POST' })
    } finally {
      setAuthentication(null)
      setTables([])
      setBookings([])
      setBookingSources([])
      setWaitlist([])
      clearSearch()
      setSaving(false)
    }
  }

  async function requestBooking(path: string, body: Record<string, unknown>): Promise<void> {
    if (mutationInFlight.current) return
    mutationInFlight.current = true
    setSaving(true)
    setError(null)
    try {
      const response = await apiFetch(`/bookings${path}`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const data = (await response.json()) as { error?: { message: string } }
      if (!response.ok) throw new Error(data.error?.message ?? 'Không thể cập nhật booking.')
      clearSearch()
      await loadData()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Không thể cập nhật booking.')
    } finally {
      mutationInFlight.current = false
      setSaving(false)
    }
  }

  async function requestCheckIn(bookingId: number): Promise<void> {
    try {
      const response = await apiFetch(`/bookings/${bookingId}`)
      const data = await response.json() as { booking?: BookingView } & ApiErrorPayload
      if (!response.ok || !data.booking) throw new Error(data.error?.message ?? 'Không tải được booking mới nhất.')
      if (data.booking.status !== 'BOOKED') {
        throw new Error(`Booking hiện ở trạng thái ${bookingStatusLabels[data.booking.status]}. Vui lòng tải lại danh sách.`)
      }
      if (!data.booking.tableCodes.length) {
        throw new Error('Cần gán bàn trước khi check-in.')
      }
      await requestBooking(`/${bookingId}/check-in`, { version: data.booking.version })
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Không thể check-in booking.')
    }
  }

  function requestCancellation(): void {
    if (!selectedBooking || !can('reservation.cancel')) return
    setCancelReason('')
    setCancelDialogOpen(true)
  }

  async function submitCancellation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!selectedBooking || !can('reservation.cancel')) return
    setCancelDialogOpen(false)
    await requestBooking(`/${selectedBooking.id}/cancel`, {
      version: selectedBooking.version,
      ...(cancelReason.trim() ? { reasonNote: cancelReason.trim() } : {}),
    })
  }

  async function submitForm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if ((formMode === 'booking' || formMode === 'edit') && (!formBusinessDate || !arrivalTime)) {
      setError('Vui lòng chọn ngày đặt bàn và giờ đến.')
      return
    }
    if (mutationInFlight.current) return
    mutationInFlight.current = true
    setSaving(true)
    setError(null)
    try {
      if (formMode === 'edit' && !selectedBooking) throw new Error('Booking không còn trong danh sách hiện tại.')
      const endpoint = formMode === 'walk-in'
        ? '/bookings/walk-ins'
        : formMode === 'waitlist'
          ? '/waitlist'
        : formMode === 'edit'
          ? `/bookings/${selectedBooking?.id ?? ''}`
          : '/bookings'
      const payload = formMode === 'walk-in'
        ? { ...(guestName.trim() ? { guestName: guestName.trim() } : {}), partySize: Number(partySize), businessDate, tableIds: selectedTableIds }
        : formMode === 'waitlist'
          ? { guestName, partySize: Number(partySize), businessDate, contactChannel, note }
        : {
            guestName,
            partySize: Number(partySize),
            businessDate: formBusinessDate,
            expectedAt: expectedAtForBusinessDate(formBusinessDate, arrivalTime),
            sourceCode,
            note,
            ...(formMode === 'edit' ? { version: selectedBooking?.version } : {}),
          }
      const response = await apiFetch(endpoint, {
        method: formMode === 'edit' ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      })
      const data = (await response.json()) as ApiErrorPayload & { visitId?: number }
      if (!response.ok) {
        throw new ApiRequestError(data.error?.message ?? 'Không thể lưu dữ liệu.', response.status, data.error?.code)
      }
      const savedBusinessDate = formMode === 'booking' || formMode === 'edit' ? formBusinessDate : businessDate
      if (formMode === 'walk-in' && data.visitId) setNotice(`Đã đón khách vãng lai · Visit #${data.visitId}`)
      if (formMode === 'walk-in') {
        setSelectedTableIds([])
        setSelectedId(null)
      }
      setFormMode(null)
      resetBookingForm()
      clearSearch()
      if (savedBusinessDate === businessDate) await loadData()
      else setBusinessDate(savedBusinessDate)
    } catch (caughtError) {
      if (caughtError instanceof ApiRequestError && caughtError.status === 409) {
        setError(`${caughtError.message} Dữ liệu trên form vẫn được giữ; hãy đóng form và tải lại trước khi thử lại.`)
      } else {
        setError(caughtError instanceof Error ? caughtError.message : 'Không thể lưu dữ liệu.')
      }
    } finally {
      mutationInFlight.current = false
      setSaving(false)
    }
  }

  async function closeActiveVisit(): Promise<void> {
    if (!selectedTable?.activeVisit || !can('visit.end') || mutationInFlight.current) return
    mutationInFlight.current = true
    const visit = selectedTable.activeVisit
    setSaving(true)
    setError(null)
    try {
      const response = await apiFetch(`/visits/${visit.id}/close`, {
        method: 'POST',
        body: JSON.stringify({
          version: visit.version,
          mode: 'MANUAL',
          reason: 'GUEST_LEFT',
          ...(closeVisitNote.trim() ? { note: closeVisitNote.trim() } : {}),
        }),
      })
      const data = await response.json() as ApiErrorPayload
      if (!response.ok) throw new Error(data.error?.message ?? 'Không thể kết thúc lượt khách.')
      setSelectedId(null)
      setCloseVisitOpen(false)
      setCloseVisitNote('')
      clearSearch()
      await loadData()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Không thể kết thúc lượt khách.')
    } finally {
      mutationInFlight.current = false
      setSaving(false)
    }
  }

  if (authLoading) return <div className="auth-shell"><span>Đang kiểm tra phiên đăng nhập…</span></div>

  if (!authentication) {
    return (
      <main className="auth-shell">
        <form className="login-card" onSubmit={(event) => void submitLogin(event)}>
          <img src="/21gam-logo.png" alt="21GAM" />
          <div><span className="eyebrow">QUẢN LÝ VẬN HÀNH</span><h1>Đăng nhập 21GAM</h1></div>
          {error ? <div className="error-banner" role="alert">{error}</div> : null}
          <label>Tên đăng nhập<input autoComplete="username" value={username} required onChange={(event) => setUsername(event.target.value)} /></label>
          <label>Mật khẩu<input type="password" autoComplete="current-password" value={password} required onChange={(event) => setPassword(event.target.value)} /></label>
          <button className="primary-action" type="submit" disabled={saving}>{saving ? 'Đang xác thực…' : 'Đăng nhập'}</button>
          <small>Tài khoản phải được quản trị viên cấp membership và vai trò cho đúng cơ sở.</small>
        </form>
      </main>
    )
  }

  return (
    <div className={`dashboard flex h-screen w-full overflow-hidden ${sidebarOpen ? 'dashboard--sidebar-open' : ''}`}>
      <aside className="sidebar z-10 flex h-full w-16 shrink-0 flex-col" aria-label="Điều hướng chính">
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

      <section className="app-frame flex min-h-0 min-w-0 flex-1 flex-col">
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
            <button className="identity" type="button" disabled={saving} onClick={() => void logout()} title="Đăng xuất">
              <span>{authentication.user.displayName.slice(0, 2).toLocaleUpperCase('vi-VN')}</span>
              <b>{authentication.user.displayName}</b>
            </button>
          </div>
        </header>

        <main className="page flex min-h-0 flex-1 flex-col bg-slate-50">
          <section className="page-toolbar border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div>
              <span className="eyebrow">VẬN HÀNH TRỰC TIẾP</span>
              <h1>Sơ đồ & điều phối bàn</h1>
            </div>
            <div className="view-tabs rounded-lg border border-slate-200 bg-slate-50 p-1" role="tablist" aria-label="Kiểu hiển thị">
              <button type="button" className={primaryView === 'list' ? 'active' : ''} role="tab" aria-selected={primaryView === 'list'} onClick={() => { setPrimaryView('list'); setLeftView('bookings') }}>Danh sách</button>
              <button type="button" className={primaryView === 'timeline' ? 'active' : ''} role="tab" aria-selected={primaryView === 'timeline'} onClick={() => { setPrimaryView('timeline'); setDisplayMode('timeline') }}>Thời gian</button>
              <button type="button" className={primaryView === 'floor' ? 'active' : ''} role="tab" aria-selected={primaryView === 'floor'} onClick={() => { setPrimaryView('floor'); setDisplayMode('floor') }}>Sơ đồ</button>
            </div>
            <div className="toolbar-actions">
              <button className="date-nav-button" type="button" aria-label="Ngày trước" onClick={() => setBusinessDate((date) => addCalendarDays(date, -1))}>‹</button>
              <label className="date-control">
                <span>Ngày phục vụ</span>
                <BookingDatePicker
                  value={businessDate}
                  clearable={false}
                  showIcon
                  onChange={(date) => {
                    setSelectedId(null)
                    clearSearch()
                    setBusinessDate(date)
                  }}
                />
                <small>{formatBusinessDate(businessDate)}</small>
              </label>
              <button className="date-nav-button" type="button" aria-label="Ngày sau" onClick={() => setBusinessDate((date) => addCalendarDays(date, 1))}>›</button>
              <button className="secondary-action" type="button" disabled={exporting || !can('customer.view_masked')} onClick={() => void copyBookingExport()}>{exporting ? 'Đang xuất…' : 'Copy TXT'}</button>
              <button className="secondary-action" type="button" disabled={exporting || !can('customer.view_masked')} onClick={() => void downloadBookingExport()}>Tải TXT</button>
              <button className="secondary-action toolbar-action-group-start" type="button" disabled={!can('visit.walkin') || !selectedTable || selectedTable.state !== 'AVAILABLE' || selectedTable.isBackup} onClick={beginWalkInSelection}>+ Walk-in</button>
              <button className="secondary-action" type="button" disabled={!can('waitlist.create')} onClick={openWaitlist}>+ Chờ</button>
              <button className="primary-action" type="button" disabled={!can('reservation.create')} onClick={openCreateBooking}>+ Tạo đặt bàn</button>
            </div>
          </section>

          {error ? <div className="error-banner" role="alert">{error}</div> : null}
          {notice ? <div className="notice-banner" role="status">{notice}</div> : null}
          {!loading && counts.available === 0 ? <div className="waitlist-alert" role="status"><span>Không còn bàn thường AVAILABLE. Có thể đưa khách vào danh sách chờ; hệ thống sẽ không tự gán bàn.</span><button type="button" disabled={!can('waitlist.create')} onClick={openWaitlist}>+ Thêm khách chờ</button></div> : null}

          <section className="operations-grid grid min-h-0 flex-1 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
            <aside className="booking-column">
              <div className="panel-heading">
                <div><span className="eyebrow">TRONG CA</span><h2>{leftView === 'bookings' ? 'Đặt bàn' : 'Danh sách chờ'}</h2></div>
                <span className="count-badge">{leftView === 'bookings' ? displayedBookings.length : waitlist.length}</span>
              </div>
              <div className="filter-tabs"><button className={leftView === 'bookings' ? 'active' : ''} type="button" onClick={() => setLeftView('bookings')}>Booking</button><button className={leftView === 'waitlist' ? 'active' : ''} type="button" onClick={() => setLeftView('waitlist')}>Chờ</button></div>
              {leftView === 'bookings' ? <form className="booking-search" onSubmit={(event) => void submitSearch(event)}>
                <input aria-label="Tìm booking" placeholder="Tên khách hoặc 3 số cuối" value={searchQuery} maxLength={120} onChange={(event) => setSearchQuery(event.target.value)} />
                <button type="submit" disabled={saving || !searchQuery.trim() || !can('customer.view_masked')}>Tìm</button>
                {searchResults !== null ? <button type="button" onClick={clearSearch}>Xóa lọc</button> : null}
              </form> : null}
              <div className="booking-list">
                {leftView === 'bookings' && !displayedBookings.length ? <div className="empty-panel"><strong>{searchResults === null ? 'Chưa có đặt bàn' : 'Không tìm thấy booking'}</strong><span>{searchResults === null ? 'Nhấn “Tạo đặt bàn” để thêm booking.' : 'Thử tên khác hoặc đúng ba số cuối điện thoại.'}</span></div> : null}
                {leftView === 'bookings' ? displayedBookings.map((booking) => (
                  <article
                    className={`booking-card booking-card--row booking-card--${booking.displayStatus.toLowerCase()} ${selectedBookingId === booking.id ? 'booking-card--selected' : ''}`}
                    key={booking.id}
                  >
                    <div
                      className="booking-card-main"
                      role="button"
                      tabIndex={0}
                      onClick={() => void selectBooking(booking.id)}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void selectBooking(booking.id) } }}
                    >
                      <div className="booking-card-header"><time>{formatBookingTime(booking.expectedAt)}</time><b className={!booking.tableCodes.length ? 'booking-card--unassigned' : undefined}>{booking.tableCodes.length ? booking.tableCodes.join(' + ').replaceAll('BAR0', '') : 'Chưa gán'}</b></div>
                      <strong className="booking-card-name">{booking.guestName}</strong>
                      <div className="booking-card-footer"><span className="booking-card-details"><span className="person-icon" aria-hidden="true"><svg viewBox="0 0 20 20" focusable="false"><circle cx="10" cy="5.5" r="3" /><path d="M4.5 17c.5-3.2 2.3-5 5.5-5s5 1.8 5.5 5" /></svg></span>{booking.partySize} khách · {booking.source} · {booking.phoneLast3 ? `•••• ${booking.phoneLast3}` : 'Không có SĐT'}</span><span className="booking-card-footer-actions"><em>{bookingTimingLabel(booking)}</em>{bookingCardActionLabel(booking) ? <button className="booking-card-action" type="button" disabled={saving || (booking.tableCodes.length > 0 && !can('visit.checkin'))} onClick={() => booking.tableCodes.length ? void requestCheckIn(booking.id) : void selectBooking(booking.id)}>{bookingCardActionLabel(booking)}</button> : null}</span></div>
                    </div>
                  </article>
                )) : null}
                {leftView === 'waitlist' && !waitlist.length ? <div className="empty-panel"><strong>Danh sách chờ trống</strong><span>Nhấn “+ Chờ” khi chưa có bàn phù hợp.</span></div> : null}
                {leftView === 'waitlist' ? waitlist.map((entry) => (
                  <button
                    className={`booking-card booking-card--waitlist ${selectedWaitlistId === entry.id ? 'booking-card--selected' : ''}`}
                    key={entry.id}
                    type="button"
                    onClick={() => setSelectedWaitlistId((current) => current === entry.id ? null : entry.id)}
                  >
                    <time>{formatBookingTime(entry.queuedAt)}</time>
                    <span><strong>{entry.guestName}</strong><small>{entry.partySize} khách · {entry.contactChannel}</small></span>
                    <b>{entry.kind === 'WALK_IN' ? 'Walk-in' : `Booking #${entry.reservationId ?? ''}`}</b>
                    <em>{waitlistStatusLabels[entry.status]}</em>
                  </button>
                )) : null}
              </div>
              {leftView === 'bookings' && selectedBooking ? (
                <div className="booking-actions">
                  <strong>{selectedBooking.guestName}</strong>
                  <dl className="booking-detail-list">
                    <div><dt>Trạng thái</dt><dd>{bookingTimingLabel(selectedBooking)}</dd></div>
                    <div><dt>Giờ hẹn</dt><dd>{formatBookingTime(selectedBooking.expectedAt)}</dd></div>
                    <div><dt>Số khách</dt><dd>{selectedBooking.partySize}</dd></div>
                    <div><dt>Nguồn</dt><dd>{selectedBooking.source}</dd></div>
                    <div><dt>Bàn</dt><dd>{selectedBooking.tableCodes.length ? selectedBooking.tableCodes.map(normalizedTableCode).join(' + ') : 'Chưa gán'}</dd></div>
                    <div><dt>SĐT</dt><dd>{selectedBooking.phoneLast3 ? `••• ${selectedBooking.phoneLast3}` : 'Không có dữ liệu'}</dd></div>
                    <div className="booking-detail-wide"><dt>Ghi chú</dt><dd>{selectedBooking.note || 'Không có'}</dd></div>
                  </dl>
                  {selectedBooking.status === 'BOOKED' ? <>
                    <button type="button" disabled={saving || !can('reservation.update')} onClick={openEditBooking}>Sửa booking</button>
                    <button type="button" disabled={saving || !can('table.assign')} onClick={beginBookingAssignment}>{selectedBooking.tableCodes.length ? 'Đổi / gộp bàn' : 'Chọn / gộp bàn'}</button>
                    <button type="button" disabled={saving || !can('visit.checkin') || !selectedBooking.tableCodes.length} onClick={() => void requestCheckIn(selectedBooking.id)}>Khách đã tới</button>
                    <button type="button" disabled={saving || !can('reservation.mark_no_show')} onClick={() => void requestBooking(`/${selectedBooking.id}/no-show`, { version: selectedBooking.version })}>Không đến</button>
                    <button type="button" disabled={saving || !can('reservation.cancel')} onClick={requestCancellation}>Hủy booking</button>
                  </> : <span>{bookingStatusLabels[selectedBooking.status]}</span>}
                </div>
              ) : null}
              {leftView === 'waitlist' && selectedWaitlist ? (
                <div className="booking-actions">
                  <strong>{selectedWaitlist.guestName}</strong>
                  {selectedWaitlist.kind === 'WALK_IN' && selectedWaitlist.status === 'WAITING' ? (
                    <><span>{counts.available > 0 ? `${counts.available} bàn thường đang trống; lễ tân cần chọn và xác nhận.` : 'Chưa có bàn thường trống; không thể tự động gán.'}</span><button type="button" disabled={saving || counts.available === 0 || !can('waitlist.accept_offer') || !can('visit.walkin')} onClick={beginWaitlistAssignment}>Chọn bàn & đón khách</button></>
                  ) : <span>{selectedWaitlist.kind === 'ADVANCE_RESERVATION' ? 'Yêu cầu này liên kết booking; xử lý tại Booking.' : waitlistStatusLabels[selectedWaitlist.status]}</span>}
                </div>
              ) : null}
            </aside>

            <section className="floor-column">
              <div className="floor-summary">
                {assignmentMode ? <div className="assignment-toolbar">
                  <strong>{assignmentMode === 'booking' ? 'Chọn bộ bàn cho booking' : assignmentMode === 'visit' ? 'Chọn bộ bàn chuyển đến' : assignmentMode === 'walk-in' ? 'Chọn bàn đón khách vãng lai' : 'Chọn bàn cho khách chờ'}</strong>
                  <span>{selectedTableIds.length} bàn đã chọn</span>
                  <button type="button" disabled={saving} onClick={cancelAssignment}>Hủy</button>
                  <button type="button" disabled={saving || !selectedTableIds.length} onClick={() => void submitAssignment()}>{saving ? 'Đang xử lý…' : 'Xác nhận'}</button>
                </div> : <>
                  <div className="zone-tabs"><button className="active" type="button">Tất cả</button>{areas.map((area) => <button type="button" disabled key={area.code}>{area.name}</button>)}</div>
                  <button className="availability-button" type="button" onClick={() => { setPrimaryView('floor'); setDisplayMode('floor') }}>⌕ Xem khả dụng</button>
                  <span>{counts.total} vị trí · {counts.inUse} đang dùng · {counts.available} trống</span>
                </>}
              </div>
              <div className="legend" aria-label="Chú thích trạng thái bàn">
                <span><i className="dot dot--available" />Trống <b>{counts.available}</b></span>
                <span><i className="dot dot--reserved" />Đã giữ <b>{counts.reserved}</b></span>
                <span><i className="dot dot--in-use" />Đang dùng <b>{counts.inUse}</b></span>
                <span><i className="dot dot--spare" />Sơ cua <b>{counts.spare}</b></span>
              </div>
              {displayMode === 'floor' ? <div className="floor-canvas" aria-label="Sơ đồ bàn 21GAM">
                <FloorCanvasV2
                  tables={tables}
                  selectedId={selectedId}
                  selectedIds={selectedTableIds}
                    theme={theme}
                    bookings={bookings}
                  onTableClick={(tableId) => {
                    const table = tables.find((item) => item.id === tableId)
                    if (table) handleTableClick(table)
                  }}
                />
                <div className="legacy-floor-map" aria-hidden="true">
                <div className="floor-entry-label font-sans tracking-widest">↑ LỐI VÀO</div>
                <div className="fixture fixture--left" /><div className="fixture fixture--right" />
                <div className="bar-counter"><span>KHU PHA CHẾ</span></div>
                {loading ? <p className="canvas-empty">Đang tải sơ đồ…</p> : null}
                {!loading && !tables.length ? <p className="canvas-empty">Chưa có dữ liệu bàn từ API</p> : null}
                {areas.map((area) => (
                  <div
                    key={area.code}
                    className={`floor-zone-container floor-zone-container--${area.code.toLowerCase()}`}
                    style={floorZoneLayouts[area.code] ? {
                      left: `${floorZoneLayouts[area.code].left}%`,
                      top: `${floorZoneLayouts[area.code].top}%`,
                      width: `${floorZoneLayouts[area.code].width}%`,
                      height: `${floorZoneLayouts[area.code].height}%`,
                    } : undefined}
                    aria-label={area.name}
                  >
                    <h3>{floorZoneLayouts[area.code]?.title ?? area.name}</h3>
                    <div className="floor-zone-tables">
                      {tables.filter((table) => table.area.code === area.code).map((table) => {
                        const layout = floorZoneLayouts[area.code]
                        const position = layout ? {
                          x: ((table.position.x - layout.left) / layout.width) * 100,
                          y: ((table.position.y - layout.top) / layout.height) * 100,
                        } : table.position
                        return <TableNode
                          key={table.id}
                          table={table}
                          position={position}
                          selected={selectedId === table.id}
                          multiSelected={selectedTableIds.includes(table.id)}
                          onSelect={handleTableClick}
                        />
                      })}
                    </div>
                  </div>
                ))}
                </div>
              </div> : <div className="timeline-view">
                <div className="timeline-control">
                  <div><span className="eyebrow">LỊCH DỰ KIẾN</span><strong>Booking theo giờ đã chọn</strong></div>
                  <label>Giờ xem<input type="time" min="00:00" max="23:59" value={timelineTime} onChange={(event) => setTimelineTime(event.target.value)} /></label>
                </div>
                <p className="timeline-disclaimer">Sơ đồ trạng thái là dữ liệu sử dụng thực tế hiện tại. Danh sách dưới đây chỉ thể hiện lịch đặt dự kiến trong khoảng ±60 phút; hệ thống không suy đoán bàn trống trong tương lai.</p>
                <div className="timeline-actual"><strong>Thực tế hiện tại</strong><span>{counts.inUse} đang dùng · {counts.reserved} đang giữ · {counts.available} trống</span></div>
                <div className="timeline-list">
                  {bookings.filter((booking) => {
                    const difference = Math.abs(minutesFromBusinessStart(formatBookingTime(booking.expectedAt)) - minutesFromBusinessStart(timelineTime))
                    return difference <= 60 && booking.status !== 'CANCELLED' && booking.status !== 'NO_SHOW'
                  }).map((booking) => <article key={booking.id}>
                    <time>{formatBookingTime(booking.expectedAt)}</time>
                    <div><strong>{booking.guestName}</strong><span>{booking.partySize} khách · {booking.tableCodes.length ? booking.tableCodes.map(normalizedTableCode).join(' + ') : 'Chưa gán bàn'}</span></div>
                    <em>{bookingTimingLabel(booking)}</em>
                  </article>)}
                  {!bookings.some((booking) => Math.abs(minutesFromBusinessStart(formatBookingTime(booking.expectedAt)) - minutesFromBusinessStart(timelineTime)) <= 60 && booking.status !== 'CANCELLED' && booking.status !== 'NO_SHOW') ? <div className="empty-panel timeline-empty">
                    <svg className="timeline-empty-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <rect x="3.5" y="5" width="17" height="16" rx="2" />
                      <path d="M7.5 3v4M16.5 3v4M3.5 9.5h17M8 14h2m4 0h2m-8 3h2" />
                    </svg>
                    <strong>Không có booking trong khoảng giờ này</strong>
                    <span>Thay đổi giờ để xem lịch dự kiến khác.</span>
                  </div> : null}
                </div>
              </div>}
            </section>

            <aside className="shift-column">
              <div className="shift-overview-panel">
                <div className="panel-heading"><div><span className="eyebrow">CA TỐI · {formatBusinessDate(businessDate)}</span><h2>Tổng quan</h2></div><span className="shift-updated">17:00 → 05:00</span></div>
                <div className="metric-grid metric-grid--overview">
                  <article><span>Khách đang ngồi</span><strong>{seatedGuestCount}</strong><small>khách đang dùng bàn</small></article>
                  <article><span>Công suất</span><strong>{counts.inUse} / {counts.total || 0}</strong><small>vị trí đang dùng</small></article>
                  <article><span>Sắp đến</span><strong>{displayedBookings.filter((booking) => booking.status === 'BOOKED').length}</strong><small>booking còn lại</small></article>
                  <article><span>Danh sách chờ</span><strong>{waitlist.filter((entry) => entry.status === 'WAITING').length}</strong><small>nhóm đang chờ</small></article>
                </div>
              </div>
              <div className="right-waitlist-panel">
                <div className="panel-heading"><div><span className="eyebrow">WAITLIST</span><h2>Danh sách chờ</h2></div><button className="inline-add-button" type="button" disabled={!can('waitlist.create')} onClick={openWaitlist}>Thêm</button></div>
                <div className="right-waitlist-list">
                  {waitlist.filter((entry) => entry.status === 'WAITING').map((entry) => (
                    <button className="right-waitlist-item" type="button" key={entry.id} onClick={() => { setLeftView('waitlist'); setSelectedWaitlistId(entry.id) }}>
                      <span><strong>{entry.guestName}</strong><small>{entry.partySize} khách · {entry.contactChannel} · {waitlistStatusLabels[entry.status]}</small></span>
                      <b>{entry.kind === 'WALK_IN' ? 'Xếp chỗ' : 'Tìm bàn'}</b>
                    </button>
                  ))}
                  {!waitlist.some((entry) => entry.status === 'WAITING') ? <p className="right-waitlist-empty">Chưa có khách trong danh sách chờ.</p> : null}
                </div>
              </div>
              {selectedTable ? (
                <div className="table-detail">
                  <div className="panel-heading"><div><span className="eyebrow">CHI TIẾT BÀN</span><h2>{selectedTable.displayName}</h2></div><button className="close-button" type="button" onClick={() => setSelectedId(null)}>×</button></div>
                  <dl><div><dt>Khu vực</dt><dd>{selectedTable.area.name}</dd></div><div><dt>Trạng thái</dt><dd>{stateLabels[selectedTable.state]}</dd></div><div><dt>Sức chứa</dt><dd>{selectedTable.capacity ?? 'Chưa cập nhật'}</dd></div><div><dt>Phiên bản</dt><dd>{selectedTable.version}</dd></div></dl>
                  <div className="detail-actions">
                    <button type="button" disabled={saving || !can('table.assign') || selectedBooking?.status !== 'BOOKED'} onClick={beginBookingAssignment}>Chọn / đổi / gộp bàn cho booking</button>
                    <span>Trạng thái bàn được cập nhật tự động qua booking và lượt khách.</span>
                  </div>
                  {can('venue.configure') ? <button className="spare-action" type="button" disabled={saving || Boolean(selectedTable.activeVisit) || selectedTable.state !== 'AVAILABLE'} onClick={() => { setTableConfigurationReason(''); setTableConfigurationId(selectedTable.id) }}>
                    {selectedTable.isBackup ? 'Chuyển thành bàn thường' : 'Đặt làm bàn sơ cua'}
                  </button> : null}
                  {selectedTable.activeVisit ? (
                    <div className="visit-close-panel">
                      <span className="eyebrow">LƯỢT ĐANG MỞ</span>
                      <strong>Visit #{selectedTable.activeVisit.id}</strong>
                      <span>{selectedTable.activeVisit.tableCodes.length} bàn: {selectedTable.activeVisit.tableCodes.join(' + ').replaceAll('BAR0', '')}</span>
                      <button type="button" disabled={saving || !can('visit.move')} onClick={beginVisitMove}>Chuyển / gộp sang bộ bàn khác</button>
                      <button type="button" disabled={saving || !can('visit.end')} onClick={() => setCloseVisitOpen(true)} title={can('visit.end') ? 'Kết thúc lượt và trả toàn bộ bàn' : 'Tài khoản không có quyền visit.end'}>
                        Kết thúc lượt / Trả bàn
                      </button>
                      <small>{can('visit.end') ? 'Server sẽ kiểm tra lại session, membership và quyền trước khi trả bàn.' : 'Tài khoản không có quyền visit.end.'}</small>
                    </div>
                  ) : null}
                  <small className="table-config-note">{selectedTable.isBackup ? 'Bàn sơ cua: không nhận booking hoặc allocation mới.' : 'Bàn thường: có thể nhận booking và allocation.'}</small>
                </div>
              ) : (
                <div className="current-overview-panel">
                  <div className="panel-heading"><div><span className="eyebrow">CA HIỆN TẠI</span><h2>Tổng quan</h2></div></div>
                  <div className="metric-grid"><article><span>Vị trí</span><strong>{counts.total || '—'}</strong></article><article><span>Đang dùng</span><strong>{counts.inUse}</strong></article><article><span>Đã giữ</span><strong>{counts.reserved}</strong></article><article><span>Sơ cua</span><strong>{counts.spare}</strong></article></div>
                  <div className="shift-note"><strong>Booking và danh sách chờ dùng dữ liệu thật</strong><span>Chọn booking hoặc khách chờ, sau đó chọn một hay nhiều bàn trên sơ đồ để thao tác.</span></div>
                </div>
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
              <div><span className="eyebrow">{formMode === 'walk-in' ? 'WALK-IN' : formMode === 'waitlist' ? 'WAITLIST' : 'BOOKING'}</span><h2>{formMode === 'walk-in' ? `Mở bàn ${selectedTable?.code ?? ''}` : formMode === 'waitlist' ? 'Thêm khách chờ' : formMode === 'edit' ? 'Sửa đặt bàn' : 'Tạo đặt bàn'}</h2></div>
              <button type="button" disabled={saving} onClick={() => setFormMode(null)}>×</button>
            </div>
            {error ? <div className="error-banner form-wide" role="alert">{error}<button type="button" disabled={loading} onClick={() => void loadData()}>Tải lại dữ liệu server</button></div> : null}
            {formMode === 'walk-in' ? <>
              <div className="form-wide walkin-summary"><strong>Bàn đã chọn</strong><span>{selectedTableIds.map((id) => tables.find((table) => table.id === id)?.code).filter(Boolean).join(' · ') || 'Chưa chọn bàn'}</span><small>Ngày nghiệp vụ: {businessDate}</small></div>
              <details className="form-wide walkin-extra"><summary>Thông tin bổ sung (không bắt buộc)</summary><label>Tên khách<input maxLength={120} value={guestName} onChange={(event) => setGuestName(event.target.value)} /></label><label>Ghi chú<textarea maxLength={500} value={note} rows={2} onChange={(event) => setNote(event.target.value)} /></label></details>
            </> : <label>Tên khách<input maxLength={120} value={guestName} required onChange={(event) => setGuestName(event.target.value)} /></label>}
            <label>Số khách
              <div className="party-size-control">
                <input type="number" min="1" max="500" value={partySize} required onChange={(event) => setPartySize(event.target.value)} />
                <div className="party-size-stepper">
                  <button type="button" aria-label="Tăng số khách" onClick={() => setPartySize(String(Math.min(500, (Number(partySize) || 1) + 1)))}>+</button>
                  <button type="button" aria-label="Giảm số khách" onClick={() => setPartySize(String(Math.max(1, (Number(partySize) || 1) - 1)))}>−</button>
                </div>
              </div>
            </label>
            {formMode === 'booking' || formMode === 'edit' ? <>
              <label>Ngày đặt bàn<BookingDatePicker value={formBusinessDate} onChange={setFormBusinessDate} /></label>
              <label>Giờ đến<BookingTimePicker value={arrivalTime} onChange={setArrivalTime} /></label>
              <label>Nguồn<select value={sourceCode} required onChange={(event) => setSourceCode(event.target.value)}>{bookingSources.map((source) => <option value={source.code} key={source.code}>{source.name}</option>)}</select></label>
              <label className="form-wide">Ghi chú<textarea maxLength={500} value={note} rows={3} onChange={(event) => setNote(event.target.value)} /></label>
            </> : formMode === 'waitlist' ? <>
              <label>Kênh liên hệ<select value={contactChannel} required onChange={(event) => setContactChannel(event.target.value)}><option value="IN_PERSON">Tại quán</option><option value="PHONE_CALLBACK">Gọi lại</option><option value="ZALO_THREAD">Zalo</option><option value="FANPAGE_THREAD">Fanpage</option><option value="OTHER">Khác</option></select></label>
              <label className="form-wide">Ghi chú<textarea maxLength={500} value={note} rows={3} onChange={(event) => setNote(event.target.value)} /></label>
              <p className="form-wide form-note">Khách chỉ được tạo một entry WALK_IN. Khi có bàn, lễ tân phải chọn và xác nhận thủ công; hệ thống không tự gán.</p>
            </> : <p className="form-wide form-note">Walk-in sẽ mở toàn bộ bàn đã chọn và tạo lượt khách đang sử dụng.</p>}
            <div className="form-actions"><button type="button" disabled={saving} onClick={() => setFormMode(null)}>Đóng</button><button className="primary-action" type="submit" disabled={saving || (formMode === 'walk-in' && !selectedTableIds.length)}>{saving ? 'Đang lưu…' : formMode === 'walk-in' ? 'Xác nhận nhận bàn' : formMode === 'edit' ? 'Lưu thay đổi' : 'Xác nhận'}</button></div>
          </form>
        </div>
      ) : null}
      {tableConfigurationId !== null ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setTableConfigurationId(null) }}>
          <form className="booking-form" onSubmit={(event) => void submitTableConfiguration(event)}>
            <div className="form-heading"><div><span className="eyebrow">CẤU HÌNH BÀN</span><h2>{tables.find((table) => table.id === tableConfigurationId)?.code}</h2></div><button type="button" disabled={saving} onClick={() => setTableConfigurationId(null)}>×</button></div>
            <p className="form-wide">{tables.find((table) => table.id === tableConfigurationId)?.isBackup ? 'Chuyển bàn sơ cua thành bàn thường để có thể nhận booking.' : 'Đặt bàn thành sơ cua. Bàn phải không còn HOLD hoặc USAGE đang mở.'}</p>
            <label>Lý do thay đổi<textarea required maxLength={500} rows={3} value={tableConfigurationReason} onChange={(event) => setTableConfigurationReason(event.target.value)} /></label>
            <button className="primary-action" type="submit" disabled={saving || !tableConfigurationReason.trim()}>{saving ? 'Đang lưu…' : 'Xác nhận cấu hình'}</button>
          </form>
        </div>
      ) : null}
      {cancelDialogOpen && selectedBooking ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setCancelDialogOpen(false)
        }}>
          <form className="booking-form cancel-booking-form" onSubmit={(event) => void submitCancellation(event)}>
            <div className="form-heading">
              <div><span className="eyebrow">HỦY BOOKING</span><h2>Hủy đặt bàn của {selectedBooking.guestName}</h2></div>
              <button type="button" disabled={saving} onClick={() => setCancelDialogOpen(false)}>×</button>
            </div>
            <p className="form-wide form-note">Booking sẽ chuyển sang CANCELLED và toàn bộ HOLD/allocation đang mở sẽ được release. Lý do được lưu trong operation log.</p>
            <label className="form-wide">Lý do hủy (không bắt buộc)<textarea autoFocus maxLength={300} rows={3} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Ví dụ: khách yêu cầu hủy qua hotline" /></label>
            <div className="form-actions">
              <button type="button" disabled={saving} onClick={() => setCancelDialogOpen(false)}>Quay lại</button>
              <button className="danger-action" type="submit" disabled={saving || !can('reservation.cancel')}>{saving ? 'Đang hủy…' : 'Xác nhận hủy booking'}</button>
            </div>
          </form>
        </div>
      ) : null}
      {closeVisitOpen && selectedTable?.activeVisit ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setCloseVisitOpen(false)
        }}>
          <form className="booking-form close-visit-form" onSubmit={(event) => {
            event.preventDefault()
            void closeActiveVisit()
          }}>
            <div className="form-heading">
              <div><span className="eyebrow">XÁC NHẬN TRẢ BÀN</span><h2>Kết thúc Visit #{selectedTable.activeVisit.id}</h2></div>
              <button type="button" disabled={saving} onClick={() => setCloseVisitOpen(false)}>×</button>
            </div>
            <p className="form-wide form-note">
              Toàn bộ bàn {selectedTable.activeVisit.tableCodes.join(' + ').replaceAll('BAR0', '')} sẽ được nhả với lý do khách đã rời quán. Thao tác vẫn được server kiểm tra phiên bản để chống xử lý đồng thời.
            </p>
            <label className="form-wide">Ghi chú (không bắt buộc)<textarea value={closeVisitNote} maxLength={500} rows={3} onChange={(event) => setCloseVisitNote(event.target.value)} /></label>
            <div className="form-actions">
              <button type="button" disabled={saving} onClick={() => setCloseVisitOpen(false)}>Quay lại</button>
              <button className="primary-action" type="submit" disabled={saving || !can('visit.end')}>{saving ? 'Đang kết thúc…' : 'Xác nhận trả bàn'}</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}

export default App
