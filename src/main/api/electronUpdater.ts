import path from 'path'
import { net } from 'electron'
import log from 'electron-log'
import { NsisUpdater, autoUpdater, type UpdateInfo } from 'electron-updater'
import {
  resolveCnbLatestRelease,
  type CnbLatestRelease,
  type UpdateSourceRedirectResponse
} from '../updateSource'
import type {
  PlatformDownloadStatus,
  PlatformUpdateActionResult,
  PlatformUpdateInfo,
  PlatformUpdateResult,
  PlatformUpdaterCallbacks
} from './platformUpdater/types'

export type ElectronUpdaterState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'not-available'
  | 'error'

/**
 * 将 electron-updater 的发布说明统一转换为界面可展示的纯文本。
 * @param releaseNotes electron-updater 返回的发布说明。
 * @returns 合并后的发布说明文本。
 */
function normalizeReleaseNotes(releaseNotes: UpdateInfo['releaseNotes']): string {
  if (typeof releaseNotes === 'string') return releaseNotes
  if (!Array.isArray(releaseNotes)) return ''
  return releaseNotes
    .map((item) => item.note)
    .filter(Boolean)
    .join('\n\n')
}

/**
 * 将 electron-updater 更新信息转换为平台无关的更新信息。
 * @param info electron-updater 返回的更新信息。
 * @returns 供主进程和更新窗口使用的统一更新信息。
 */
function toPlatformUpdateInfo(info: UpdateInfo): PlatformUpdateInfo {
  const releaseNotes = normalizeReleaseNotes(info.releaseNotes)
  return {
    version: info.version,
    changelog: releaseNotes,
    releaseNotes
  }
}

/**
 * 使用 Electron ClientRequest 获取 CNB latest 的首次重定向地址。
 * @param url CNB latest 入口地址。
 * @param timeoutMs 请求超时时间，单位为毫秒。
 * @returns 重定向状态码和目标 Release 地址。
 * @throws 请求超时、网络失败或服务端未返回重定向时抛出错误。
 */
function requestCnbLatestRedirect(
  url: string,
  timeoutMs: number
): Promise<UpdateSourceRedirectResponse> {
  return new Promise((resolve, reject) => {
    // 使用 HEAD 避免下载 Release 页面，manual 模式通过 redirect 事件暴露目标地址。
    const request = net.request({ method: 'HEAD', url, redirect: 'manual' })
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      request.abort()
      reject(new Error(`请求 CNB latest 超时（${timeoutMs}ms）`))
    }, timeoutMs)

    // 捕获目标地址后立即结束请求；manual 重定向产生的取消错误会被 settled 状态忽略。
    request.once('redirect', (status, _method, redirectUrl) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ status, location: redirectUrl })
      request.abort()
    })
    request.once('response', (response) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(new Error(`CNB latest 未发生重定向: HTTP ${response.statusCode}`))
    })
    request.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    request.end()
  })
}

export class ElectronUpdaterService {
  private state: ElectronUpdaterState = 'idle'
  private updateInfo: PlatformUpdateInfo | null = null
  private checkPromise: Promise<PlatformUpdateResult> | null = null
  private downloadPromise: Promise<PlatformUpdateActionResult> | null = null
  private showWindowAfterDownload = true

  /**
   * 初始化标准更新器并绑定跨平台更新事件。
   * @param callbacks 更新生命周期回调。
   * @returns 创建的标准更新服务实例。
   */
  constructor(private readonly callbacks: PlatformUpdaterCallbacks) {
    // 禁止后台静默安装，由现有更新窗口统一控制下载和重启时机。
    autoUpdater.logger = log
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.autoRunAppAfterInstall = true
    autoUpdater.allowPrerelease = autoUpdater.currentVersion.prerelease.length > 0
    autoUpdater.disableDifferentialDownload = false

    // 将 electron-updater 状态映射到应用现有的更新状态机。
    autoUpdater.on('checking-for-update', () => {
      this.state = 'checking'
    })
    autoUpdater.on('update-available', (info) => {
      this.state = 'available'
      this.updateInfo = toPlatformUpdateInfo(info)
    })
    autoUpdater.on('update-not-available', () => {
      this.state = 'not-available'
      this.updateInfo = null
    })
    autoUpdater.on('download-progress', (info) => this.callbacks.onDownloadProgress(info))
    autoUpdater.on('update-downloaded', (info) => {
      this.state = 'downloaded'
      this.updateInfo = toPlatformUpdateInfo(info)
      this.callbacks.onDownloaded(this.updateInfo, this.showWindowAfterDownload)
    })
    autoUpdater.on('error', (error) => {
      this.state = 'error'
      this.callbacks.onDownloadFailed(error.message)
    })
  }

  /**
   * 检查标准更新源，并按需立即下载可用更新。
   * @param downloadWhenAvailable 发现更新后是否立即下载。
   * @returns 更新检查结果。
   */
  public async checkForUpdates(downloadWhenAvailable = false): Promise<PlatformUpdateResult> {
    if (this.checkPromise) return this.checkPromise

    // 合并并发检查，避免重复解析 CNB latest 和请求 Release 元数据。
    this.checkPromise = this.doCheckForUpdates(downloadWhenAvailable).finally(() => {
      this.checkPromise = null
    })
    return this.checkPromise
  }

