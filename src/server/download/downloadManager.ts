import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
// @ts-ignore
import needle from 'needle'
import { callUserApiGetMusicUrl, isSourceSupported } from '../userApi'
// @ts-ignore
import musicSdkRaw from '@/modules/utils/musicSdk/index.js'
const musicSdk = musicSdkRaw as any

// ========== 类型定义 ==========

export type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled'

export interface DownloadRecord {
  id: string
  songId: string
  name: string
  singer: string
  source: string
  quality: string
  status: DownloadStatus
  filePath: string    // 相对于 musicDir 的路径
  fileSize: number
  downloadTime: number
  error: string | null
  retryCount: number
  progress: number     // 0-100
}

export interface DownloadTask {
  record: DownloadRecord
  abortController?: { abort: () => void }
  lastNotifyTime?: number
  lastNotifyProgress?: number
}

type ProgressListener = (data: {
  type: 'task_update' | 'task_added' | 'task_removed' | 'queue_status'
  task?: DownloadRecord
  queueSize?: number
  activeCount?: number
}) => void

// ========== 工具函数 ==========

const QUALITY_EXT_MAP: Record<string, string> = {
  'flac': '.flac',
  'flac24bit': '.flac',
  '320k': '.mp3',
  '128k': '.mp3',
}

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'unknown'
}

function generateId(): string {
  return crypto.randomBytes(8).toString('hex')
}

// ========== DownloadManager ==========

export class DownloadManager {
  private musicDir: string
  private recordsPath: string
  private records: DownloadRecord[] = []
  private queue: DownloadTask[] = []
  private activeDownloads = new Map<string, DownloadTask>()
  private concurrency: number
  private qualityPriority: string[]
  private progressListeners = new Set<ProgressListener>()
  private processing = false

  constructor() {
    const config = global.lx.config
    this.musicDir = config['download.path'] || path.join(global.lx.dataPath, 'music')
    this.concurrency = config['download.concurrency'] || 3
    this.qualityPriority = config['download.qualityPriority'] || ['flac', '320k', '128k']
    this.recordsPath = path.join(this.musicDir, 'download_records.json')

    // 确保目录存在
    if (!fs.existsSync(this.musicDir)) {
      fs.mkdirSync(this.musicDir, { recursive: true })
    }

    // 加载已有记录
    this.loadRecords()
  }

  getMusicDir(): string {
    return this.musicDir
  }

  // ========== 记录持久化 ==========

  private loadRecords() {
    try {
      if (fs.existsSync(this.recordsPath)) {
        const data = JSON.parse(fs.readFileSync(this.recordsPath, 'utf-8'))
        this.records = data.records || []
        // 重启后将 downloading 状态重置为 pending
        for (const r of this.records) {
          if (r.status === 'downloading') {
            r.status = 'pending'
          }
        }
      }
    } catch (err) {
      console.error('[DownloadManager] 加载下载记录失败:', err)
      this.records = []
    }
  }

  private saveRecords() {
    try {
      fs.writeFileSync(this.recordsPath, JSON.stringify({ records: this.records }, null, 2))
    } catch (err) {
      console.error('[DownloadManager] 保存下载记录失败:', err)
    }
  }

  // ========== 进度通知 ==========

  onProgress(listener: ProgressListener) {
    this.progressListeners.add(listener)
    return () => { this.progressListeners.delete(listener) }
  }

  private notifyProgress(data: Parameters<ProgressListener>[0]) {
    for (const listener of this.progressListeners) {
      try { listener(data) } catch {}
    }
  }

  // ========== 公开 API ==========

  getRecords(): DownloadRecord[] {
    return [...this.records]
  }

  getActiveCount(): number {
    return this.activeDownloads.size
  }

  getQueueSize(): number {
    return this.queue.length
  }

  /**
   * 添加下载任务
   * 返回已添加的记录（去重：同 source+songId 不重复添加）
   */
  addTasks(songs: Array<{
    songId: string
    name: string
    singer: string
    source: string
    songInfo: any   // 完整 songInfo 用于获取URL
  }>): DownloadRecord[] {
    const added: DownloadRecord[] = []

    for (const song of songs) {
      // 去重检查
      const existing = this.records.find(r =>
        r.source === song.source &&
        r.songId === song.songId &&
        (r.status === 'completed' || r.status === 'downloading' || r.status === 'pending')
      )
      if (existing) continue

      const record: DownloadRecord = {
        id: generateId(),
        songId: song.songId,
        name: song.name,
        singer: song.singer,
        source: song.source,
        quality: '',
        status: 'pending',
        filePath: '',
        fileSize: 0,
        downloadTime: 0,
        error: null,
        retryCount: 0,
        progress: 0,
      }

      this.records.push(record)
      const task: DownloadTask = { record }
      // 存储 songInfo 到 task 上，供下载时使用
      ;(task as any).songInfo = song.songInfo
      this.queue.push(task)
      added.push(record)

      this.notifyProgress({ type: 'task_added', task: record })
    }

    if (added.length > 0) {
      this.saveRecords()
      this.processQueue()
    }

    return added
  }

