#!/usr/bin/env node
// Quyết định bản sao lưu nào được giữ và bản nào bị xoá — TU-31 mục 5.
//
// Tách khỏi backup-mysql.sh vì chính sách "7 daily + 4 weekly, không xoá bản
// mới nhất" là logic có nhiều trường hợp biên: tuần thiếu bản, một bản vừa là
// daily vừa là weekly, file lạ trong cùng thư mục. Logic như vậy phải có test
// mô phỏng lịch sử nhiều tuần, và bash không phải nơi test được việc đó.
//
// Dùng:
//   ls -1 /srv/21gam/backups | node backup-retention.mjs --json
//   rclone lsf remote:21gam | node backup-retention.mjs
//
// Đọc danh sách tên file trên stdin, mỗi dòng một tên (chỉ basename). In ra:
//   - mặc định: tên các file CẦN XOÁ, mỗi dòng một tên;
//   - --json:   kế hoạch đầy đủ để kiểm tra/log.
//
// Không tự xoá gì. Việc xoá do phía gọi làm, nên script này an toàn để chạy thử.

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Namespace backup 21GAM: 21gam_YYYYMMDD_HHmm.sql.gz
// Mọi file không khớp đúng mẫu này đều bị bỏ qua hoàn toàn, không bao giờ bị
// đề nghị xoá. Thư mục sao lưu có thể chứa bản pre-restore, file của người
// khác hoặc .partial của một lần chạy hỏng; chính sách này không sở hữu chúng.
const BACKUP_PATTERN = /^21gam_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})\.sql\.gz$/

const DAILY_KEEP = 7
const WEEKLY_KEEP = 4

/**
 * @typedef {object} BackupFile
 * @property {string} name
 * @property {number} sortKey  YYYYMMDDHHmm dạng số, so sánh trực tiếp được
 * @property {string} day      YYYY-MM-DD
 * @property {string} week     YYYY-Www theo tuần ISO (thứ Hai đầu tuần)
 */

/**
 * Tách tên file thành mốc thời gian. Trả về null nếu tên không thuộc namespace
 * hoặc mang ngày/giờ không tồn tại (ví dụ 20261332_2599).
 *
 * Dấu thời gian trong tên đã là giờ Asia/Ho_Chi_Minh do backup-mysql.sh sinh
 * ra, nên ở đây đọc nó như giờ địa phương và không quy đổi múi giờ. Quy đổi
 * thêm một lần nữa là cách chắc chắn nhất để một bản backup bị tính sang ngày
 * khác và bị xoá sớm hơn chính sách.
 * @param {string} name
 * @returns {BackupFile | null}
 */
export function parseBackupName(name) {
  const match = BACKUP_PATTERN.exec(name)
  if (!match) return null
  const [, yearText, monthText, dayText, hourText, minuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null
  // Date.UTC chuẩn hoá ngày tràn (32/01 -> 01/02), nên so lại ba thành phần
  // để từ chối ngày không tồn tại thay vì âm thầm dịch sang ngày khác.
  const instant = new Date(Date.UTC(year, month - 1, day, hour, minute))
  if (
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== day
  ) {
    return null
  }
  return {
    name,
    sortKey: Number(`${yearText}${monthText}${dayText}${hourText}${minuteText}`),
    day: `${yearText}-${monthText}-${dayText}`,
    week: isoWeekLabel(instant),
  }
}

/**
 * Nhãn tuần ISO (YYYY-Www) của một mốc UTC. Dùng tuần ISO vì nó không phụ
 * thuộc locale: tuần luôn bắt đầu thứ Hai và luôn có đúng 7 ngày, nên "mỗi
 * tuần một bản" không bị nhập nhằng ở đầu năm.
 * @param {Date} instant
 */
function isoWeekLabel(instant) {
  const anchor = new Date(instant.getTime())
  anchor.setUTCHours(0, 0, 0, 0)
  // Dời tới thứ Năm cùng tuần ISO: năm ISO của một tuần là năm chứa thứ Năm.
  const isoWeekday = anchor.getUTCDay() === 0 ? 7 : anchor.getUTCDay()
  anchor.setUTCDate(anchor.getUTCDate() + 4 - isoWeekday)
  const isoYear = anchor.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4))
  const firstIsoWeekday = firstThursday.getUTCDay() === 0 ? 7 : firstThursday.getUTCDay()
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstIsoWeekday)
  const week = 1 + Math.round((anchor.getTime() - firstThursday.getTime()) / (7 * 86_400_000))
  return `${isoYear}-W${String(week).padStart(2, '0')}`
}

