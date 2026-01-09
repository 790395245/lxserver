import fs from 'fs'
import path from 'path'
import archiver from 'archiver'
import { Extract } from 'unzipper'
import crypto from 'crypto'
import { EventEmitter } from 'events'

interface WebDAVConfig {
    url: string
    username: string
    password: string
    interval?: number
}

interface SyncLog {
    timestamp: number
    type: 'upload' | 'download' | 'backup' | 'restore'
    file: string
    status: 'success' | 'error'
    message?: string
}

class WebDAVSync extends EventEmitter {
    private config: WebDAVConfig
    private dataPath: string
    private syncInterval: number
    private watchInterval: number = 60000 // 1分钟检查一次文件变化
    private backupInterval: number = 24 * 60 * 60 * 1000 // 24小时
    private watchTimer: NodeJS.Timeout | null = null
    private backupTimer: NodeJS.Timeout | null = null
    private filesHash: Map<string, string> = new Map()
    private syncLogs: SyncLog[] = []
    private client: any = null

    constructor(config: WebDAVConfig, dataPath: string) {
        super()
        this.config = {
            url: config.url || '',
            username: config.username || '',
            password: config.password || '',
        }
        this.syncInterval = (config.interval || 60) * 60 * 1000
        this.dataPath = dataPath
    }

    async initClient() {
        if (!this.isConfigured()) return false

        try {
            // 动态导入 webdav ESM 模块
            const { createClient } = await import('webdav')
            this.client = createClient(this.config.url, {
                username: this.config.username,
                password: this.config.password,
            })
            console.log('WebDAV client initialized')
            return true
        } catch (err) {
            console.error('Failed to initialize WebDAV client:', err)
            return false
        }
    }

    isConfigured(): boolean {
        return !!(this.config.url && this.config.username && this.config.password)
    }

    private addLog(log: SyncLog) {
        this.syncLogs.unshift(log)
        if (this.syncLogs.length > 100) {
            this.syncLogs = this.syncLogs.slice(0, 100)
        }
    }

    getSyncLogs(): SyncLog[] {
        return this.syncLogs
    }

    private getFileHash(filePath: string): string {
        try {
            const buffer = fs.readFileSync(filePath)
            const hash = crypto.createHash('md5')
            hash.update(buffer as any)
            return hash.digest('hex')
        } catch {
            return ''
        }
    }

    private async scanFiles(): Promise<Map<string, string>> {
        const files = new Map<string, string>()
        const scanDir = (dir: string) => {
            const items = fs.readdirSync(dir)
            for (const item of items) {
                const fullPath = path.join(dir, item)
                const stat = fs.statSync(fullPath)
                if (stat.isDirectory()) {
                    scanDir(fullPath)
                } else {
                    const relativePath = path.relative(this.dataPath, fullPath)
                    if (!relativePath.includes('temp-') && !relativePath.endsWith('.log')) {
                        files.set(relativePath, this.getFileHash(fullPath))
                    }
                }
            }
        }
        scanDir(this.dataPath)
        return files
    }

    private async getChangedFiles(): Promise<string[]> {
        const currentFiles = await this.scanFiles()
        const changed: string[] = []

        // 检查新增和修改的文件
        for (const [file, hash] of currentFiles) {
            if (!this.filesHash.has(file) || this.filesHash.get(file) !== hash) {
                changed.push(file)
            }
        }

        this.filesHash = currentFiles
        return changed
    }