  /**
   * 重试失败任务
   */
  retryTask(taskId: string): boolean {
    const record = this.records.find(r => r.id === taskId && r.status === 'failed')
    if (!record) return false

    record.status = 'pending'
    record.error = null
    record.retryCount = 0
    record.progress = 0

    const task: DownloadTask = { record }
    this.queue.push(task)
    this.saveRecords()
    this.processQueue()

    this.notifyProgress({ type: 'task_update', task: record })
    return true
  }

  /**
   * 取消任务
   */
  cancelTask(taskId: string): boolean {
    // 从队列移除
    const queueIdx = this.queue.findIndex(t => t.record.id === taskId)
    if (queueIdx !== -1) {
      const task = this.queue.splice(queueIdx, 1)[0]
      task.record.status = 'cancelled'
      this.saveRecords()
      this.notifyProgress({ type: 'task_update', task: task.record })
      return true
    }

    // 取消进行中的下载
    const activeTask = this.activeDownloads.get(taskId)
    if (activeTask) {
      activeTask.record.status = 'cancelled'
      activeTask.abortController?.abort()
      this.activeDownloads.delete(taskId)
      this.saveRecords()
      this.notifyProgress({ type: 'task_update', task: activeTask.record })
      this.processQueue()
      return true
    }

    return false
  }

  /**
   * 清理已完成/失败/取消的记录
   */
  cleanRecords(statuses: DownloadStatus[] = ['completed', 'failed', 'cancelled']): number {
    const before = this.records.length
    this.records = this.records.filter(r => !statuses.includes(r.status))
    const removed = before - this.records.length
    if (removed > 0) this.saveRecords()
    return removed
  }

  /**
   * 查找歌曲的本地文件路径（绝对路径）
   */
  findLocalFile(source: string, songId: string): string | null {
    const record = this.records.find(r =>
      r.source === source && r.songId === songId && r.status === 'completed' && r.filePath
    )
    if (!record) return null
    const fullPath = path.join(this.musicDir, record.filePath)
    return fs.existsSync(fullPath) ? fullPath : null
  }

  /**
   * 通过 name+singer 查找本地文件
   */
  findLocalFileByInfo(name: string, singer: string): string | null {
    const record = this.records.find(r =>
      r.name === name && r.singer === singer && r.status === 'completed' && r.filePath
    )
    if (!record) return null
    const fullPath = path.join(this.musicDir, record.filePath)
    return fs.existsSync(fullPath) ? fullPath : null
  }

  // ========== 内部下载逻辑 ==========

  private async processQueue() {
    if (this.processing) return
    this.processing = true

    while (this.queue.length > 0 && this.activeDownloads.size < this.concurrency) {
      const task = this.queue.shift()
      if (!task) break

      this.activeDownloads.set(task.record.id, task)
      this.downloadTask(task).catch(err => {
        console.error(`[DownloadManager] 下载异常:`, err)
      }).finally(() => {
        this.activeDownloads.delete(task.record.id)
        this.saveRecords()
        this.notifyProgress({
          type: 'queue_status',
          queueSize: this.queue.length,
          activeCount: this.activeDownloads.size,
        })
        // 继续处理队列
        if (this.queue.length > 0 && this.activeDownloads.size < this.concurrency) {
          this.processing = false
          this.processQueue()
        }
      })
    }

    this.processing = false
  }