/**
 * @typedef {object} RetentionPlan
 * @property {string[]} keepDaily    bản giữ theo chính sách 7 ngày
 * @property {string[]} keepWeekly   bản giữ theo chính sách 4 tuần
 * @property {string[]} keep         hợp của hai nhóm trên, mới nhất trước
 * @property {string[]} deleteList   bản cần xoá, cũ nhất trước
 * @property {string[]} ignored      file ngoài namespace, không thuộc quyền
 */

/**
 * Áp dụng chính sách giữ bản sao lưu.
 *
 * Chính sách:
 *   1. Giữ bản mới nhất của mỗi ngày, với 7 ngày có backup gần nhất.
 *   2. Giữ thêm bản mới nhất của mỗi tuần, với 4 tuần có backup gần nhất.
 *   3. Bản mới nhất tuyệt đối luôn được giữ, kể cả khi hai luật trên đã đủ số.
 *
 * Điểm (2) đếm theo "tuần CÓ backup" chứ không theo 4 tuần lịch tính từ hôm
 * nay. Nếu scheduler chết hai tuần thì cách đếm theo tuần lịch sẽ lặng lẽ bỏ
 * hết weekly cũ và chỉ còn vài bản daily; đếm theo tuần có dữ liệu thì giữ
 * nhiều hơn chính sách tối thiểu, và giữ thừa một bản luôn rẻ hơn mất bản.
 *
 * Một bản vừa là daily vừa là weekly chỉ xuất hiện một lần trong `keep`, nên
 * phía gọi không cần tự lọc trùng.
 *
 * @param {Iterable<string>} names danh sách basename trong thư mục/remote
 * @returns {RetentionPlan}
 */
export function planRetention(names) {
  /** @type {BackupFile[]} */
  const parsed = []
  /** @type {string[]} */
  const ignored = []
  const seen = new Set()

  for (const raw of names) {
    const name = raw.trim()
    if (name === '') continue
    if (seen.has(name)) continue
    seen.add(name)
    const file = parseBackupName(name)
    if (file) parsed.push(file)
    else ignored.push(name)
  }

  // Mới nhất trước: mọi luật dưới đây đều là "lấy bản mới nhất của nhóm".
  parsed.sort((left, right) => right.sortKey - left.sortKey)

  const newestPerDay = new Map()
  const newestPerWeek = new Map()
  for (const file of parsed) {
    if (!newestPerDay.has(file.day)) newestPerDay.set(file.day, file.name)
    if (!newestPerWeek.has(file.week)) newestPerWeek.set(file.week, file.name)
  }

  const keepDaily = [...newestPerDay.values()].slice(0, DAILY_KEEP)
  const keepWeekly = [...newestPerWeek.values()].slice(0, WEEKLY_KEEP)

  const keepSet = new Set([...keepDaily, ...keepWeekly])
  // Luật 3. Với chính sách hiện tại bản mới nhất đã luôn nằm trong keepDaily,
  // nhưng để lại đây như một chốt: đổi DAILY_KEEP/WEEKLY_KEEP thành 0 cũng
  // không được phép dẫn tới xoá sạch.
  if (parsed.length > 0) keepSet.add(parsed[0].name)

  const deleteList = parsed
    .filter((file) => !keepSet.has(file.name))
    .map((file) => file.name)
    .reverse() // cũ nhất trước: xoá từ cũ tới mới, dừng giữa đường vẫn an toàn

  return {
    keepDaily,
    keepWeekly,
    keep: parsed.filter((file) => keepSet.has(file.name)).map((file) => file.name),
    deleteList,
    ignored,
  }
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

// Chỉ chạy khi được gọi trực tiếp; import từ test thì không làm gì.
function invokedDirectly() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  const asJson = process.argv.includes('--json')
  const text = await readStdin()
  const plan = planRetention(text.split('\n'))
  if (asJson) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
  else if (plan.deleteList.length > 0) process.stdout.write(`${plan.deleteList.join('\n')}\n`)
}