    async uploadFile(relativePath: string): Promise<boolean> {
        if (!this.client) await this.initClient()
        if (!this.client) return false

        try {
            const localPath = path.join(this.dataPath, relativePath)
            const stat = fs.statSync(localPath)
            const remotePath = `/lx-sync/${relativePath.replace(/\\/g, '/')}`

            // 确保远程目录存在
            const remoteDir = path.dirname(remotePath)
            await this.client.createDirectory(remoteDir, { recursive: true })

            const content = fs.readFileSync(localPath)

            this.emit('progress', {
                type: 'file',
                status: 'uploading',
                file: relativePath,
                current: 0,
                total: stat.size
            })

            await this.client.putFileContents(remotePath, content)

            this.emit('progress', {
                type: 'file',
                status: 'success',
                file: relativePath,
                current: stat.size,
                total: stat.size
            })

            this.addLog({
                timestamp: Date.now(),
                type: 'upload',
                file: relativePath,
                status: 'success',
            })
            return true
        } catch (err: any) {
            this.emit('progress', {
                type: 'file',
                status: 'error',
                file: relativePath,
                error: err.message
            })
            this.addLog({
                timestamp: Date.now(),
                type: 'upload',
                file: relativePath,
                status: 'error',
                message: err.message,
            })
            return false
        }
    }

    async downloadFile(relativePath: string): Promise<boolean> {
        if (!this.client) await this.initClient()
        if (!this.client) return false

        try {
            const remotePath = `/lx-sync/${relativePath.replace(/\\/g, '/')}`
            const content = await this.client.getFileContents(remotePath)
            const localPath = path.join(this.dataPath, relativePath)

            // 确保本地目录存在
            const localDir = path.dirname(localPath)
            if (!fs.existsSync(localDir)) {
                fs.mkdirSync(localDir, { recursive: true })
            }

            fs.writeFileSync(localPath, content as any)

            this.addLog({
                timestamp: Date.now(),
                type: 'download',
                file: relativePath,
                status: 'success',
            })
            return true
        } catch (err: any) {
            this.addLog({
                timestamp: Date.now(),
                type: 'download',
                file: relativePath,
                status: 'error',
                message: err.message,
            })
            return false
        }
    }

