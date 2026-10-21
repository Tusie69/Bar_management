import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createApp } from '../src/app.js'

const unusedRepository = {
  async listByDate() { return [] },
  async updateStatus() { throw new Error('Không được gọi trong kiểm thử này') },
}

test('GET /api/v1/health trả về ok', async (context) => {
  const server = createApp({ tableRepository: unusedRepository }).listen(0, '127.0.0.1')
  context.after(() => server.close())
  await once(server, 'listening')

  const { port } = server.address()
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`)

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true })
})
