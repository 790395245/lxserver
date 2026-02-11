/*!
 * @name LX Server 本地音乐源
 * @description 连接到 LX Music Sync Server，使用服务器上已下载的音乐
 * @version 1.0.0
 * @author lxmusic
 * @homepage https://github.com/lyswhut/lx-music-desktop
 */

// ========== 配置区域 ==========
// 用户需要修改以下配置
const SERVER_URL = 'http://localhost:9527'  // 服务器地址，请修改为实际地址
const SERVER_PASSWORD = '123456'            // 服务器密码，请修改为实际密码

// ========== 核心代码 ==========
const { EVENT_NAMES, request, on, send } = globalThis.lx

// HTTP 请求封装
const httpRequest = (url, options = {}) => {
  return new Promise((resolve, reject) => {
    const defaultOptions = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SERVER_PASSWORD}`,
        'User-Agent': 'LX-Music-Desktop'
      },
      ...options
    }

    request(url, defaultOptions, (err, resp) => {
      if (err) return reject(err)
      if (resp.statusCode !== 200) {
        return reject(new Error(`HTTP ${resp.statusCode}`))
      }

      try {
        const data = JSON.parse(resp.body)
        resolve(data)
      } catch (e) {
        reject(new Error('Invalid JSON response'))
      }
    })
  })
}

// 搜索音乐
const searchMusic = async (keyword, page = 1, limit = 30) => {
  const url = `${SERVER_URL}/api/local-music/search?keyword=${encodeURIComponent(keyword)}&page=${page}&limit=${limit}`
  const result = await httpRequest(url)
  return result.list || []
}

// 获取音乐 URL
const getMusicUrl = async (musicInfo, quality) => {
  const fileId = musicInfo.songmid
  return {
    url: `${SERVER_URL}/api/music/stream/${fileId}`,
    type: musicInfo._quality || quality || '128k'
  }
}

// 事件处理
on(EVENT_NAMES.request, async ({ action, source, info }) => {
  if (source !== 'local') {
    throw new Error('Unsupported source')
  }

  switch (action) {
    case 'musicUrl':
      return await getMusicUrl(info.musicInfo, info.type)

    case 'search':
      return await searchMusic(info.text, info.page, info.limit)

    default:
      throw new Error(`Unsupported action: ${action}`)
  }
})

// 注册源
send(EVENT_NAMES.inited, {
  sources: {
    local: {
      name: 'LX Server 本地音乐',
      type: 'music',
      actions: ['musicUrl', 'search'],
      qualitys: ['128k', '320k', 'flac', 'flac24bit']
    }
  }
})
