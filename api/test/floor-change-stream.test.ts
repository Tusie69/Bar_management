/**
 * AC09 on the server: the floor stream's cursor rules.
 *
 * These are the rules that keep an event from being mistaken for data: a frame
 * only ever says "your snapshot is stale", the cursor never rewinds on a racing
 * announcement, and a rolled-back transaction cannot produce a frame because the
 * cursor it would have carried was never committed.
 */
import type { Response } from 'express'
import { afterEach, describe, expect, it } from 'vitest'

import {
  floorChangeSubscriberCount,
  publishFloorChange,
  resetFloorChangeStream,
  subscribeToFloorChanges,
} from '../src/modules/tables/floor-change-stream.js'

interface FakeResponse {
  response: Response
  frames: Array<{ event: string; data: Record<string, unknown> }>
  headers: Record<string, string>
  close: () => void
}

/** The parts of a streaming Response this module actually uses. */
function fakeResponse(): FakeResponse {
  const frames: FakeResponse['frames'] = []
  const headers: Record<string, string> = {}
  let onClose: (() => void) | undefined
  const response = {
    writeHead(_status: number, values: Record<string, string>) {
      Object.assign(headers, values)
      return this
    },
    write(chunk: string) {
      const event = /^event: (.+)$/m.exec(chunk)
      const data = /^data: (.+)$/m.exec(chunk)
      if (event && data) frames.push({ event: event[1]!, data: JSON.parse(data[1]!) as Record<string, unknown> })
      return true
    },
    on(name: string, handler: () => void) {
      if (name === 'close') onClose = handler
      return this
    },
    end() {
      return this
    },
  } as unknown as Response
  return { response, frames, headers, close: () => onClose?.() }
}

const venue = { organizationId: 1, venueId: 1 }

afterEach(() => resetFloorChangeStream())

describe('floor change stream', () => {
  it('opens a no-store event stream with proxy buffering turned off', () => {
    const device = fakeResponse()
    subscribeToFloorChanges({ ...venue, response: device.response })

    expect(device.headers['Content-Type']).toBe('text/event-stream; charset=utf-8')
    expect(device.headers['Cache-Control']).toContain('no-store')
    // Without this a buffering reverse proxy spends the whole two-second budget.
    expect(device.headers['X-Accel-Buffering']).toBe('no')
    expect(floorChangeSubscriberCount()).toBe(1)
  })

  it('greets a new device with the cursor it already knows, so a late joiner resyncs', () => {
    const first = fakeResponse()
    subscribeToFloorChanges({ ...venue, response: first.response })
    expect(first.frames).toEqual([{ event: 'hello', data: { venueId: 1, changeSeq: null } }])

    publishFloorChange({ ...venue, changeSeq: '42' })
    const second = fakeResponse()
    subscribeToFloorChanges({ ...venue, response: second.response })
    expect(second.frames[0]).toEqual({ event: 'hello', data: { venueId: 1, changeSeq: '42' } })
  })

  it('carries only the cursor — never a name, a phone or what changed', () => {
    const device = fakeResponse()
    subscribeToFloorChanges({ ...venue, response: device.response })
    publishFloorChange({ ...venue, changeSeq: '7' })

    const frame = device.frames.at(-1)!
    expect(frame.event).toBe('floor-changed')
    expect(Object.keys(frame.data).sort()).toEqual(['changeSeq', 'venueId'])
  })

  it('publishes each cursor once and ignores a repeat', () => {
    const device = fakeResponse()
    subscribeToFloorChanges({ ...venue, response: device.response })
    publishFloorChange({ ...venue, changeSeq: '7' })
    publishFloorChange({ ...venue, changeSeq: '7' })
    publishFloorChange({ ...venue, changeSeq: '8' })

    expect(device.frames.filter((frame) => frame.event === 'floor-changed').map((frame) => frame.data.changeSeq))
      .toEqual(['7', '8'])
  })

  it('never rewinds on an announcement that raced behind a newer one', () => {
    const device = fakeResponse()
    subscribeToFloorChanges({ ...venue, response: device.response })
    publishFloorChange({ ...venue, changeSeq: '9' })
    publishFloorChange({ ...venue, changeSeq: '5' })

    expect(device.frames.filter((frame) => frame.event === 'floor-changed').map((frame) => frame.data.changeSeq))
      .toEqual(['9'])
  })

  it('rebases to the database when the venue cursor really moved backwards', () => {
    const device = fakeResponse()
    subscribeToFloorChanges({ ...venue, response: device.response })
    publishFloorChange({ ...venue, changeSeq: '9' })
    // Only the poll against the database may do this: a restored venue row would
    // otherwise sit below the cached high-water mark and silence the stream.
    publishFloorChange({ ...venue, changeSeq: '4' }, { rebase: true })
    publishFloorChange({ ...venue, changeSeq: '5' })

    expect(device.frames.filter((frame) => frame.event === 'floor-changed').map((frame) => frame.data.changeSeq))
      .toEqual(['9', '4', '5'])
  })

  it('only reaches the devices watching that venue', () => {
    const home = fakeResponse()
    const other = fakeResponse()
    subscribeToFloorChanges({ ...venue, response: home.response })
    subscribeToFloorChanges({ organizationId: 1, venueId: 2, response: other.response })

    publishFloorChange({ ...venue, changeSeq: '3' })
    expect(home.frames.some((frame) => frame.event === 'floor-changed')).toBe(true)
    expect(other.frames.some((frame) => frame.event === 'floor-changed')).toBe(false)
  })

  it('forgets a device that disconnected', () => {
    const device = fakeResponse()
    const unsubscribe = subscribeToFloorChanges({ ...venue, response: device.response })
    expect(floorChangeSubscriberCount()).toBe(1)
    unsubscribe()
    expect(floorChangeSubscriberCount()).toBe(0)

    publishFloorChange({ ...venue, changeSeq: '11' })
    expect(device.frames.some((frame) => frame.event === 'floor-changed')).toBe(false)
  })

  it('forgets a device whose socket closed on its own', () => {
    const device = fakeResponse()
    subscribeToFloorChanges({ ...venue, response: device.response })
    device.close()
    expect(floorChangeSubscriberCount()).toBe(0)
  })
})
