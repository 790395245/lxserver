import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

// ========== 类型定义 ==========

export interface LocalMusicEntry {
  fileId: string        // 唯一标识，用于流式传输URL
  filePath: string      // 绝对路径
  relativePath: string  // 相对于 musicDir
  source: string
  songId: string
  name: string
  singer: string
  quality: string
  fileSize: number
}

// ========== LocalMusicSource ==========

export class LocalMusicSource {
  private musicDir: string
  private indexBySongKey = new Map<string, LocalMusicEntry>()  // source:songId -> entry
  private indexByNameKey = new Map<string, LocalMusicEntry>()  // name:singer -> entry
  private indexByFileId = new Map<string, LocalMusicEntry>()   // fileId -> entry
  private fsWatcher: fs.FSWatcher | null = null
  private rebuildTimer: NodeJS.Timeout | null = null

  constructor(musicDir: string) {
    this.musicDir = musicDir

    if (!fs.existsSync(this.musicDir)) {
      fs.mkdirSync(this.musicDir, { recursive: true })
    }
  }

  // ========== 初始化 ==========

  async init() {
    await this.buildIndex()
    this.startWatcher()
    console.log(`[LocalMusicSource] 初始化完成, 索引 ${this.indexByFileId.size} 个文件`)
  }

  destroy() {
    if (this.fsWatcher) {
      this.fsWatcher.close()
      this.fsWatcher = null
    }
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer)
      this.rebuildTimer = null
    }
  }

  // ========== 索引构建 ==========

  private async buildIndex() {
    this.indexBySongKey.clear()
    this.indexByNameKey.clear()
    this.indexByFileId.clear()

    // 首先尝试从下载记录中构建索引（最准确）
    this.buildFromDownloadRecords()

    // 然后扫描目录补充未在记录中的文件
    this.scanDirectory(this.musicDir, '')
  }

  private buildFromDownloadRecords() {
    const recordsPath = path.join(this.musicDir, 'download_records.json')
    if (!fs.existsSync(recordsPath)) return

    try {
      const data = JSON.parse(fs.readFileSync(recordsPath, 'utf-8'))
      const records = data.records || []

      for (const record of records) {
        if (record.status !== 'completed' || !record.filePath) continue

        const fullPath = path.join(this.musicDir, record.filePath)
        if (!fs.existsSync(fullPath)) continue

        const fileId = this.generateFileId(record.filePath)
        const entry: LocalMusicEntry = {
          fileId,
          filePath: fullPath,
          relativePath: record.filePath,
          source: record.source || '',
          songId: record.songId || '',
          name: record.name || '',
          singer: record.singer || '',
          quality: record.quality || '',
          fileSize: record.fileSize || 0,
        }

        this.addToIndex(entry)
      }
    } catch (err) {
      console.error('[LocalMusicSource] 读取下载记录失败:', err)
    }
  }

  private scanDirectory(dirPath: string, relativeTo: string) {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name)
        const relPath = relativeTo ? path.join(relativeTo, entry.name) : entry.name

        if (entry.isDirectory()) {
          // 跳过隐藏目录
          if (entry.name.startsWith('.')) continue
          this.scanDirectory(fullPath, relPath)
        } else if (this.isAudioFile(entry.name)) {
          // 跳过已在记录索引中的文件
          const fileId = this.generateFileId(relPath)
          if (this.indexByFileId.has(fileId)) continue

          // 从路径解析信息: {source}/{singer}/{name}.{ext}
          const parsed = this.parseFilePath(relPath)
          const stat = fs.statSync(fullPath)

          const musicEntry: LocalMusicEntry = {
            fileId,
            filePath: fullPath,
            relativePath: relPath,
            source: parsed.source,
            songId: '',
            name: parsed.name,
            singer: parsed.singer,
            quality: parsed.quality,
            fileSize: stat.size,
          }

          this.addToIndex(musicEntry)
        }
      }
    } catch (err) {
      // 忽略无法读取的目录
    }
  }

  private addToIndex(entry: LocalMusicEntry) {
    this.indexByFileId.set(entry.fileId, entry)

    if (entry.source && entry.songId) {
      const songKey = `${entry.source}:${entry.songId}`
      this.indexBySongKey.set(songKey, entry)
    }

    if (entry.name && entry.singer) {
      const nameKey = `${entry.name}:${entry.singer}`.toLowerCase()
      this.indexByNameKey.set(nameKey, entry)
    }
  }

  // ========== 查询接口 ==========

  /**
   * 根据 source + songId 查找本地文件
   */
  findBySongId(source: string, songId: string): LocalMusicEntry | null {
    return this.indexBySongKey.get(`${source}:${songId}`) || null
  }

  /**
   * 根据 name + singer 查找本地文件
   */
  findByNameSinger(name: string, singer: string): LocalMusicEntry | null {
    return this.indexByNameKey.get(`${name}:${singer}`.toLowerCase()) || null
  }

  /**
   * 根据 fileId 查找本地文件
   */
  findByFileId(fileId: string): LocalMusicEntry | null {
    return this.indexByFileId.get(fileId) || null
  }

  /**
   * 综合查找：先按 songId 查，再按 name+singer 查
   */
  findLocalFile(songInfo: any): LocalMusicEntry | null {
    const source = songInfo.source || ''
    const songId = songInfo.songmid || songInfo.id || ''
    const name = songInfo.name || ''
    const singer = songInfo.singer || ''

    if (source && songId) {
      const entry = this.findBySongId(source, songId)
      if (entry) return entry
    }

    if (name && singer) {
      return this.findByNameSinger(name, singer)
    }

    return null
  }

  /**
   * 获取所有已索引的文件数
   */
  getIndexedCount(): number {
    return this.indexByFileId.size
  }

  /**
   * 获取所有已索引的文件列表
   */
  getAllEntries(): LocalMusicEntry[] {
    return Array.from(this.indexByFileId.values())
  }

  // ========== 文件监听 ==========

  private startWatcher() {
    try {
      this.fsWatcher = fs.watch(this.musicDir, { recursive: true }, (eventType, filename) => {
        if (!filename) return
        if (!this.isAudioFile(filename) && !filename.endsWith('download_records.json')) return

        // 防抖重建索引
        if (this.rebuildTimer) {
          clearTimeout(this.rebuildTimer)
        }
        this.rebuildTimer = setTimeout(() => {
          console.log('[LocalMusicSource] 检测到文件变更，重建索引...')
          this.buildIndex().catch(err => {
            console.error('[LocalMusicSource] 重建索引失败:', err)
          })
        }, 3000)
      })

      process.on('exit', () => {
        if (this.fsWatcher) this.fsWatcher.close()
      })
    } catch (err) {
      console.error('[LocalMusicSource] 启动文件监控失败:', err)
    }
  }

  // ========== 工具方法 ==========

  private isAudioFile(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase()
    return ['.mp3', '.flac', '.wav', '.ogg', '.aac', '.m4a', '.wma', '.ape'].includes(ext)
  }

  private generateFileId(relativePath: string): string {
    return crypto.createHash('md5').update(relativePath).digest('hex').substring(0, 16)
  }

  private parseFilePath(relativePath: string): { source: string; singer: string; name: string; quality: string } {
    const parts = relativePath.split(path.sep)
    const filename = parts[parts.length - 1]
    const ext = path.extname(filename).toLowerCase()
    const nameWithoutExt = path.basename(filename, ext)

    // 期望结构: {source}/{singer}/{name}.{ext}
    const source = parts.length >= 3 ? parts[0] : ''
    const singer = parts.length >= 3 ? parts[1] : (parts.length >= 2 ? parts[0] : '')

    let quality = ''
    if (ext === '.flac') quality = 'flac'
    else if (ext === '.mp3') quality = '320k' // 假设 mp3 为 320k
    else if (ext === '.wav') quality = 'flac'
    else quality = '128k'

    return { source, singer, name: nameWithoutExt, quality }
  }
}

// ========== 单例 ==========

let instance: LocalMusicSource | null = null

export function getLocalMusicSource(): LocalMusicSource | null {
  return instance
}

export async function initLocalMusicSource(musicDir: string): Promise<LocalMusicSource> {
  instance = new LocalMusicSource(musicDir)
  await instance.init()
  return instance
}
