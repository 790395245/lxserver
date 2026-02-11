declare namespace LX {
  type AddMusicLocationType = 'top' | 'bottom'

  interface User {
    /**
     * 用户名
     */
    name: string

    /**
     * 连接密码
     */
    password: string

    /**
     * 最大备份快照数
     */
    maxSnapshotNum?: number

    /**
     * 添加歌曲到我的列表时的方式
     */
    'list.addMusicLocationType'?: AddMusicLocationType
  }

  interface UserConfig extends User {
    dataPath: string
  }

  interface Config {
    /**
     * 同步服务名称
     */
    'serverName': string

    /**
     * 是否使用代理转发请求到本服务器
     */
    'proxy.enabled': boolean

    /**
     * 代理转发的请求头 原始IP
     */
    'proxy.header': string

    /**
     * 绑定IP
     */
    bindIP: string

    /**
     * 端口
     */
    port: number

    /**
     * 是否开启用户路径 /<userName>
     */

    /**
     * 是否开启用户路径 /<userName>
     */
    'user.enablePath'?: boolean

    /**
     * 是否开启根路径 /
     */
    'user.enableRoot'?: boolean

    /**
     * 公共最大备份快照数
     */
    maxSnapshotNum: number

    /**
     * 公共添加歌曲到我的列表时的方式 top | bottom，参考客户端的设置-列表设置-添加歌曲到我的列表时的方式
     */
    'list.addMusicLocationType': AddMusicLocationType

    /**
     * 同步用户
     */
    users: UserConfig[]

    /**
     * 前端访问密码
     */
    'frontend.password'?: string

    /**
     * WebDAV URL
     */
    'webdav.url'?: string

    /**
     * WebDAV 用户名
     */
    'webdav.username'?: string

    /**
     * WebDAV 密码
     */
    'webdav.password'?: string

    /**
     * 同步间隔(分钟)
     */
    'sync.interval'?: number

    /**
     * 是否开启Web播放器访问密码
     */
    'player.enableAuth'?: boolean

    /**
     * Web播放器访问密码
     */
    'player.password'?: string

    /**
     * 是否禁用数据收集
     */
    disableTelemetry?: boolean

    // ========== 音乐下载配置 ==========

    /**
     * 是否启用下载功能
     */
    'download.enabled'?: boolean

    /**
     * 自定义下载路径，空则使用 data/music/
     */
    'download.path'?: string

    /**
     * 音质优先级列表
     */
    'download.qualityPriority'?: string[]

    /**
     * 并发下载数
     */
    'download.concurrency'?: number

    /**
     * 是否启用自动下载
     */
    'download.autoEnabled'?: boolean

    /**
     * 自动下载检查间隔（分钟）
     */
    'download.autoInterval'?: number

    /**
     * 自动下载的目标用户列表（空=全部）
     */
    'download.autoUsers'?: string[]

    /**
     * 自动下载的目标歌单ID列表（空=全部）
     */
    'download.autoPlaylists'?: string[]
  }
}

