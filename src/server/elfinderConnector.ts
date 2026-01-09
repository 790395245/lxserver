import * as path from 'path'
import * as fs from 'fs'
import * as crypto from 'crypto'

// elFinder 文件管理器连接器
export class ElFinderConnector {
    private root: string
    private rootHash: string

    constructor(rootPath: string) {
        this.root = path.resolve(rootPath)
        this.rootHash = this.encode(this.root)
    }

    // 编码路径为hash
    private encode(filePath: string): string {
        const relative = path.relative(this.root, filePath)
        return Buffer.from(relative || '.').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    }

    // 解码hash为路径
    private decode(hash: string): string {
        try {
            const base64 = hash.replace(/-/g, '+').replace(/_/g, '/')
            const relative = Buffer.from(base64, 'base64').toString('utf-8')
            return path.join(this.root, relative)
        } catch {
            return this.root
        }
    }

    // 获取文件/文件夹信息
    private async getFileInfo(filePath: string): Promise<any> {
        try {
            const stats = await fs.promises.stat(filePath)
            const name = path.basename(filePath)
            const hash = this.encode(filePath)

            const info: any = {
                name,
                hash,
                mime: stats.isDirectory() ? 'directory' : this.getMime(name),
                ts: Math.floor(stats.mtimeMs / 1000),
                size: stats.size,
                read: 1,
                write: 1,
                locked: 0
            }

            if (stats.isDirectory()) {
                info.volumeid = 'l1_'
                // 检查是否有子項
                try {
                    const files = await fs.promises.readdir(filePath)
                    if (files.length > 0) {
                        info.dirs = 1
                    }
                } catch { }
            }

            // 如果是根目录
            if (filePath === this.root) {
                info.volumeid = 'l1_'
                info.isroot = 1
            }

            return info
        } catch (error) {
            return null
        }
    }

    // 获取MIME类型
    private getMime(filename: string): string {
        const ext = path.extname(filename).toLowerCase()
        const mimeTypes: Record<string, string> = {
            '.txt': 'text/plain',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.html': 'text/html',
            '.css': 'text/css',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.pdf': 'application/pdf',
            '.zip': 'application/zip',
            '.mp3': 'audio/mpeg',
            '.mp4': 'video/mp4',
        }
        return mimeTypes[ext] || 'application/octet-stream'
    }

    // 处理请求
    async handle(cmd: string, params: any): Promise<any> {
        try {
            switch (cmd) {
                case 'open':
                    return await this.cmdOpen(params)
                case 'ls':
                    return await this.cmdLs(params)
                case 'tree':
                    return await this.cmdTree(params)
                case 'parents':
                    return await this.cmdParents(params)
                case 'mkdir':
                    return await this.cmdMkdir(params)
                case 'mkfile':
                    return await this.cmdMkfile(params)
                case 'rename':
                    return await this.cmdRename(params)
                case 'rm':
                    return await this.cmdRm(params)
                case 'paste':
                    return await this.cmdPaste(params)
                case 'get':
                    return await this.cmdGet(params)
                case 'put':
                    return await this.cmdPut(params)
                case 'upload':
                    return await this.cmdUpload(params)
                case 'file':
                    return await this.cmdFile(params)
                default:
                    return { error: ['Unknown command'] }
            }
        } catch (error: any) {
            return { error: [error.message || 'Internal error'] }
        }
    }

    // open - 打开文件夹
    private async cmdOpen(params: any): Promise<any> {
        const target = params.target ? this.decode(params.target) : this.root
        const init = params.init === '1'

        const targetInfo = await this.getFileInfo(target)
        if (!targetInfo) {
            return { error: ['errOpen', 'Directory not found'] }
        }

        const result: any = {
            cwd: targetInfo,
            files: []
        }

        // 如果是初始化
        if (init) {
            result.api = '2.1'
            result.uplMaxSize = '100M'
            result.options = {
                path: '',
                disabled: [],
                separator: path.sep,
                copyOverwrite: 1,
                archivers: {
                    create: [],
                    extract: []
                }
            }
        }

        // 读取文件夹内容
        if (targetInfo.mime === 'directory') {
            try {
                const files = await fs.promises.readdir(target)
                for (const file of files) {
                    // 跳过隐藏文件
                    if (file.startsWith('.')) continue

                    const filePath = path.join(target, file)
                    const fileInfo = await this.getFileInfo(filePath)
                    if (fileInfo) {
                        result.files.push(fileInfo)
                    }
                }
            } catch (error) {
                // 忽略读取错误
            }
        }

        return result
    }

    // ls - 列出目录
    private async cmdLs(params: any): Promise<any> {
        const target = this.decode(params.target)
        const files: any[] = []

        try {
            const items = await fs.promises.readdir(target)
            for (const item of items) {
                if (item.startsWith('.')) continue
                const itemPath = path.join(target, item)
                const info = await this.getFileInfo(itemPath)
                if (info) {
                    files.push(info)
                }
            }
            return { list: files }
        } catch (error) {
            return { error: ['Error reading directory'] }
        }
    }

    // tree - 获取目录树
    private async cmdTree(params: any): Promise<any> {
        const target = this.decode(params.target)
        return { tree: await this.getTree(target) }
    }

