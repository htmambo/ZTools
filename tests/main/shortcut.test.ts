import { describe, expect, it } from 'vitest'
import {
  getAltModifierName,
  getDefaultLauncherShortcut,
  getLauncherHotkeyPresets,
  normalizeShortcutForPlatform
} from '../../src/shared/shortcut'

describe('shortcut platform helpers', () => {
  it('在 macOS 上使用 Option 作为 Alt 修饰键名称', () => {
    expect(getAltModifierName('darwin')).toBe('Option')
  })

  it('在 Linux 和 Windows 上使用 Alt 作为 Alt 修饰键名称', () => {
    expect(getAltModifierName('linux')).toBe('Alt')
    expect(getAltModifierName('win32')).toBe('Alt')
  })

  it('为不同平台返回正确的默认呼出快捷键', () => {
    expect(getDefaultLauncherShortcut('darwin')).toBe('Option+Z')
    expect(getDefaultLauncherShortcut('linux')).toBe('Alt+Z')
    expect(getDefaultLauncherShortcut('win32')).toBe('Alt+Z')
  })

  it('为 Linux 和 Windows 返回非 macOS 预设快捷键', () => {
    expect(getLauncherHotkeyPresets('linux')).toEqual([
      { label: 'Alt + Space', value: 'Alt+Space' },
      { label: 'Ctrl + Space', value: 'Ctrl+Space' }
    ])
    expect(getLauncherHotkeyPresets('win32')).toEqual([
      { label: 'Alt + Space', value: 'Alt+Space' },
      { label: 'Ctrl + Space', value: 'Ctrl+Space' }
    ])
  })

  it('在非 macOS 上将遗留的 Option 快捷键归一化为 Alt', () => {
    expect(normalizeShortcutForPlatform('Option+Z', 'linux')).toBe('Alt+Z')
    expect(normalizeShortcutForPlatform('Ctrl+Option+X', 'win32')).toBe('Ctrl+Alt+X')
  })

  it('在 macOS 上保留 Option 快捷键不变', () => {
    expect(normalizeShortcutForPlatform('Option+Z', 'darwin')).toBe('Option+Z')
  })

  it('归一化是幂等的：多次调用结果一致', () => {
    const cases = ['Option+Z', 'Ctrl+Option+X', 'Alt+Z', 'Ctrl+Alt+Shift+L']
    for (const input of cases) {
      const once = normalizeShortcutForPlatform(input, 'linux')
      const twice = normalizeShortcutForPlatform(once, 'linux')
      expect(twice).toBe(once)
    }
    // darwin 不做转换，亦应幂等
    expect(
      normalizeShortcutForPlatform(normalizeShortcutForPlatform('Option+Z', 'darwin'), 'darwin')
    ).toBe('Option+Z')
  })
})
