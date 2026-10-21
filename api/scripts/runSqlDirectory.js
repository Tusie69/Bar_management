import { readFile, readdir } from 'node:fs/promises'

const splitStatements = (sql) => sql.split(';').map((statement) => statement.trim()).filter(Boolean)

export const runSqlDirectory = async (pool, directoryUrl) => {
  const fileNames = (await readdir(directoryUrl)).filter((name) => name.endsWith('.sql')).sort()
  for (const fileName of fileNames) {
    const sql = await readFile(new URL(fileName, directoryUrl), 'utf8')
    for (const statement of splitStatements(sql)) await pool.query(statement)
    console.log(`Đã chạy ${fileName}`)
  }
}
