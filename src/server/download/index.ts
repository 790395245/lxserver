import * as path from 'path'
import { initDownloadManager, getDownloadManager } from './downloadManager'
import { initLocalMusicSource, getLocalMusicSource } from './localMusicSource'
import { initAutoDownloader, getAutoDownloader } from './autoDownloader'

export {
  getDownloadManager,
  getLocalMusicSource,
  getAutoDownloader,
}

export async function initDownloadModule() {
  const config = global.lx.config
  const musicDir = config['download.path'] || path.join(global.lx.dataPath, 'music')

  console.log('[Download] ========================================')
  console.log(`[Download] 初始化下载模块...`)
  console.log(`[Download] 音乐目录: ${musicDir}`)
  console.log(`[Download] 功能启用: ${config['download.enabled'] ? '是' : '否'}`)

  // 1. 初始化本地音乐源索引（无论下载是否启用，都要建索引供播放使用）
  await initLocalMusicSource(musicDir)

  // 2. 初始化下载管理器
  if (config['download.enabled']) {
    initDownloadManager()

    // 3. 初始化自动下载调度器
    initAutoDownloader()
  }

  console.log(`[Download] 初始化完成`)
  console.log('[Download] ========================================')
}
