import { describe, expect, it, vi } from 'vitest'
import {
  CNB_LATEST_RELEASE_URL,
  getCnbReleasePageUrl,
  parseCnbLatestReleaseLocation,
  resolveCnbLatestRelease
} from '../../src/main/updateSource'

describe('CNB update source', () => {
  it('builds latest and version-specific CNB Release page URLs', () => {
    expect(getCnbReleasePageUrl()).toBe(CNB_LATEST_RELEASE_URL)
    expect(getCnbReleasePageUrl('3.1.0-beta.2')).toBe(
      'https://cnb.cool/ZToolsCenter/ZTools/-/releases/tag/v3.1.0-beta.2'
    )
  })

  it('parses relative and absolute latest redirects', () => {
    expect(parseCnbLatestReleaseLocation('/ZToolsCenter/ZTools/-/releases/tag/v3.0.1')).toEqual({
      tag: 'v3.0.1',
      version: '3.0.1',
      downloadBaseUrl: 'https://cnb.cool/ZToolsCenter/ZTools/-/releases/download/v3.0.1',
      releaseUrl: 'https://cnb.cool/ZToolsCenter/ZTools/-/releases/tag/v3.0.1'
    })

    expect(
      parseCnbLatestReleaseLocation(
        'https://cnb.cool/ZToolsCenter/ZTools/-/releases/tag/v3.1.0-rc.2'
      ).version
    ).toBe('3.1.0-rc.2')
  })

  it('rejects redirects outside the expected repository and invalid tags', () => {
    expect(() => parseCnbLatestReleaseLocation('https://example.com/releases/tag/v3.0.1')).toThrow(
      '不受信任'
    )
    expect(() => parseCnbLatestReleaseLocation('/Other/ZTools/-/releases/tag/v3.0.1')).toThrow(
      '无法识别'
    )
    expect(() =>
      parseCnbLatestReleaseLocation('/ZToolsCenter/ZTools/-/releases/tag/latest')
    ).toThrow('无效的语义版本')
  })

  it('parses the redirect response returned by the Electron request adapter', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 307,
      location: 'https://cnb.cool/ZToolsCenter/ZTools/-/releases/tag/v3.0.1'
    })

    await expect(resolveCnbLatestRelease(request)).resolves.toMatchObject({
      tag: 'v3.0.1',
      version: '3.0.1'
    })
    expect(request).toHaveBeenCalledWith(CNB_LATEST_RELEASE_URL, 15_000)
  })

  it('rejects non-redirect responses and invalid redirect targets', async () => {
    await expect(
      resolveCnbLatestRelease(
        vi.fn().mockResolvedValue({
          status: 200,
          location: CNB_LATEST_RELEASE_URL
        })
      )
    ).rejects.toThrow('非重定向状态')

    await expect(
      resolveCnbLatestRelease(
        vi.fn().mockResolvedValue({
          status: 307,
          location: 'https://example.com/releases/tag/v3.0.1'
        })
      )
    ).rejects.toThrow('不受信任')
  })
})
