import { InvalidTransitionError, NotFoundError } from '../../errors.js'
import { isAllowedTransition } from './tableStatuses.js'

const mapRow = (row) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  zone: row.zone,
  capacity: row.capacity,
  position: { x: row.position_x, y: row.position_y },
  isBackup: Boolean(row.is_backup),
  status: row.status,
})

export class MySqlTableRepository {
  constructor(databasePool) {
    this.pool = databasePool
  }

  async listByDate(businessDate) {
    const [rows] = await this.pool.execute(
      `SELECT t.id, t.code, t.name, t.zone, t.capacity, t.position_x, t.position_y,
              t.is_backup,
              COALESCE(s.status, IF(t.is_backup = 1, 'BACKUP_INACTIVE', 'AVAILABLE')) AS status
       FROM tables t
       LEFT JOIN table_daily_statuses s ON s.table_id = t.id AND s.business_date = ?
       WHERE t.is_active = 1
       ORDER BY t.display_order, t.code`,
      [businessDate],
    )
    return rows.map(mapRow)
  }

  async updateStatus({ id, businessDate, status }) {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const [rows] = await connection.execute(
        `SELECT t.id, t.is_backup,
                COALESCE(s.status, IF(t.is_backup = 1, 'BACKUP_INACTIVE', 'AVAILABLE')) AS status
         FROM tables t
         LEFT JOIN table_daily_statuses s ON s.table_id = t.id AND s.business_date = ?
         WHERE t.id = ? AND t.is_active = 1
         FOR UPDATE`,
        [businessDate, id],
      )
      if (rows.length === 0) throw new NotFoundError(`Không tìm thấy bàn có mã ${id}.`)

      const currentStatus = rows[0].status
      if (!isAllowedTransition(currentStatus, status)) throw new InvalidTransitionError(currentStatus, status)

      await connection.execute(
        `INSERT INTO table_daily_statuses (table_id, business_date, status)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = CURRENT_TIMESTAMP`,
        [id, businessDate, status],
      )
      await connection.commit()
      return { id, date: businessDate, previousStatus: currentStatus, status }
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }
}
