import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 回归测试：ZToolsCenter/ZTools#603
// 通过 ZTools 本地启动的程序应以其所在目录作为工作目录（对齐资源管理器双击行为），
// 否则子进程会继承 ZTools 主进程的 CWD（开机自启/提权时通常为 system32），
// 导致程序把相对路径解析到 C:\WINDOWS\system32 下而报权限错误。

const { mockLaunch, mockUwpLaunch, mockOpenPath, mockOpenExternal } = vi.hoisted(() => ({
  mockLaunch: vi.fn(async () => ({ success: true, hresult: 0, stage: 'launched' })),
  mockUwpLaunch: vi.fn(() => true),
  mockOpenPath: vi.fn(async () => ''),
  mockOpenExternal: vi.fn(async () => undefined)
}))

vi.mock('child_process', () => ({ spawn: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })) }))
vi.mock('electron', () => ({
  dialog: { showMessageBox: vi.fn() },
  shell: { openPath: mockOpenPath, openExternal: mockOpenExternal }
}))
vi.mock('../../src/main/core/native', () => ({
  UwpManager: { launchUwpApp: mockUwpLaunch },
  WindowsShellLauncher: { launch: mockLaunch }
}))

import {
  launchApp,
  resolveLaunchWorkingDirectory
} from '../../src/main/core/commandLauncher/windowsLauncher'

describe('resolveLaunchWorkingDirectory', () => {
  it('返回带路径 .exe 的所在目录（Windows 语义）', () => {
    expect(resolveLaunchWorkingDirectory('C:\\Program Files\\MyApp\\app.exe')).toBe(
      'C:\\Program Files\\MyApp'
    )
  })

  it('保留含空格/中文的目录', () => {
    expect(resolveLaunchWorkingDirectory('D:\\软件 目录\\子目录\\tool.exe')).toBe(
      'D:\\软件 目录\\子目录'
    )
  })

  it('对 PATH 中的裸 exe（无分隔符）返回 undefined', () => {
    expect(resolveLaunchWorkingDirectory('notepad.exe')).toBeUndefined()
  })

  it('对 .lnk 返回 undefined（由快捷方式自身的起始目录决定）', () => {
    expect(resolveLaunchWorkingDirectory('C:\\Users\\Me\\Desktop\\App.lnk')).toBeUndefined()
  })

  it('对非 exe 目标返回 undefined', () => {
    expect(resolveLaunchWorkingDirectory('C:\\docs\\readme.txt')).toBeUndefined()
  })
})

describe('launchApp 传递工作目录 (#603)', () => {
  beforeEach(() => {
    mockLaunch.mockClear()
    mockOpenPath.mockClear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('启动带完整路径的 exe 时，向原生启动器传入 exe 所在目录作为 workingDirectory', async () => {
    await launchApp('C:\\Program Files\\MyApp\\app.exe')

    expect(mockLaunch).toHaveBeenCalledTimes(1)
    const opts = mockLaunch.mock.calls[0][0]
    expect(opts.target).toBe('C:\\Program Files\\MyApp\\app.exe')
    expect(opts.workingDirectory).toBe('C:\\Program Files\\MyApp')
  })

  it('启动使用正斜杠的完整路径 exe 时，向原生启动器传入 exe 所在目录作为 workingDirectory', async () => {
    await launchApp('C:/Program Files/MyApp/app.exe')

    expect(mockLaunch).toHaveBeenCalledTimes(1)
    const opts = mockLaunch.mock.calls[0][0]
    expect(opts.target).toBe('C:/Program Files/MyApp/app.exe')
    expect(opts.workingDirectory).toBe('C:/Program Files/MyApp')
  })

  it('启动 .lnk 时不覆盖 workingDirectory（保持 undefined）', async () => {
    await launchApp('C:\\Users\\Me\\Desktop\\App.lnk')

    expect(mockLaunch).toHaveBeenCalledTimes(1)
    const opts = mockLaunch.mock.calls[0][0]
    expect(opts.workingDirectory).toBeUndefined()
  })

  it('PATH 中的裸 exe 走 shell.openPath，不进入原生启动器', async () => {
    await launchApp('calc.exe')

    expect(mockLaunch).not.toHaveBeenCalled()
    expect(mockOpenPath).toHaveBeenCalledWith('calc.exe')
  })
})
