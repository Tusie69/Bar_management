/**
 * Minimal transaction for the mock store: records the before-image of every
 * row it touches, bumps `version` once per transaction (optimistic locking),
 * and can roll back. The recorded before-images double as undo payloads.
 *
 * Note: the real backend implements Undo as compensating operations on
 * append-only rows (db09). The mock restores before-images instead, which
 * gives the same observable result for the prototype.
 */
import { ApiError } from "../contracts"
import { allocId, type CollectionName, type Collections, type MockDb, type UndoEntry } from "./db"

export type RowOf<C extends CollectionName> = Collections[C] extends Map<number, infer R> ? R : never

interface Touched {
  col: CollectionName
  id: number
  before: unknown | undefined
}

export class Tx {
  private touched = new Map<string, Touched>()
  private readonly db: MockDb

  constructor(db: MockDb) {
    this.db = db
  }

  private map<C extends CollectionName>(col: C): Map<number, RowOf<C>> {
    return this.db[col] as unknown as Map<number, RowOf<C>>
  }

  /** Get a live row for mutation. Version is bumped once per transaction. */
  edit<C extends CollectionName>(col: C, id: number): RowOf<C> {
    const row = this.map(col).get(id)
    if (!row) throw new ApiError(404, "NOT_FOUND", `Không tìm thấy ${col} #${id}`)
    const key = `${col}:${id}`
    if (!this.touched.has(key)) {
      this.touched.set(key, { col, id, before: structuredClone(row) })
      ;(row as unknown as { version: number }).version += 1
    }
    return row
  }

  insert<C extends CollectionName>(col: C, data: Omit<RowOf<C>, "id" | "version">): RowOf<C> {
    const id = allocId(this.db, col)
    const row = { ...data, id, version: 1 } as unknown as RowOf<C>
    this.map(col).set(id, row)
    this.touched.set(`${col}:${id}`, { col, id, before: undefined })
    return row
  }

  /** Restore a before-image (used by undo). */
  restore(col: CollectionName, id: number, before: unknown | undefined) {
    const map = this.db[col] as unknown as Map<number, { version: number }>
    const current = map.get(id)
    const key = `${col}:${id}`
    if (!this.touched.has(key)) {
      this.touched.set(key, { col, id, before: current ? structuredClone(current) : undefined })
    }
    if (before === undefined) {
      map.delete(id)
      return
    }
    const restored = structuredClone(before) as { version: number }
    restored.version = (current?.version ?? 0) + 1
    map.set(id, restored)
  }

  entries(): UndoEntry[] {
    return [...this.touched.values()].map((t) => {
      const map = this.db[t.col] as unknown as Map<number, { version: number }>
      return { col: t.col, id: t.id, before: t.before, afterVersion: map.get(t.id)?.version ?? 0 }
    })
  }

  get size() {
    return this.touched.size
  }

  rollback() {
    for (const t of this.touched.values()) {
      const map = this.db[t.col] as unknown as Map<number, unknown>
      if (t.before === undefined) map.delete(t.id)
      else map.set(t.id, t.before)
    }
    this.touched.clear()
  }
}
