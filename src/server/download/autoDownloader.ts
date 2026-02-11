import { getDownloadManager } from './downloadManager'
import { getLocalMusicSource } from './localMusicSource'

// ========== AutoDownloader ==========

export class AutoDownloader {
  private intervalTimer: NodeJS.Timeout | null = null
  private enabled: boolean
  private autoEnabled: boolean
  private autoInterval: number   // 分钟
  private autoUsers: string[]
  private autoPlaylists: string[]
  private listEventBound = false

  constructor() {
    const config = global.lx.config
    this.enabled = config['download.enabled'] || false
    this.autoEnabled = config['download.autoEnabled'] || false
    this.autoInterval = config['download.autoInterval'] || 60
    this.autoUsers = config['download.autoUsers'] || []
    this.autoPlaylists = config['download.autoPlaylists'] || []
  }

  // ========== 初始化 ==========

  init() {
    if (!this.enabled) {
      console.log('[AutoDownloader] 下载功能未启用')
      return
    }

    // 监听歌单变更事件
    this.bindListEvents()

    // 启动定时任务
    if (this.autoEnabled) {
      this.startAutoCheck()
    }

    console.log(`[AutoDownloader] 初始化完成 (auto=${this.autoEnabled}, interval=${this.autoInterval}min)`)
  }