  /**
   * 执行一次 electron-updater 检查并转换结果。
   * @param downloadWhenAvailable 发现更新后是否立即下载。
   * @returns 更新检查结果。
   */
  private async doCheckForUpdates(downloadWhenAvailable: boolean): Promise<PlatformUpdateResult> {
    try {
      this.state = 'checking'
      const latestRelease = await this.configureCnbFeed()
      const result = await autoUpdater.checkForUpdates()
      if (result && result.updateInfo.version !== latestRelease.version) {
        throw new Error(
          `CNB Release tag 与更新元数据版本不一致: ${latestRelease.tag} / ${result.updateInfo.version}`
        )
      }
      if (!result || (this.state as ElectronUpdaterState) === 'not-available') {
        return {
          success: true,
          status: 'not-available',
          hasUpdate: false,
          currentVersion: autoUpdater.currentVersion.version,
          latestVersion: result?.updateInfo.version
        }
      }

      this.updateInfo = toPlatformUpdateInfo(result.updateInfo)
      if (downloadWhenAvailable) {
        const downloadResult = await this.downloadUpdate(true)
        if (!downloadResult.success) {
          return {
            success: false,
            status: 'error',
            hasUpdate: true,
            currentVersion: autoUpdater.currentVersion.version,
            latestVersion: this.updateInfo.version,
            updateInfo: this.updateInfo,
            error: downloadResult.error
          }
        }
      }

      return {
        success: true,
        status: this.state,
        hasUpdate: true,
        currentVersion: autoUpdater.currentVersion.version,
        latestVersion: this.updateInfo.version,
        updateInfo: this.updateInfo
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '检查更新失败'
      this.state = 'error'
      return {
        success: false,
        status: 'error',
        hasUpdate: false,
        currentVersion: autoUpdater.currentVersion.version,
        error: message
      }
    }
  }

  /**
   * 解析 CNB 最新正式版并将 electron-updater 切换到对应的 Generic feed。
   * @returns 当前 CNB 最新正式版信息。
   * @throws latest 重定向无效或 CNB 网络请求失败时抛出错误。
   */
  private async configureCnbFeed(): Promise<CnbLatestRelease> {
    // 使用 Electron 网络栈继承系统代理和证书配置。
    const latestRelease = await resolveCnbLatestRelease(requestCnbLatestRedirect)

    // 使用多个独立的单段 Range 请求执行差分下载，避开 CNB 不完整的多段 Range 支持。
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: latestRelease.downloadBaseUrl,
      useMultipleRangeRequest: false
    })
    return latestRelease
  }

  /**
   * 下载当前检查到的更新安装包，优先差分下载并在失败时回退到完整下载。
   * @param showWindowAfterDownload 下载完成后是否显示更新窗口。
   * @returns 下载操作结果。
   */
  public async downloadUpdate(
    showWindowAfterDownload: boolean
  ): Promise<PlatformUpdateActionResult> {
    if (this.state === 'downloaded') return { success: true }
    if (this.downloadPromise) return this.downloadPromise
    if (!this.updateInfo) return { success: false, error: '没有可下载的更新' }

    // 状态必须先切换，确保界面立即进入下载中状态。
    this.showWindowAfterDownload = showWindowAfterDownload
    this.state = 'downloading'
    this.callbacks.onDownloadStart({ version: this.updateInfo.version })
    this.downloadPromise = autoUpdater
      .downloadUpdate()
      .then(() => ({ success: true }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '下载更新失败'
        this.state = 'error'
        this.callbacks.onDownloadFailed(message)
        return { success: false, error: message }
      })
      .finally(() => {
        this.downloadPromise = null
      })
    return this.downloadPromise
  }

  /**
   * 下载当前更新并在下载完成后启动平台安装流程。
   * @returns 下载和安装启动结果。
   */
  public async downloadAndInstall(): Promise<PlatformUpdateActionResult> {
    const downloadResult = await this.downloadUpdate(false)
    if (!downloadResult.success) return downloadResult
    return this.installDownloadedUpdate()
  }

  /**
   * 退出应用并安装已下载的完整更新包。
   * @returns 安装流程是否成功启动。
   */
  public installDownloadedUpdate(): PlatformUpdateActionResult {
    if (this.state !== 'downloaded') return { success: false, error: '更新尚未下载完成' }

    // NSIS 需要显式保留当前安装目录，macOS 则交给 Squirrel.Mac 替换应用包。
    this.state = 'installing'
    this.callbacks.onBeforeInstall()
    if (process.platform === 'win32') {
      ;(autoUpdater as NsisUpdater).installDirectory = path.dirname(process.execPath)
    }
    autoUpdater.quitAndInstall(true, true)
    return { success: true }
  }

  /**
   * 获取当前更新下载状态。
   * @returns 供更新窗口展示的下载状态。
   */
  public getDownloadStatus(): PlatformDownloadStatus {
    return {
      hasDownloaded: this.state === 'downloaded',
      version: this.updateInfo?.version,
      changelog: this.updateInfo?.changelog,
      status: this.state
    }
  }
}
