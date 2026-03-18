/**
 * @name LX Server 音乐源代理
 * @description 通过服务器统一管理和使用所有自定义音乐源
 * @version 1.0.0
 * @author LX Server
 * @homepage https://github.com/lxmusics/lx-music-sync-server
 */

// ========== 配置区域 ==========
// 请修改以下配置为您的服务器信息
const SERVER_URL = '{{SERVER_URL}}'  // 服务器地址，如: http://192.168.1.100:9527
const SERVER_PASSWORD = '{{SERVER_PASSWORD}}'  // 服务器密码

// ========== 核心代码 ==========
const { EVENT_NAMES, request, on, send, utils } = globalThis.lx

// 支持的平台和音质
const SOURCES = {
  kw: { name: '酷我音乐(代理)', qualitys: ['128k', '320k', 'flac'] },
  kg: { name: '酷狗音乐(代理)', qualitys: ['128k', '320k', 'flac'] },
  tx: { name: 'QQ音乐(代理)', qualitys: ['128k', '320k', 'flac', 'flac24bit'] },
  wy: { name: '网易云音乐(代理)', qualitys: ['128k', '320k', 'flac'] },
  mg: { name: '咪咕音乐(代理)', qualitys: ['128k', '320k', 'flac'] }
}

// HTTP请求封装
const httpRequest = (url, options) => new Promise((resolve, reject) => {
  request(url, options, (err, resp) => {
    if (err) return reject(err)
    if (resp.statusCode !== 200) {
      return reject(new Error(`HTTP ${resp.statusCode}: ${resp.body}`))
    }
    try {
      const data = JSON.parse(resp.body)
      if (data.error) {
        return reject(new Error(data.error))
      }
      resolve(data)
    } catch (e) {
      reject(new Error('Invalid JSON response'))
    }
  })
})

// 调用服务器代理API
async function callProxyAPI(action, source, params) {
  const url = `${SERVER_URL}/api/proxy/${action}`
  const options = {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVER_PASSWORD}`
    },
    body: JSON.stringify({ source, ...params })
  }

  return httpRequest(url, options)
}

// 注册所有支持的平台
const sources = {}
for (const [key, info] of Object.entries(SOURCES)) {
  sources[key] = {
    name: info.name,
    type: 'music',
    actions: ['musicUrl', 'search', 'lyric', 'pic'],
    qualitys: info.qualitys
  }
}

send(EVENT_NAMES.inited, { sources })

// 处理请求
on(EVENT_NAMES.request, async (params) => {
  const { action, source, info } = params

  try {
    switch (action) {
      case 'musicUrl': {
        const { musicInfo, type } = info
        const result = await callProxyAPI('musicUrl', source, {
          songInfo: musicInfo,
          quality: type
        })
        return result.url
      }

      case 'search': {
        const { text, page, limit } = info
        const result = await callProxyAPI('search', source, {
          keyword: text,
          page: page || 1
        })
        return result
      }

      case 'lyric': {
        const { musicInfo } = info
        const result = await callProxyAPI('lyric', source, {
          songInfo: musicInfo
        })
        return result
      }

      case 'pic': {
        const { musicInfo } = info
        const result = await callProxyAPI('pic', source, {
          songInfo: musicInfo
        })
        return result.url || result.pic
      }

      default:
        throw new Error(`Unsupported action: ${action}`)
    }
  } catch (error) {
    console.error(`[LX Proxy] ${action} failed:`, error.message)
    throw error
  }
})
