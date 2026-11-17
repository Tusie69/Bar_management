// TU-31 mục 5: chính sách giữ bản sao lưu. Test mô phỏng lịch sử nhiều tuần
// thật sự, vì mọi lỗi ở đây đều im lặng: một bản bị xoá sớm chỉ lộ ra vào ngày
// cần phục hồi.
//
// Chạy script qua spawn giống init-local-secrets.test.ts: đó cũng là cách
// backup-mysql.sh gọi nó, nên test đi qua đúng đường mà production đi.
import { spawnSync } from 'node:child_process'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const script = path.resolve('../deploy/scripts/backup-retention.mjs')

interface RetentionPlan {
  keepDaily: string[]
  keepWeekly: string[]
  keep: string[]
  deleteList: string[]
  ignored: string[]
}

function plan(names: readonly string[]): RetentionPlan {
  const result = spawnSync(process.execPath, [script, '--json'], {
    input: names.join('\n'),
    encoding: 'utf8',
  })
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout) as RetentionPlan
}

function deletions(names: readonly string[]): string[] {
  const result = spawnSync(process.execPath, [script], {
    input: names.join('\n'),
    encoding: 'utf8',
  })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout.split('\n').filter((line) => line !== '')
}

/** Tên bản sao lưu 06:00 của một ngày, đúng namespace production. */
function daily(date: string): string {
  return `21gam_${date.replaceAll('-', '')}_0600.sql.gz`
}

/**
 * Lịch sử backup 06:00 hằng ngày, liên tục, kết thúc vào `endDate`.
 * Trả về mới nhất trước để assertion đọc thuận chiều.
 */
function dailyHistory(endDate: string, days: number): string[] {
  const end = new Date(`${endDate}T00:00:00Z`)
  const names: string[] = []
  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(end.getTime() - offset * 86_400_000)
    names.push(daily(day.toISOString().slice(0, 10)))
  }
  return names
}

