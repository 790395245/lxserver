import * as fs from 'fs'
import * as path from 'path'
import { extractMetadata, loadUserApi, initUserApis, getApiStatus } from './userApi'
import type { IncomingMessage, ServerResponse } from 'http'

// 读取请求体
async function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => resolve(body))
        req.on('error', reject)
    })
}

// 验证脚本
export async function handleValidate(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { script } = JSON.parse(body)

        if (!script || typeof script !== 'string') {
            throw new Error('Invalid script content')
        }

        // 基本格式检查 - 移除静态检查以支持混淆脚本
        // if (!script.includes('lx.on') || !script.includes('lx.send')) {
        //     throw new Error('脚本必须包含 lx.on 和 lx.send 调用,这不是有效的洛雪音乐自定义源脚本')
        // }

        const metadata = extractMetadata(script)

        // 检查必要的元数据
        // if (!metadata.name) {
        //     throw new Error('脚本必须包含 @name 元数据')
        // }
        // if (!metadata.version) {
        //     throw new Error('脚本必须包含 @version 元数据')
        // }

        // 尝试加载验证
        const result = await loadUserApi({
            id: 'temp_validation',
            script,
            enabled: false,
            ...metadata
        } as any)

        if (result.success) {
            // 检查是否注册了任何源
            const api = result.apiInstance
            const sources = api?.info?.sources || {}
            const sourcesCount = Object.keys(sources).length

            if (sourcesCount === 0) {
                throw new Error('脚本没有注册任何音源。请确保脚本正确调用了 lx.send("inited", { sources: {...} })')
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
                valid: true,
                metadata,
                sources: Object.keys(sources),
                sourcesCount
            }))
        } else {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ valid: false, error: result.error }))
        }
    } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ valid: false, error: err.message }))
    }
}

// 辅助函数：获取脚本信息（元数据和支持的源）
async function getScriptInfo(scriptContent: string) {
    const metadata = extractMetadata(scriptContent)

    // 试运行脚本以获取支持的源
    let supportedSources: string[] = []
    try {
        const result = await loadUserApi({
            id: 'temp_analysis_' + Date.now(),
            script: scriptContent,
            enabled: false,
            ...metadata
        } as any)

        if (result.success && result.apiInstance?.info?.sources) {
            supportedSources = Object.keys(result.apiInstance.info.sources)
        }
    } catch (e) {
        console.warn('[CustomSource] 分析脚本支持源失败:', e)
    }

    return { metadata, supportedSources }
}

// 上传脚本
export async function handleUpload(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { filename, content, username = 'default' } = JSON.parse(body)
        const sourcesDir = path.join(process.cwd(), 'data', 'users', username, 'custom_sources')
        const metaPath = path.join(sourcesDir, 'sources.json')

        // 创建目录
        if (!fs.existsSync(sourcesDir)) {
            fs.mkdirSync(sourcesDir, { recursive: true })
        }

        // 获取脚本信息
        const { metadata, supportedSources } = await getScriptInfo(content)

        // 生成唯一ID
        const id = `${encodeURIComponent(metadata.name || filename)}`
        const scriptPath = path.join(sourcesDir, id)

        // 读取现有列表
        let sources: any[] = []
        if (fs.existsSync(metaPath)) {
            sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        }

        // 检查是否已存在
        const existing = sources.find(s => s.id === id)
        if (existing) {
            throw new Error(`源 "${metadata.name}" 已存在`)
        }

        // 保存脚本文件
        fs.writeFileSync(scriptPath, content, 'utf-8')

        // 更新元数据
        sources.push({
            id,
            name: metadata.name || filename,
            version: metadata.version,
            author: metadata.author,
            description: metadata.description,
            homepage: metadata.homepage,
            size: Buffer.byteLength(content, 'utf-8'),
            supportedSources, // 保存支持的源
            enabled: false, // 默认禁用
            uploadTime: new Date().toISOString()
        })

        fs.writeFileSync(metaPath, JSON.stringify(sources, null, 2))

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, id, metadata, supportedSources }))
    } catch (err: any) {
        console.error('[CustomSource] Upload error:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: err.message }))
    }
}

