// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useState } from 'react'
import { useStudioHistory } from './useStudioHistory'

function setup() {
  return renderHook(({ key, paused }) => {
    const [value, setValue] = useState({ x: 1, fitStretch: true })
    return { value, setValue, ...useStudioHistory<typeof value>(value, setValue, key, paused) }
  }, { initialProps: { key: 'template-1', paused: false } })
}

describe('Studio history', () => {
  it('undoes and redoes while preserving advanced options', () => {
    const { result } = setup()
    act(() => result.current.setValue({ x: 2, fitStretch: true }))
    expect(result.current.canUndo).toBe(true)
    act(() => result.current.undo())
    expect(result.current.value).toEqual({ x: 1, fitStretch: true })
    act(() => result.current.redo())
    expect(result.current.value.x).toBe(2)
    act(() => result.current.undo())
    act(() => result.current.setValue({ x: 3, fitStretch: false }))
    expect(result.current.canRedo).toBe(false)
  })
  it('groups a drag into one operation and clears history on template change', () => {
    const { result, rerender } = setup()
    rerender({ key: 'template-1', paused: true })
    for (let x = 2; x < 10; x++) act(() => result.current.setValue({ x, fitStretch: true }))
    act(() => result.current.undo()) // no mutation while dragging
    expect(result.current.value.x).toBe(9)
    rerender({ key: 'template-1', paused: false })
    act(() => result.current.undo())
    expect(result.current.value.x).toBe(1)
    expect(result.current.canUndo).toBe(false)
    rerender({ key: 'template-2', paused: false })
    expect(result.current.canRedo).toBe(false)
  })
  it('bounds memory to 60 edits', () => {
    const { result } = setup()
    for (let x = 2; x < 100; x++) act(() => result.current.setValue({ x, fitStretch: true }))
    for (let i = 0; i < 70; i++) act(() => result.current.undo())
    expect(result.current.value.x).toBe(39)
  })
})