describe('chính sách giữ bản sao lưu 21GAM', () => {
  it('giữ 7 daily và 4 weekly trên lịch sử 8 tuần chạy liên tục', () => {
    // 56 ngày liên tục, kết thúc thứ Hai 2026-11-16 (ISO 2026-W47).
    const history = dailyHistory('2026-11-16', 56)
    const result = plan(history)

    expect(result.keepDaily).toEqual([
      daily('2026-11-16'), daily('2026-11-15'), daily('2026-11-14'),
      daily('2026-11-13'), daily('2026-11-12'), daily('2026-11-11'),
      daily('2026-11-10'),
    ])

    // Tuần ISO bắt đầu thứ Hai, nên bản mới nhất của mỗi tuần là bản Chủ nhật,
    // trừ tuần hiện tại mới có đúng một ngày (thứ Hai 16/11).
    expect(result.keepWeekly).toEqual([
      daily('2026-11-16'), // W47, tuần đang chạy
      daily('2026-11-15'), // W46 kết thúc Chủ nhật 15/11
      daily('2026-11-08'), // W45
      daily('2026-11-01'), // W44
    ])

    // Hai bản đầu vừa là daily vừa là weekly: keep không được đếm trùng.
    expect(result.keep).toEqual([...new Set(result.keep)])
    expect(result.keep).toHaveLength(9)
    expect(result.deleteList).toHaveLength(56 - 9)
  })

  it('không bao giờ xoá bản weekly chỉ vì nó đã rơi ra khỏi 7 daily', () => {
    const history = dailyHistory('2026-11-16', 30)
    const result = plan(history)

    // 01/11 và 08/11 cách hôm nay hơn 7 ngày nên không còn là daily, nhưng là
    // mốc weekly của W44/W45 và phải sống sót. Đây chính là luật "không xoá
    // bản weekly đang được giữ chỉ vì vượt giới hạn daily".
    expect(result.keepDaily).not.toContain(daily('2026-11-08'))
    expect(result.keepDaily).not.toContain(daily('2026-11-01'))
    expect(result.keep).toContain(daily('2026-11-08'))
    expect(result.keep).toContain(daily('2026-11-01'))
    expect(result.deleteList).not.toContain(daily('2026-11-08'))
    expect(result.deleteList).not.toContain(daily('2026-11-01'))
  })

  it('chỉ giữ bản mới nhất trong ngày khi một ngày chạy nhiều lần', () => {
    // Chạy tay thêm trước khi migrate là chuyện bình thường trong docs/deploy.md.
    const history = [
      '21gam_20261116_1430.sql.gz',
      '21gam_20261116_0600.sql.gz',
      ...dailyHistory('2026-11-15', 10),
    ]
    const result = plan(history)

    expect(result.keep).toContain('21gam_20261116_1430.sql.gz')
    expect(result.deleteList).toContain('21gam_20261116_0600.sql.gz')
    // Ngày 16/11 chỉ tiêu một suất daily, không phải hai.
    expect(result.keepDaily).toHaveLength(7)
    expect(result.keepDaily[0]).toBe('21gam_20261116_1430.sql.gz')
  })

  it('không xoá gì khi lịch sử còn ngắn hơn chính sách', () => {
    const result = plan(dailyHistory('2026-11-16', 5))
    expect(result.deleteList).toEqual([])
    expect(result.keep).toHaveLength(5)
  })

  it('giữ bản duy nhất, không bao giờ để thư mục trống', () => {
    const result = plan(['21gam_20260101_0600.sql.gz'])
    expect(result.deleteList).toEqual([])
    expect(result.keep).toEqual(['21gam_20260101_0600.sql.gz'])
  })

  it('đếm weekly theo tuần có dữ liệu, không theo tuần lịch', () => {
    // Scheduler chỉ chạy được mỗi tuần một lần trong 10 tuần. Bốn mốc weekly
    // phải là bốn tuần CÓ backup gần nhất. Nếu đếm theo 4 tuần lịch tính từ
    // hôm nay thì ba tuần giữa bị coi là trống và weekly tụt xuống còn một.
    const weekly = Array.from({ length: 10 }, (_, index) => {
      const day = new Date(Date.UTC(2026, 10, 16) - index * 7 * 86_400_000)
      return daily(day.toISOString().slice(0, 10))
    })
    const result = plan(weekly)

    expect(result.keepWeekly).toEqual(weekly.slice(0, 4))
    // Mỗi bản cũng là một ngày riêng, nên luật 7-daily rộng hơn luật 4-weekly
    // và quyết định kết quả: giữ 7 bản mới nhất, xoá 3 bản cũ nhất.
    expect(result.keep).toEqual(weekly.slice(0, 7))
    expect(result.deleteList).toEqual(weekly.slice(7).reverse())
  })

  it('bỏ qua mọi file ngoài namespace 21GAM', () => {
    const foreign = [
      'gam21_platform-20261110-030000.sql.gz', // bản theo tên cũ, không sở hữu
      'gam21_platform-pre-restore-20261110-030000.sql.gz',
      '21gam_20261116_0600.sql.gz.partial', // lần chạy hỏng
      'notes.txt',
      '21gam_20261116.sql.gz', // thiếu phần giờ
      '21gam_20261332_0600.sql.gz', // tháng 13 không tồn tại
      '21gam_20261116_2560.sql.gz', // phút 60 không tồn tại
      ...dailyHistory('2026-11-16', 40),
    ]
    const result = plan(foreign)

    expect(result.ignored).toEqual([
      'gam21_platform-20261110-030000.sql.gz',
      'gam21_platform-pre-restore-20261110-030000.sql.gz',
      '21gam_20261116_0600.sql.gz.partial',
      'notes.txt',
      '21gam_20261116.sql.gz',
      '21gam_20261332_0600.sql.gz',
      '21gam_20261116_2560.sql.gz',
    ])
    for (const name of result.ignored) {
      expect(result.deleteList).not.toContain(name)
    }
  })

  it('xoá từ bản cũ nhất trước, để dừng giữa đường vẫn an toàn', () => {
    const list = deletions(dailyHistory('2026-11-16', 40))
    expect(list.length).toBeGreaterThan(1)
    const ascending = [...list].sort()
    expect(list).toEqual(ascending)
  })

  it('không in gì khi không có bản nào cần xoá', () => {
    expect(deletions(dailyHistory('2026-11-16', 3))).toEqual([])
    expect(deletions([])).toEqual([])
  })

  it('không nhân đôi quyết định khi danh sách có tên trùng', () => {
    // `rclone lsf` và `ls` có thể bị gộp lại trong một lần chạy tay.
    const history = dailyHistory('2026-11-16', 20)
    const result = plan([...history, ...history])
    expect(result.keep).toEqual([...new Set(result.keep)])
    expect(result.deleteList).toEqual([...new Set(result.deleteList)])
    expect(result.keep).toHaveLength(plan(history).keep.length)
  })
})