// 从远程URL导入脚本
export async function handleImport(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { url, filename } = JSON.parse(body)

        if (!url) {
            throw new Error('Missing URL')
        }

        // 下载脚本内容
        const https = require('https')
        const http = require('http')
        const content = await new Promise<string>((resolve, reject) => {
            const protocol = url.startsWith('https') ? https : http
            protocol.get(url, (response: any) => {
                let data = ''
                response.on('data', (chunk: any) => data += chunk)
                response.on('end', () => resolve(data))
                response.on('error', reject)
            }).on('error', reject)
        })

        // 获取脚本信息
        const { metadata, supportedSources } = await getScriptInfo(content)

        const username = 'default' // 或从请求中获取
        const sourcesDir = path.join(process.cwd(), 'data', 'users', username, 'custom_sources')
        const metaPath = path.join(sourcesDir, 'sources.json')

        // 创建目录
        if (!fs.existsSync(sourcesDir)) {
            fs.mkdirSync(sourcesDir, { recursive: true })
        }

        // 生成唯一ID
        const displayName = metadata.name || filename || 'unknown_source'
        const id = `${encodeURIComponent(displayName)}`
        const scriptPath = path.join(sourcesDir, id)

        // 读取现有列表
        let sources: any[] = []
        if (fs.existsSync(metaPath)) {
            sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        }

        // 检查是否已存在
        const existing = sources.find(s => s.id === id)
        if (existing) {
            throw new Error(`源 "${displayName}" 已存在`)
        }

        // 保存脚本文件
        fs.writeFileSync(scriptPath, content, 'utf-8')

        // 更新元数据
        sources.push({
            id,
            name: metadata.name || filename,
            version: metadata.version,
            author: metadata.author,
            description: metadata.description,
            homepage: metadata.homepage,
            size: Buffer.byteLength(content, 'utf-8'),
            supportedSources, // 保存支持的源
            enabled: false,
            uploadTime: new Date().toISOString(),
            sourceUrl: url
        })

        fs.writeFileSync(metaPath, JSON.stringify(sources, null, 2))

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, filename: displayName, id, metadata, supportedSources }))
    } catch (err: any) {
        console.error('[CustomSource] Import error:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: err.message }))
    }
}

// 获取列表
export async function handleList(req: IncomingMessage, res: ServerResponse, username: string) {
    const metaPath = path.join(process.cwd(), 'data', 'users', username, 'custom_sources', 'sources.json')

    try {
        if (!fs.existsSync(metaPath)) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify([]))
            return
        }

        const sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        const sourcesDir = path.dirname(metaPath)

        // 为缺少size的源添加大小信息，并合并运行时状态
        const enrichedSources = sources.map((source: any) => {
            if (!source.size || isNaN(source.size)) {
                const scriptPath = path.join(sourcesDir, source.id)
                if (fs.existsSync(scriptPath)) {
                    const stats = fs.statSync(scriptPath)
                    source.size = stats.size
                }
            }

            // 合并运行时状态
            const status = getApiStatus(source.id)
            if (status) {
                source.status = status.status
                source.error = status.error
            }

            return source
        })

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(enrichedSources))
    } catch (err: any) {
        res.writeHead(500)
        res.end(err.message)
    }
}

// 启用/禁用
export async function handleToggle(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { id, sourceId, enabled, username = 'default' } = JSON.parse(body)
        const targetId = id || sourceId // 兼容两种参数名
        const metaPath = path.join(process.cwd(), 'data', 'users', username, 'custom_sources', 'sources.json')

        if (!fs.existsSync(metaPath)) {
            throw new Error('源列表不存在')
        }

        const sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))

        const target = sources.find((s: any) => s.id === targetId)
        if (!target) {
            throw new Error('源不存在')
        }

        target.enabled = enabled !== undefined ? enabled : !target.enabled // 支持toggle模式

        fs.writeFileSync(metaPath, JSON.stringify(sources, null, 2))

        // 重新初始化UserApis
        await initUserApis(username)

        console.log('[CustomSource] Toggle complete, sending response.');
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, enabled: target.enabled }))
    } catch (err: any) {
        console.error('[CustomSource] Toggle error:', err)
        res.writeHead(500)
        res.end(err.message)
    }
}

// 删除
export async function handleDelete(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await readBody(req)
        const { id, sourceId, username = 'default' } = JSON.parse(body)
        const targetId = id || sourceId // 兼容两种参数名
        const sourcesDir = path.join(process.cwd(), 'data', 'users', username, 'custom_sources')
        const metaPath = path.join(sourcesDir, 'sources.json')
        const scriptPath = path.join(sourcesDir, targetId)

        if (!fs.existsSync(metaPath)) {
            throw new Error('源列表不存在')
        }

        let sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        sources = sources.filter((s: any) => s.id !== targetId)

        // 删除脚本文件
        if (fs.existsSync(scriptPath)) {
            fs.unlinkSync(scriptPath)
        }

        fs.writeFileSync(metaPath, JSON.stringify(sources, null, 2))

        // 重新初始化
        await initUserApis(username)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
    } catch (err: any) {
        console.error('[CustomSource] Delete error:', err)
        res.writeHead(500)
        res.end(err.message)
    }
}
