export const CNB_RELEASES_URL = 'https://cnb.cool/ZToolsCenter/ZTools/-/releases'
export const CNB_LATEST_RELEASE_URL = `${CNB_RELEASES_URL}/latest`

const CNB_RELEASE_TAG_PATH_PREFIX = '/ZToolsCenter/ZTools/-/releases/tag/'
const CNB_RELEASE_TAG_PATTERN =
  /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/
const CNB_LATEST_RELEASE_TIMEOUT_MS = 15_000
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export interface CnbLatestRelease {
  tag: string
  version: string
  downloadBaseUrl: string
  releaseUrl: string
}

export interface UpdateSourceRedirectResponse {
  status: number
  location: string
}

export type UpdateSourceRequest = (
  url: string,
  timeoutMs: number
) => Promise<UpdateSourceRedirectResponse>

/**
 * 生成 CNB 指定版本的 Release 页面地址。
 * @param version 目标版本号，不包含前导 v；为空时返回最新正式版入口。
 * @returns CNB Release 页面地址。
 */
export function getCnbReleasePageUrl(version?: string): string {
  if (!version) return CNB_LATEST_RELEASE_URL
  return `${CNB_RELEASES_URL}/tag/v${encodeURIComponent(version)}`
}

/**
 * 解析 CNB latest 重定向后的最终地址并生成该正式版本的下载根地址。
 * @param location CNB latest 重定向后的绝对或相对 Release 地址。
 * @returns 经过来源、路径和版本格式校验的 CNB Release 信息。
 * @throws Location 缺失、来源不可信或 tag 不是受支持的语义版本时抛出错误。
 */
export function parseCnbLatestReleaseLocation(location: string): CnbLatestRelease {
  // 将相对重定向转换为绝对地址后限制协议与主机，避免跟随外部下载源。
  const releaseUrl = new URL(location, CNB_LATEST_RELEASE_URL)
  if (releaseUrl.protocol !== 'https:' || releaseUrl.host !== 'cnb.cool') {
    throw new Error(`CNB latest 返回了不受信任的 Release 地址: ${releaseUrl.href}`)
  }

  // 只接受当前仓库的 tag 页面，阻止其他 CNB 路径被当作更新源。
  if (!releaseUrl.pathname.startsWith(CNB_RELEASE_TAG_PATH_PREFIX)) {
    throw new Error(`CNB latest 返回了无法识别的 Release 地址: ${releaseUrl.href}`)
  }

  const encodedTag = releaseUrl.pathname.slice(CNB_RELEASE_TAG_PATH_PREFIX.length)
  if (!encodedTag || encodedTag.includes('/')) {
    throw new Error(`CNB latest 返回了无效的 Release tag: ${encodedTag || '(empty)'}`)
  }

  const tag = decodeURIComponent(encodedTag)
  const versionMatch = CNB_RELEASE_TAG_PATTERN.exec(tag)
  if (!versionMatch) throw new Error(`CNB latest 返回了无效的语义版本 tag: ${tag}`)

  return {
    tag,
    version: versionMatch[1],
    downloadBaseUrl: `${CNB_RELEASES_URL}/download/${encodeURIComponent(tag)}`,
    releaseUrl: releaseUrl.href
  }
}

/**
 * 请求 CNB 最新正式版入口并解析重定向后的最终地址。
 * @param request 执行 latest 请求的网络函数，生产环境传入 Electron net.fetch。
 * @param timeoutMs latest 请求的超时时间，单位为毫秒。
 * @returns 最新正式版 tag、版本号、Release 页面和下载根地址。
 * @throws 请求超时、重定向失败或最终地址无效时抛出错误。
 */
export async function resolveCnbLatestRelease(
  request: UpdateSourceRequest,
  timeoutMs = CNB_LATEST_RELEASE_TIMEOUT_MS
): Promise<CnbLatestRelease> {
  // 由 Electron 请求适配器捕获 redirect 事件，避免 Fetch manual 模式直接取消请求。
  const response = await request(CNB_LATEST_RELEASE_URL, timeoutMs)
  if (!REDIRECT_STATUSES.has(response.status)) {
    throw new Error(`CNB latest 返回了非重定向状态: HTTP ${response.status}`)
  }

  return parseCnbLatestReleaseLocation(response.location)
}