    async createBackup(): Promise<string | null> {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
            const zipName = `lx-sync-backup-${timestamp}.zip`
            const zipPath = path.join(this.dataPath, zipName)

            await new Promise<void>((resolve, reject) => {
                const output = fs.createWriteStream(zipPath)
                const archive = archiver('zip', { zlib: { level: 9 } })

                let fileCount = 0

                // 监听文件添加事件
                archive.on('entry', (entry: any) => {
                    fileCount++
                    this.emit('progress', {
                        type: 'backup',
                        status: 'packing',
                        message: `正在打包文件: ${entry.name}`,
                        current: fileCount
                    })
                })

                output.on('close', () => resolve())
                archive.on('error', (err) => reject(err))

                archive.pipe(output)
                archive.glob('**/*', {
                    cwd: this.dataPath,
                    ignore: ['temp-*.zip', '*.log', 'lx-sync-backup-*.zip'],
                })
                archive.finalize()
            })

            return zipName
        } catch (err) {
            console.error('Failed to create backup:', err)
            return null
        }
    }

    async uploadBackup(force = false): Promise<boolean> {
        if (!this.client) await this.initClient()
        if (!this.client) return false

        try {
            // 检查是否有文件变化
            if (!force) {
                const changed = await this.getChangedFiles()
                if (changed.length === 0) {
                    console.log('No changes detected, skipping backup')
                    return true
                }
            }

            this.emit('progress', { type: 'backup', status: 'preparing', message: '正在创建备份...' })

            const zipName = await this.createBackup()
            if (!zipName) return false

            const zipPath = path.join(this.dataPath, zipName)
            const stat = fs.statSync(zipPath)
            const content = fs.readFileSync(zipPath)
            const remotePath = `/lx-sync-backups/${zipName}`

            this.emit('progress', {
                type: 'backup',
                status: 'uploading',
                file: zipName,
                total: stat.size,
                current: 0
            })

            await this.client.putFileContents(remotePath, content)

            this.emit('progress', {
                type: 'backup',
                status: 'success',
                file: zipName,
                total: stat.size,
                current: stat.size
            })

            // 清理本地zip
            fs.unlinkSync(zipPath)

            // 清理旧备份（保留最近5个）
            await this.cleanOldBackups()

            this.addLog({
                timestamp: Date.now(),
                type: 'backup',
                file: zipName,
                status: 'success',
            })

            return true
        } catch (err: any) {
            this.emit('progress', { type: 'backup', status: 'error', error: err.message })
            this.addLog({
                timestamp: Date.now(),
                type: 'backup',
                file: 'backup',
                status: 'error',
                message: err.message,
            })
            return false
        }
    }

    async syncAllFiles(): Promise<boolean> {
        if (!this.client) await this.initClient()
        if (!this.client) return false

        try {
            const files = await this.scanFiles()
            const fileList = Array.from(files.keys())
            let count = 0
            const total = fileList.length

            this.emit('progress', { type: 'sync', status: 'start', total })

            for (const file of fileList) {
                count++
                this.emit('progress', {
                    type: 'sync',
                    status: 'processing',
                    current: count,
                    total,
                    file
                })
                await this.uploadFile(file)
            }

            this.emit('progress', { type: 'sync', status: 'finish', total })
            return true
        } catch (err) {
            console.error('Sync all files failed:', err)
            return false
        }
    }

    async cleanOldBackups() {
        if (!this.client) return

        try {
            const items = await this.client.getDirectoryContents('/lx-sync-backups/')
            const backups = items
                .filter((item: any) => item.basename.startsWith('lx-sync-backup-'))
                .sort((a: any, b: any) => b.lastmod.localeCompare(a.lastmod))

            // 删除第6个及以后的备份
            for (let i = 5; i < backups.length; i++) {
                await this.client.deleteFile(backups[i].filename)
            }
        } catch (err) {
            console.error('Failed to clean old backups:', err)
        }
    }

    async downloadLatestBackup(): Promise<boolean> {
        if (!this.client) await this.initClient()
        if (!this.client) return false

        try {
            this.emit('progress', { type: 'restore', status: 'start', message: '正在获取备份列表...' })

            const items = await this.client.getDirectoryContents('/lx-sync-backups/')
            const backups = items
                .filter((item: any) => item.basename.startsWith('lx-sync-backup-'))
                .sort((a: any, b: any) => b.lastmod.localeCompare(a.lastmod))

            if (backups.length === 0) return false

            const latestBackup = backups[0]

            this.emit('progress', {
                type: 'restore',
                status: 'downloading',
                message: `正在下载备份: ${latestBackup.basename}`
            })

            const content = await this.client.getFileContents(latestBackup.filename)
            const zipPath = path.join(this.dataPath, 'temp-restore.zip')

            // 修复类型错误：使用 as any
            fs.writeFileSync(zipPath, content as any)

            this.emit('progress', {
                type: 'restore',
                status: 'extracting',
                message: '正在解压备份文件...'
            })

            await this.extractZip(zipPath, this.dataPath)
            fs.unlinkSync(zipPath)

            this.addLog({
                timestamp: Date.now(),
                type: 'restore',
                file: latestBackup.basename,
                status: 'success',
            })

            return true
        } catch (err: any) {
            this.addLog({
                timestamp: Date.now(),
                type: 'restore',
                file: 'latest-backup',
                status: 'error',
                message: err.message,
            })
            return false
        }
    }

    private async extractZip(zipPath: string, targetPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            fs.createReadStream(zipPath)
                .pipe(Extract({ path: targetPath }))
                .on('close', () => resolve())
                .on('error', (err) => reject(err))
        })
    }

    async syncChangedFiles() {
        const changed = await this.getChangedFiles()
        if (changed.length === 0) return

        console.log(`Syncing ${changed.length} changed files...`)
        for (const file of changed) {
            await this.uploadFile(file)
        }
    }

    async restoreFromRemote() {
        if (!this.client) await this.initClient()
        if (!this.client) return false

        // 1. 尝试恢复散文件
        try {
            const items = await this.client.getDirectoryContents('/lx-sync/', { deep: true })
            const files = items.filter((item: any) => item.type === 'file')

            if (files.length > 0) {
                console.log(`Restoring ${files.length} files from WebDAV...`)
                const total = files.length
                let current = 0

                this.emit('progress', { type: 'restore', status: 'start', total, message: '开始从云端恢复数据...' })

                for (const file of files) {
                    current++
                    const relativePath = file.filename.replace('/lx-sync/', '')

                    this.emit('progress', {
                        type: 'restore',
                        status: 'processing',
                        current,
                        total,
                        file: relativePath,
                        message: `正在恢复文件 (${current}/${total})`
                    })

                    await this.downloadFile(relativePath)
                }

                this.emit('progress', { type: 'restore', status: 'finish', total, message: '数据恢复完成' })
                return true
            }
        } catch (err: any) {
            // 忽略 /lx-sync/ 不存在的错误，继续尝试恢复备份
            console.log('Scattered files not found or error, trying backup...', err.message)
        }

        // 2. 尝试恢复备份
        try {
            console.log('Downloading latest backup...')
            this.emit('progress', { type: 'restore', status: 'start', message: '正在从云端下载备份...' })
            const result = await this.downloadLatestBackup()
            if (result) {
                this.emit('progress', { type: 'restore', status: 'finish', message: '备份恢复完成' })
            } else {
                this.emit('progress', { type: 'restore', status: 'error', message: '未找到可用备份' })
            }
            return result
        } catch (err: any) {
            console.error('Failed to restore from remote:', err)
            this.emit('progress', { type: 'restore', status: 'error', message: '恢复失败: ' + err.message })
            return false
        }
    }

    async testConnection(): Promise<{ success: boolean; message: string }> {
        // 检查配置是否完整
        if (!this.isConfigured()) {
            const missing = [];
            if (!this.config.url) missing.push('WebDAV URL');
            if (!this.config.username) missing.push('用户名');
            if (!this.config.password) missing.push('密码');
            return {
                success: false,
                message: `请先在系统配置中填写: ${missing.join('、')}`
            };
        }

        try {
            const initialized = await this.initClient();
            if (!initialized || !this.client) {
                return { success: false, message: 'WebDAV客户端初始化失败，请检查配置是否正确' };
            }

            await this.client.getDirectoryContents('/');
            return { success: true, message: '连接成功！WebDAV配置正确' };
        } catch (err: any) {
            let errorMsg = '连接失败';
            if (err.message) {
                if (err.message.includes('401')) {
                    errorMsg = '认证失败，请检查用户名和密码';
                } else if (err.message.includes('404')) {
                    errorMsg = 'WebDAV路径不存在，请检查URL';
                } else if (err.message.includes('ENOTFOUND') || err.message.includes('ECONNREFUSED')) {
                    errorMsg = '无法连接到服务器，请检查URL和网络';
                } else {
                    errorMsg = err.message;
                }
            }
            return { success: false, message: errorMsg };
        }
    }

    startAutoSync() {
        if (!this.isConfigured()) return

        console.log('Starting auto file change detection...')

        // 初始化文件哈希
        void this.scanFiles().then(files => {
            this.filesHash = files
        })

        // 每分钟检查文件变化
        this.watchTimer = setInterval(() => {
            void this.syncChangedFiles()
        }, this.watchInterval)

        // 每24小时创建备份（如果有变化）
        this.backupTimer = setInterval(() => {
            void this.uploadBackup()
        }, this.backupInterval)
    }

    stopAutoSync() {
        if (this.watchTimer) {
            clearInterval(this.watchTimer)
            this.watchTimer = null
        }
        if (this.backupTimer) {
            clearInterval(this.backupTimer)
            this.backupTimer = null
        }
        console.log('Auto sync stopped')
    }

    updateConfig(config: Partial<WebDAVConfig>) {
        if (config.url) this.config.url = config.url
        if (config.username) this.config.username = config.username
        if (config.password) this.config.password = config.password
        if (config.interval) this.syncInterval = config.interval * 60 * 1000

        if (this.isConfigured()) {
            this.client = null
            this.stopAutoSync()
            void this.initClient().then(() => {
                this.startAutoSync()
            })
        }
    }
}

export default WebDAVSync