  private async downloadTask(task: DownloadTask): Promise<void> {
    const { record } = task
    const songInfo = (task as any).songInfo

    record.status = 'downloading'
    record.progress = 0
    this.notifyProgress({ type: 'task_update', task: record })

    let url: string | null = null
    let quality = ''

    // 按音质优先级尝试获取URL
    for (const q of this.qualityPriority) {
      try {
        const result = await this.getMusicUrl(record.source, songInfo, q)
        if (result && result.url) {
          url = result.url
          quality = result.type || q
          break
        }
      } catch (err: any) {
        console.log(`[DownloadManager] ${record.name} - ${q} 获取URL失败: ${err.message}`)
      }
    }

    if (!url) {
      record.status = 'failed'
      record.error = '所有音质均获取URL失败'
      this.notifyProgress({ type: 'task_update', task: record })
      return
    }

    record.quality = quality

    // 构造文件路径
    const ext = QUALITY_EXT_MAP[quality] || '.mp3'
    const singerDir = sanitizeFilename(record.singer || 'Unknown')
    const fileName = sanitizeFilename(record.name) + ext
    const relativePath = path.join(record.source, singerDir, fileName)
    const fullPath = path.join(this.musicDir, relativePath)

    // 确保目录存在
    const dir = path.dirname(fullPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    // 下载文件
    try {
      await this.downloadFile(url, fullPath, task)
      record.filePath = relativePath
      record.status = 'completed'
      record.downloadTime = Date.now()
      record.progress = 100

      const stat = fs.statSync(fullPath)
      record.fileSize = stat.size

      console.log(`[DownloadManager] ✓ ${record.name} - ${record.singer} [${quality}] 下载完成 (${(record.fileSize / 1024 / 1024).toFixed(1)}MB)`)
    } catch (err: any) {
      // 如果是取消操作，直接返回（status已在cancelTask中设置）
      if (err.message === '已取消') return

      record.status = 'failed'
      record.error = err.message || '下载失败'
      record.retryCount++
      console.error(`[DownloadManager] ✗ ${record.name} 下载失败: ${err.message}`)

      // 自动重试（最多3次）
      if (record.retryCount < 3) {
        record.status = 'pending'
        record.error = null
        this.queue.push(task)
      }
    }

    this.notifyProgress({ type: 'task_update', task: record })
  }

  private async getMusicUrl(source: string, songInfo: any, quality: string): Promise<{ url: string, type: string }> {
    // 优先自定义源
    if (isSourceSupported(source)) {
      try {
        return await callUserApiGetMusicUrl(source, songInfo, quality)
      } catch {
        // 回退到内置SDK
      }
    }

    // 内置 musicSdk
    if (musicSdk[source] && musicSdk[source].getMusicUrl) {
      const result = await musicSdk[source].getMusicUrl(songInfo, quality)
      if (result && result.url) return result
    }

    throw new Error(`无法获取 ${source} 平台的音乐URL`)
  }

  private downloadFile(url: string, destPath: string, task: DownloadTask): Promise<void> {
    return new Promise((resolve, reject) => {
      const options: any = {
        follow_max: 5,
        response_timeout: 30000,
        read_timeout: 300000, // 5分钟读取超时
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      }

      try {
        options.headers['Referer'] = new URL(url).origin
      } catch {}

      const stream = needle.get(url, options)
      const writeStream = fs.createWriteStream(destPath)
      let totalBytes = 0
      let receivedBytes = 0
      let aborted = false

      // 注册取消控制器
      task.abortController = {
        abort: () => {
          aborted = true
          stream.destroy()
          writeStream.destroy()
          // 清理不完整文件
          try { fs.unlinkSync(destPath) } catch {}
        }
      }

      stream.on('response', (resp: any) => {
        if (resp.statusCode >= 400) {
          reject(new Error(`HTTP ${resp.statusCode}`))
          return
        }
        totalBytes = parseInt(resp.headers['content-length'] || '0', 10)
      })

      stream.on('data', (chunk: Buffer) => {
        if (aborted) return
        receivedBytes += chunk.length
        writeStream.write(chunk)

        if (totalBytes > 0) {
          task.record.progress = Math.round((receivedBytes / totalBytes) * 100)

          // 时间节流：每秒最多通知一次
          const now = Date.now()
          const timePassed = now - (task.lastNotifyTime || 0) >= 1000
          const progressChanged = task.record.progress !== (task.lastNotifyProgress || 0)

          if (progressChanged && timePassed) {
            task.lastNotifyTime = now
            task.lastNotifyProgress = task.record.progress
            this.notifyProgress({ type: 'task_update', task: task.record })
          }
        }
      })

      stream.on('done', (err: any) => {
        writeStream.end()
        if (aborted) {
          reject(new Error('已取消'))
        } else if (err) {
          try { fs.unlinkSync(destPath) } catch {}
          reject(err)
        } else {
          resolve()
        }
      })

      stream.on('error', (err: any) => {
        writeStream.destroy()
        try { fs.unlinkSync(destPath) } catch {}
        reject(err)
      })
    })
  }
}

// 单例
let instance: DownloadManager | null = null

export function getDownloadManager(): DownloadManager {
  if (!instance) {
    instance = new DownloadManager()
  }
  return instance
}

export function initDownloadManager(): DownloadManager {
  instance = new DownloadManager()
  console.log(`[DownloadManager] 初始化完成, 音乐目录: ${instance.getMusicDir()}`)
  return instance
}
