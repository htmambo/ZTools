import { screen } from 'electron'

/**
 * Linux Wayland 下 Electron 38 的 screen.getCursorScreenPoint() 可能在主进程卡住。
 * 对这类会话统一回退到主显示器，优先保证窗口能创建出来。
 */
export function isLinuxWaylandSession(): boolean {
  return process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland'
}

export function getSafeCursorScreenPoint(): Electron.Point {
  if (!isLinuxWaylandSession()) {
    return screen.getCursorScreenPoint()
  }

  const display = screen.getPrimaryDisplay()
  return {
    x: display.workArea.x + Math.floor(display.workArea.width / 2),
    y: display.workArea.y + Math.floor(display.workArea.height / 2)
  }
}

export function getSafeDisplayAtCursor(): Electron.Display {
  if (!isLinuxWaylandSession()) {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  }

  return screen.getPrimaryDisplay()
}
