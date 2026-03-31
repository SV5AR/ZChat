/**
 * LocalDB abstraction placeholder. Intended to be backed by SQLCipher.
 * For now, this exposes an async API with an in-memory Map fallback.
 * Later: replace implementation with SQLCipher (sql.js + encryption) or native bindings.
 */

type Row = { id: string; table: string; data: any }

const store = new Map<string, Row>()

export async function localPut(table: string, id: string, data: any) {
  store.set(id, { id, table, data })
}

export async function localGet(table: string, id: string) {
  const r = store.get(id)
  return r && r.table === table ? r.data : null
}

export async function localAll(table: string) {
  const res: any[] = []
  for (const v of store.values()) if (v.table === table) res.push(v.data)
  return res
}

export async function localDelete(table: string, id: string) {
  store.delete(id)
}
