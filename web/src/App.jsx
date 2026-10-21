import { useEffect, useState } from 'react'
import './App.css'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

function App() {
  const [apiStatus, setApiStatus] = useState('checking')

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${apiBaseUrl}/health`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('API không phản hồi thành công')
        return response.json()
      })
      .then((data) => setApiStatus(data.ok ? 'online' : 'offline'))
      .catch((error) => {
        if (error.name !== 'AbortError') setApiStatus('offline')
      })
    return () => controller.abort()
  }, [])

  const labels = {
    checking: 'Đang kiểm tra API…',
    online: 'API đã kết nối',
    offline: 'API chưa kết nối',
  }

  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">GAM21 · HỆ THỐNG NỘI BỘ</p>
        <h1>Quản lý đặt bàn</h1>
        <p className="description">Khung React/Vite đã sẵn sàng để phát triển sơ đồ bàn và luồng lễ tân.</p>
        <div className={`status status--${apiStatus}`}>
          <span className="status__dot" aria-hidden="true" />
          {labels[apiStatus]}
        </div>
      </section>
    </main>
  )
}

export default App