  destroy() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer)
      this.intervalTimer = null
    }
  }

  // ========== 歌单变更监听 ==========

  private bindListEvents() {
    if (this.listEventBound || !global.event_list) return
    this.listEventBound = true

    // 监听歌曲添加事件
    global.event_list.on('list_music_add', async (userName: string, listId: string, musicInfos: LX.Music.MusicInfo[], _addMusicLocationType: string, _isRemote: boolean) => {
      if (!this.autoEnabled) return
      this.onMusicAdded(userName, listId, musicInfos)
    })

    // 监听歌单数据覆盖事件 (全量同步)
    global.event_list.on('list_data_overwrite', async (userName: string) => {
      if (!this.autoEnabled) return
      // 延迟扫描，等数据写入完成
      setTimeout(() => {
        this.scanUserPlaylists(userName).catch(err => {
          console.error(`[AutoDownloader] 扫描用户 ${userName} 歌单失败:`, err)
        })
      }, 5000)
    })

    console.log('[AutoDownloader] 歌单事件监听已绑定')
  }

  private onMusicAdded(userName: string, listId: string, musicInfos: LX.Music.MusicInfo[]) {
    // 检查用户是否在目标列表中
    if (this.autoUsers.length > 0 && !this.autoUsers.includes(userName)) return

    // 检查歌单是否在目标列表中
    if (this.autoPlaylists.length > 0 && !this.autoPlaylists.includes(listId)) return

    console.log(`[AutoDownloader] 检测到歌曲添加 (user=${userName}, list=${listId}, count=${musicInfos.length})`)

    const dm = getDownloadManager()
    const localSource = getLocalMusicSource()

    // 过滤掉已有本地文件的歌曲
    const songsToDownload = musicInfos
      .filter(info => {
        if (info.source === 'local') return false
        // 检查本地是否已有
        if (localSource) {
          const local = localSource.findLocalFile(info)
          if (local) return false
        }
        return true
      })
      .map(info => ({
        songId: (info.meta as any)?.songId?.toString() || info.id,
        name: info.name,
        singer: info.singer,
        source: info.source,
        songInfo: info,
      }))

    if (songsToDownload.length > 0) {
      const added = dm.addTasks(songsToDownload)
      console.log(`[AutoDownloader] 已添加 ${added.length} 首歌曲到下载队列`)
    }
  }

  // ========== 定时任务 ==========

  private startAutoCheck() {
    if (this.intervalTimer) return

    const intervalMs = this.autoInterval * 60 * 1000
    console.log(`[AutoDownloader] 启动定时检查 (间隔 ${this.autoInterval} 分钟)`)

    this.intervalTimer = setInterval(() => {
      this.runFullScan().catch(err => {
        console.error('[AutoDownloader] 定时扫描失败:', err)
      })
    }, intervalMs)

    // 首次启动延迟30秒执行一次扫描（等待系统完全启动）
    setTimeout(() => {
      this.runFullScan().catch(err => {
        console.error('[AutoDownloader] 首次扫描失败:', err)
      })
    }, 30000)
  }

  // ========== 全量扫描 ==========

  async runFullScan(): Promise<{ scanned: number; added: number }> {
    console.log('[AutoDownloader] 开始全量扫描...')
    const dm = getDownloadManager()
    const localSource = getLocalMusicSource()
    let scanned = 0
    let added = 0

    const users = global.lx.config.users
    const targetUsers = this.autoUsers.length > 0
      ? users.filter(u => this.autoUsers.includes(u.name))
      : users

    for (const user of targetUsers) {
      try {
        const result = await this.scanUserPlaylists(user.name)
        scanned += result.scanned
        added += result.added
      } catch (err: any) {
        console.error(`[AutoDownloader] 扫描用户 ${user.name} 失败:`, err.message)
      }
    }

    console.log(`[AutoDownloader] 全量扫描完成: 扫描 ${scanned} 首, 新增下载 ${added} 首`)
    return { scanned, added }
  }

  async scanUserPlaylists(userName: string): Promise<{ scanned: number; added: number }> {
    const dm = getDownloadManager()
    const localSource = getLocalMusicSource()

    // 获取用户空间
    let getUserSpace: any
    try {
      getUserSpace = require('@/user').getUserSpace
    } catch {
      console.error('[AutoDownloader] 无法加载用户模块')
      return { scanned: 0, added: 0 }
    }

    const userSpace = getUserSpace(userName)
    if (!userSpace) {
      return { scanned: 0, added: 0 }
    }

    const listDataManage = userSpace.listManage.listDataManage

    // 获取所有歌单
    const userLists = listDataManage.userLists || []
    const defaultListIds = ['default', 'love']
    const allListIds = [...defaultListIds, ...userLists.map((l: any) => l.id)]

    // 过滤目标歌单
    const targetListIds = this.autoPlaylists.length > 0
      ? allListIds.filter((id: string) => this.autoPlaylists.includes(id))
      : allListIds

    let scanned = 0
    let added = 0

    for (const listId of targetListIds) {
      try {
        const musics: LX.Music.MusicInfo[] = await listDataManage.getListMusics(listId)
        if (!musics || musics.length === 0) continue

        const songsToDownload = musics
          .filter(info => {
            scanned++
            if (info.source === 'local') return false
            if (localSource) {
              const local = localSource.findLocalFile(info)
              if (local) return false
            }
            // 也检查下载记录（可能正在下载或已完成）
            const songId = (info.meta as any)?.songId?.toString() || info.id
            const existing = dm.findLocalFile(info.source, songId)
            if (existing) return false
            return true
          })
          .map(info => ({
            songId: (info.meta as any)?.songId?.toString() || info.id,
            name: info.name,
            singer: info.singer,
            source: info.source,
            songInfo: info,
          }))

        if (songsToDownload.length > 0) {
          const result = dm.addTasks(songsToDownload)
          added += result.length
        }
      } catch (err: any) {
        console.error(`[AutoDownloader] 扫描歌单 ${listId} 失败:`, err.message)
      }
    }

    return { scanned, added }
  }

  // ========== 手动触发 ==========

  /**
   * 手动触发下载指定用户的指定歌单
   */
  async manualDownload(userName: string, listIds?: string[]): Promise<{ scanned: number; added: number }> {
    const originalPlaylists = this.autoPlaylists
    if (listIds && listIds.length > 0) {
      this.autoPlaylists = listIds
    } else {
      this.autoPlaylists = []
    }

    try {
      return await this.scanUserPlaylists(userName)
    } finally {
      this.autoPlaylists = originalPlaylists
    }
  }
}

// ========== 单例 ==========

let instance: AutoDownloader | null = null

export function getAutoDownloader(): AutoDownloader | null {
  return instance
}

export function initAutoDownloader(): AutoDownloader {
  instance = new AutoDownloader()
  instance.init()
  return instance
}