    private async getTree(dirPath: string): Promise<any[]> {
        const tree: any[] = []
        try {
            const items = await fs.promises.readdir(dirPath)
            for (const item of items) {
                if (item.startsWith('.')) continue
                const itemPath = path.join(dirPath, item)
                const stats = await fs.promises.stat(itemPath)
                if (stats.isDirectory()) {
                    tree.push(await this.getFileInfo(itemPath))
                }
            }
        } catch { }
        return tree
    }

    // parents - 获取父级路径
    private async cmdParents(params: any): Promise<any> {
        const target = this.decode(params.target)
        const tree: any[] = []

        let current = target
        while (current !== this.root && current.startsWith(this.root)) {
            current = path.dirname(current)
            const info = await this.getFileInfo(current)
            if (info) {
                tree.unshift(info)
            }
        }

        return { tree }
    }

    // mkdir - 创建文件夹
    private async cmdMkdir(params: any): Promise<any> {
        const target = this.decode(params.target)
        const name = params.name
        const newDir = path.join(target, name)

        try {
            await fs.promises.mkdir(newDir)
            const info = await this.getFileInfo(newDir)
            return { added: [info] }
        } catch (error) {
            return { error: ['Error creating directory'] }
        }
    }

    // mkfile - 创建文件
    private async cmdMkfile(params: any): Promise<any> {
        const target = this.decode(params.target)
        const name = params.name
        const newFile = path.join(target, name)

        try {
            await fs.promises.writeFile(newFile, '')
            const info = await this.getFileInfo(newFile)
            return { added: [info] }
        } catch (error) {
            return { error: ['Error creating file'] }
        }
    }

    // rename - 重命名
    private async cmdRename(params: any): Promise<any> {
        const target = this.decode(params.target)
        const name = params.name
        const newPath = path.join(path.dirname(target), name)

        try {
            await fs.promises.rename(target, newPath)
            const info = await this.getFileInfo(newPath)
            return { added: [info], removed: [params.target] }
        } catch (error) {
            return { error: ['Error renaming'] }
        }
    }

    // rm - 删除
    private async cmdRm(params: any): Promise<any> {
        const targets = Array.isArray(params['targets[]']) ? params['targets[]'] : [params['targets[]']]
        const removed: string[] = []

        for (const hash of targets) {
            const filePath = this.decode(hash)
            try {
                const stats = await fs.promises.stat(filePath)
                if (stats.isDirectory()) {
                    await fs.promises.rm(filePath, { recursive: true })
                } else {
                    await fs.promises.unlink(filePath)
                }
                removed.push(hash)
            } catch (error) {
                // 忽略错误，继续删除其他文件
            }
        }

        return { removed }
    }

    // paste - 复制/移动
    private async cmdPaste(params: any): Promise<any> {
        const dst = this.decode(params.dst)
        const targets = Array.isArray(params['targets[]']) ? params['targets[]'] : [params['targets[]']]
        const cut = params.cut === '1'
        const added: any[] = []
        const removed: string[] = []

        for (const hash of targets) {
            const src = this.decode(hash)
            const name = path.basename(src)
            const dstPath = path.join(dst, name)

            try {
                if (cut) {
                    // 移动
                    await fs.promises.rename(src, dstPath)
                    removed.push(hash)
                } else {
                    // 复制
                    await this.copyRecursive(src, dstPath)
                }
                const info = await this.getFileInfo(dstPath)
                if (info) {
                    added.push(info)
                }
            } catch (error) {
                // 忽略错误
            }
        }

        return { added, removed: cut ? removed : [] }
    }

    private async copyRecursive(src: string, dst: string): Promise<void> {
        const stats = await fs.promises.stat(src)
        if (stats.isDirectory()) {
            await fs.promises.mkdir(dst, { recursive: true })
            const files = await fs.promises.readdir(src)
            for (const file of files) {
                await this.copyRecursive(path.join(src, file), path.join(dst, file))
            }
        } else {
            await fs.promises.copyFile(src, dst)
        }
    }

    // get - 获取文件内容
    private async cmdGet(params: any): Promise<any> {
        const target = this.decode(params.target)
        try {
            const content = await fs.promises.readFile(target, 'utf-8')
            return { content }
        } catch (error) {
            return { error: ['Error reading file'] }
        }
    }

    // put - 保存文件内容
    private async cmdPut(params: any): Promise<any> {
        const target = this.decode(params.target)
        const content = params.content || ''

        try {
            await fs.promises.writeFile(target, content, 'utf-8')
            const info = await this.getFileInfo(target)
            return { changed: [info] }
        } catch (error) {
            return { error: ['Error saving file'] }
        }
    }

    // upload - 上传文件
    private async cmdUpload(params: any): Promise<any> {
        // 这个会在路由中处理文件上传
        return { added: [] }
    }

    // file - 下载文件
    private async cmdFile(params: any): Promise<any> {
        const target = this.decode(params.target)
        return { path: target }
    }
}

export function getSystemRoot(): string {
    return process.cwd()
}

export function getDataFolder(): string {
    return global.lx?.userPath || path.join(process.cwd(), 'data')
}
