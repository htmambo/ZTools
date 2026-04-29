export type SupportedPlatform = 'darwin' | 'win32' | 'linux'

export interface HotkeyPreset {
  label: string
  value: string
}

/**
 * 返回当前平台用于表示 Alt/Option 的快捷键修饰键名称。
 */
export function getAltModifierName(platform: string): 'Alt' | 'Option' {
  return platform === 'darwin' ? 'Option' : 'Alt'
}

/**
 * 返回主窗口默认呼出快捷键。
 */
export function getDefaultLauncherShortcut(platform: string): string {
  return `${getAltModifierName(platform)}+Z`
}

/**
 * 返回设置页展示的主窗口快捷键预设。
 */
export function getLauncherHotkeyPresets(platform: string): HotkeyPreset[] {
  if (platform === 'darwin') {
    return [
      { label: 'Command + Space', value: 'Command+Space' },
      { label: 'Option + Space', value: 'Option+Space' }
    ]
  }

  return [
    { label: 'Alt + Space', value: 'Alt+Space' },
    { label: 'Ctrl + Space', value: 'Ctrl+Space' }
  ]
}

/**
 * 归一化跨平台快捷键字符串，兼容旧版本在 Linux/Windows 上错误写入的 Option 形式。
 */
export function normalizeShortcutForPlatform(shortcut: string, platform: string): string {
  if (!shortcut || platform === 'darwin') {
    return shortcut
  }

  return shortcut
    .split('+')
    .map((part) => (part === 'Option' ? 'Alt' : part))
    .join('+')
}
