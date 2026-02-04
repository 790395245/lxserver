import { VM } from 'vm2'
import * as fs from 'fs'
import * as path from 'path'
// @ts-ignore
import needle from 'needle'

// 用户API信息接口
interface UserApiInfo {
    id: string
    name: string
    description: string
    version: number | string
    author: string
    homepage: string
    script: string
    sources: Record<string, any>
    enabled: boolean
    owner: string // 'open' or username
}

// 加载的 API 实例
const loadedApis = new Map<string, any>()

// API 初始化状态追踪 map<id, status>
const apiStatus = new Map<string, { status: 'success' | 'failed', error?: string }>()

export function getApiStatus(id: string) {
    return apiStatus.get(id)
}


// 从脚本注释中提取元数据
export function extractMetadata(script: string): Partial<UserApiInfo> {
    const meta: any = {}

    // 匹配 JSDoc 风格的注释
    const commentMatch = script.match(/\/\*!([\s\S]*?)\*\//)
    if (commentMatch) {
        const comment = commentMatch[1]

        // @name
        const nameMatch = comment.match(/@name\s+(.+)/)
        if (nameMatch) meta.name = nameMatch[1].trim()

        // @description
        const descMatch = comment.match(/@description\s+(.+)/)
        if (descMatch) meta.description = descMatch[1].trim()

        // @version
        const verMatch = comment.match(/@version\s+(.+)/)
        if (verMatch) meta.version = verMatch[1].trim()

        // @author
        const authorMatch = comment.match(/@author\s+(.+)/)
        if (authorMatch) meta.author = authorMatch[1].trim()

        // @repository or @homepage
        const repoMatch = comment.match(/@(?:repository|homepage)\s+(.+)/)
        if (repoMatch) meta.homepage = repoMatch[1].trim()
    }

    return meta
}

// 创建 lx.request 包装器（使用 needle）
function createLxRequest() {
    return (url: string, options: any, callback: Function) => {
        const { method = 'get', timeout, headers, body, form, formData } = options || {}

        let requestOptions: any = {
            headers,
            response_timeout: typeof timeout === 'number' && timeout > 0 ? Math.min(timeout, 60000) : 60000
        }

        let data
        if (body) {
            data = body
        } else if (form) {
            data = form
            requestOptions.json = false
        } else if (formData) {
            data = formData
            requestOptions.json = false
        }

        const request = needle.request(method, url, data, requestOptions, (err: any, resp: any, body: any) => {
            try {
                if (err) {
                    callback.call(null, err, null, null)
                } else {
                    // 尝试将 body 转换为 JSON
                    let parsedBody = body
                    if (typeof body === 'string') {
                        try {
                            parsedBody = JSON.parse(body)
                        } catch { }
                    }

                    callback.call(null, null, {
                        statusCode: resp.statusCode,
                        statusMessage: resp.statusMessage,
                        headers: resp.headers,
                        body: parsedBody
                    }, parsedBody)
                }
            } catch (error: any) {
                callback.call(null, error, null, null)
            }
        })

        return () => {
            if (!request.request.aborted) request.request.abort()
        }
    }
}

// 加载自定义源脚本
export async function loadUserApi(apiInfo: UserApiInfo): Promise<any> {
    // 从脚本中提取元数据
    const metadata = extractMetadata(apiInfo.script)
    const fullApiInfo = { ...apiInfo, ...metadata }

    const sandbox: any = {
        console,
        Buffer,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Promise,
        Error,
        JSON,
        Math,
        Date,
        String,
        Number,
        Boolean,
        Array,
        Object,
        RegExp,
    }

    // 创建事件处理映射
    const eventHandlers = new Map<string, Function>()
    let registeredSources: any = {}

    // ========== 关键修改：提前创建 initPromise ==========
    let initResolve: (() => void) | null = null
    let initReject: ((err: Error) => void) | null = null
    const initPromise = new Promise<void>((resolve, reject) => {
        initResolve = resolve
        initReject = reject
    })
    // ==================================================

    // 创建 lx 环境
    sandbox.lx = {
        version: '2.0.0',
        env: 'node',
        platform: 'web',
        currentScriptInfo: {
            name: fullApiInfo.name,
            description: fullApiInfo.description,
            version: fullApiInfo.version,
            author: fullApiInfo.author,
            homepage: fullApiInfo.homepage,
        },
        utils: {
            buffer: {
                from: (data: any, encoding?: BufferEncoding) => Buffer.from(data, encoding),
                bufToString: (buf: any, format: BufferEncoding) => Buffer.from(buf, 'binary').toString(format)
            }
        },
        request: createLxRequest(),
        send: (eventName: string, data: any) => {
            console.log(`[UserApi-${fullApiInfo.name}] send:`, eventName)

            if (eventName === 'inited') {
                if (data && data.sources) {
                    registeredSources = data.sources
                    console.log(`[UserApi-${fullApiInfo.name}] Registered sources:`, Object.keys(data.sources))
                }
                // 触发 initPromise 解析
                if (initResolve) {
                    initResolve()
                }
                return Promise.resolve()
            } else if (eventName === 'updateAlert') {
                console.log(`[UserApi-${fullApiInfo.name}] Update available:`, data)
                const error = new Error(`发现新版本,需要更新,脚本将不会初始化: ${JSON.stringify({ version: data.version, updateUrl: data.updateUrl, description: data.log })}`)
                // 触发 initPromise 拒绝
                if (initReject) {
                    initReject(error)
                }
                return Promise.reject(error)
            } else {
                const error = new Error(`Unknown event: ${eventName}`)
                return Promise.reject(error)
            }
        },
        on: (eventName: string, handler: Function) => {
            return new Promise((resolve) => {
                console.log(`[UserApi-${fullApiInfo.name}] on:`, eventName)
                if (eventName === 'request') {
                    eventHandlers.set(eventName, handler)
                }
                resolve(undefined)
            })
        },
        EVENT_NAMES: {
            request: 'request',
            inited: 'inited',
            updateAlert: 'updateAlert'
        }
    }

    // 设置 globalThis
    sandbox.globalThis = sandbox
    sandbox.global = sandbox
    sandbox.window = sandbox
    sandbox.exports = {}
    sandbox.module = { exports: {} }
    sandbox.__filename = `custom_source_${fullApiInfo.id}.js`
    sandbox.__dirname = '/custom_sources'

    const vm = new VM({
        timeout: 10000,
        sandbox,
        eval: false,
        wasm: false,
    })

    try {
        // 执行脚本
        await vm.run(apiInfo.script)

        // 等待脚本调用 lx.send('inited')（最多等待 3 秒）
        console.log(`[UserApi] Waiting for ${fullApiInfo.name} to initialize...`)
        await Promise.race([
            initPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Init timeout after 3s')), 3000))
        ])
        console.log(`[UserApi] ${fullApiInfo.name} initialized successfully`)

        // 保存加载的 API
        const apiInstance = {
            info: { ...fullApiInfo, sources: registeredSources },
            handlers: eventHandlers,
            callRequest: async (action: string, source: string, info: any) => {
                const handler = eventHandlers.get('request')
                if (!handler) {
                    throw new Error(`No request handler for ${fullApiInfo.name}`)
                }

                return await handler({
                    action,
                    source,
                    info
                })
            }
        }

        loadedApis.set(apiInfo.id, apiInstance)
        console.log(`[UserApi] ✓ 成功加载: ${fullApiInfo.name} v${fullApiInfo.version} (Owner: ${fullApiInfo.owner})`)
        console.log(`[UserApi]   支持源: ${Object.keys(registeredSources).join(', ')}`)
        return { success: true, apiInstance, error: null }
    } catch (error: any) {
        console.error(`[UserApi] ✗ 加载失败 ${fullApiInfo.name}:`, error.message)
        // 返回详细错误信息而不是直接抛出
        return { success: false, apiInstance: null, error: error.message }
    }
}

// 调用自定义源的 getMusicUrl
export async function callUserApiGetMusicUrl(
    source: string,
    songInfo: any,
    quality: string,
    clientUsername?: string
): Promise<{ url: string, type: string }> {
    // 标准化 songInfo 格式：将 meta 中的字段提升到顶层
    const normalizedSongInfo = { ...songInfo }
    if (songInfo.meta) {
        // 将 meta 中的所有字段展开到顶层
        Object.assign(normalizedSongInfo, songInfo.meta)

        // ========== 通用字段映射 ==========
        // songId -> songmid (通用)
        if (songInfo.meta.songId && !normalizedSongInfo.songmid) {
            normalizedSongInfo.songmid = songInfo.meta.songId
        }

        // 图片字段统一
        if (songInfo.meta.picUrl && !normalizedSongInfo.img) {
            normalizedSongInfo.img = songInfo.meta.picUrl
        }

        // 音质信息
        if (songInfo.meta.qualitys && !normalizedSongInfo.types) {
            normalizedSongInfo.types = songInfo.meta.qualitys
        }
        if (songInfo.meta._qualitys && !normalizedSongInfo._types) {
            normalizedSongInfo._types = songInfo.meta._qualitys
        }

        // ========== 各平台特有字段 ==========
        // 酷狗 (kg): hash, albumId
        if (songInfo.meta.hash && !normalizedSongInfo.hash) {
            normalizedSongInfo.hash = songInfo.meta.hash
        }
        if (songInfo.meta.albumId && !normalizedSongInfo.albumId) {
            normalizedSongInfo.albumId = songInfo.meta.albumId
        }

        // 咪咕 (mg): copyrightId, lrcUrl, mrcUrl, trcUrl
        if (songInfo.meta.copyrightId && !normalizedSongInfo.copyrightId) {
            normalizedSongInfo.copyrightId = songInfo.meta.copyrightId
        }
        if (songInfo.meta.lrcUrl && !normalizedSongInfo.lrcUrl) {
            normalizedSongInfo.lrcUrl = songInfo.meta.lrcUrl
        }
        if (songInfo.meta.mrcUrl && !normalizedSongInfo.mrcUrl) {
            normalizedSongInfo.mrcUrl = songInfo.meta.mrcUrl
        }
        if (songInfo.meta.trcUrl && !normalizedSongInfo.trcUrl) {
            normalizedSongInfo.trcUrl = songInfo.meta.trcUrl
        }

        // QQ音乐 (tx): strMediaMid, albumMid
        if (songInfo.meta.strMediaMid && !normalizedSongInfo.strMediaMid) {
            normalizedSongInfo.strMediaMid = songInfo.meta.strMediaMid
        }
        if (songInfo.meta.albumMid && !normalizedSongInfo.albumMid) {
            normalizedSongInfo.albumMid = songInfo.meta.albumMid
        }

        // 删除 meta 对象以免有些严谨的脚本报错
        delete normalizedSongInfo.meta
    }

    // ========== 顶层字段兜底映射 ==========
    if (!normalizedSongInfo.hash && songInfo.hash) {
        normalizedSongInfo.hash = songInfo.hash
    }
    if (!normalizedSongInfo.copyrightId && songInfo.copyrightId) {
        normalizedSongInfo.copyrightId = songInfo.copyrightId
    }
    if (!normalizedSongInfo.strMediaMid && songInfo.strMediaMid) {
        normalizedSongInfo.strMediaMid = songInfo.strMediaMid
    }
    if (!normalizedSongInfo.albumMid && songInfo.albumMid) {
        normalizedSongInfo.albumMid = songInfo.albumMid
    }
    if (!normalizedSongInfo.albumId && songInfo.albumId) {
        normalizedSongInfo.albumId = songInfo.albumId
    }
    if (!normalizedSongInfo.lrcUrl && songInfo.lrcUrl) {
        normalizedSongInfo.lrcUrl = songInfo.lrcUrl
    }
    if (!normalizedSongInfo.mrcUrl && songInfo.mrcUrl) {
        normalizedSongInfo.mrcUrl = songInfo.mrcUrl
    }
    if (!normalizedSongInfo.trcUrl && songInfo.trcUrl) {
        normalizedSongInfo.trcUrl = songInfo.trcUrl
    }

    let supportedCount = 0;
    let lastError: Error | null = null;

    // 查找支持该 source 的 API
    // 收集所有支持该 source 的 API，并根据权限过滤
    const candidates: any[] = []
    for (const [apiId, api] of loadedApis) {
        if (!api.info.enabled) continue
        if (!api.info.sources || !api.info.sources[source]) continue

        // 权限校验：只允许 open 源 或 当前用户及其拥有的源
        if (api.info.owner === 'open' || (clientUsername && api.info.owner === clientUsername)) {
            candidates.push(api)
        }
    }

    supportedCount = candidates.length

    if (supportedCount === 0) {
        // 如果没有找到源，可能是因为权限问题导致筛选后为空
        // 检查是否存在该源但无权限访问的情况（可选，用于调试）
        throw new Error(`未找到支持 ${source} 平台的自定义源，请在设置中添加或启用相关源 (User: ${clientUsername || 'Guest'})`)
    }

    // 逻辑分歧：
    // 1. 如果只有一个源支持 -> 重试 3 次
    // 2. 如果有多个源支持 -> 每个源试一次 (轮询)

    if (supportedCount === 1) {
        const api = candidates[0]
        const maxRetries = 3

        for (let i = 0; i < maxRetries; i++) {
            try {
                console.log(`[UserApi] 尝试 ${api.info.name} 获取 ${source} 音乐链接 (第 ${i + 1}/${maxRetries} 次, Owner: ${api.info.owner})`)

                const url = await api.callRequest('musicUrl', source, {
                    musicInfo: normalizedSongInfo,
                    type: quality
                })

                console.log(`[UserApi] ✓ ${api.info.name} 成功返回链接`)
                return { url, type: quality }
            } catch (error: any) {
                console.error(`[UserApi] ${api.info.name} 失败 (第 ${i + 1}/${maxRetries} 次):`, error.message)
                lastError = error
                // 如果不是最后一次尝试，等待一小会儿
                if (i < maxRetries - 1) {
                    await new Promise(r => setTimeout(r, 1000))
                }
            }
        }
    } else {
        // 多个源，轮流尝试
        for (const api of candidates) {
            try {
                console.log(`[UserApi] 尝试 ${api.info.name} 获取 ${source} 音乐链接 (Owner: ${api.info.owner})`)

                const url = await api.callRequest('musicUrl', source, {
                    musicInfo: normalizedSongInfo,
                    type: quality
                })

                console.log(`[UserApi] ✓ ${api.info.name} 成功返回链接`)
                return { url, type: quality }
            } catch (error: any) {
                console.error(`[UserApi] ${api.info.name} 失败:`, error.message)
                lastError = error
                continue
            }
        }
    }

    throw new Error(`已尝试 ${supportedCount} 个支持 ${source} 的源 (或单源尝试 ${supportedCount === 1 ? 3 : supportedCount} 次)，但全部失败。最后错误: ${lastError?.message}`)
}

// 辅助函数：加载指定目录下的源
async function loadSourcesFromDir(dirPath: string, owner: string, stats: { loadedCount: number }) {
    const metaPath = path.join(dirPath, 'sources.json')
    if (!fs.existsSync(metaPath)) {
        return
    }

    try {
        const sources = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        let needsSave = false

        for (const source of sources) {
            if (!source.enabled) {
                console.log(`[UserApi] [${owner}] 跳过已禁用: ${source.name}`)
                continue
            }

            const scriptPath = path.join(dirPath, source.id)
            if (!fs.existsSync(scriptPath)) {
                console.warn(`[UserApi] [${owner}] 脚本文件未找到: ${source.id}`)
                continue
            }

            try {
                const script = fs.readFileSync(scriptPath, 'utf-8')
                const metadata = extractMetadata(script)

                const result = await loadUserApi({
                    id: source.id,
                    name: metadata.name || source.name,
                    description: metadata.description || '',
                    version: metadata.version || 1,
                    author: metadata.author || '',
                    homepage: metadata.homepage || '',
                    script,
                    sources: {},
                    enabled: true,
                    owner: owner // 设置 owner
                })

                if (result.success) {
                    stats.loadedCount++
                    apiStatus.set(source.id, { status: 'success' })

                    // [Self-Healing] 检查并修复 supportedSources
                    const runtimeSources = Object.keys(result.apiInstance.info.sources).sort();
                    const storedSources = (source.supportedSources || []).sort();

                    if (JSON.stringify(runtimeSources) !== JSON.stringify(storedSources)) {
                        console.log(`[UserApi] [Fix] [${owner}] 更新源 ${source.name} 的支持列表: ${JSON.stringify(storedSources)} -> ${JSON.stringify(runtimeSources)}`);
                        source.supportedSources = runtimeSources;
                        if (metadata.version && source.version !== metadata.version) source.version = metadata.version;
                        if (metadata.author && source.author !== metadata.author) source.author = metadata.author;
                        if (metadata.description && source.description !== metadata.description) source.description = metadata.description;
                        if (metadata.homepage && source.homepage !== metadata.homepage) source.homepage = metadata.homepage;
                        needsSave = true;
                    }
                } else {
                    console.error(`[UserApi] [${owner}] 加载 ${metadata.name || source.name} 失败: ${result.error}`)
                    apiStatus.set(source.id, { status: 'failed', error: result.error })
                }
            } catch (error: any) {
                console.error(`[UserApi] [${owner}] 加载 ${source.name} 失败:`, error.message)
                apiStatus.set(source.id, { status: 'failed', error: error.message })
            }
        }

        if (needsSave) {
            fs.writeFileSync(metaPath, JSON.stringify(sources, null, 2));
            console.log(`[UserApi] [${owner}] 已更新 sources.json 元数据`);
        }
    } catch (error: any) {
        console.error(`[UserApi] [${owner}] 读取 sources.json 失败:`, error.message)
    }
}

// 从文件系统加载所有已启用的自定义源
// 路径变更：/data/data/users/source/{username} 和 /data/data/users/source/_open
export async function initUserApis(targetUser?: string) {
    const sourceRoot = path.join(process.cwd(), 'data', 'data', 'users', 'source')
    const stats = { loadedCount: 0 }

    console.log(`[UserApi] ========================================`)

    // 如果根目录不存在，无需加载
    if (!fs.existsSync(sourceRoot)) {
        console.log(`[UserApi] Source root directory not found: ${sourceRoot}`)
        console.log(`[UserApi] ========================================`)
        return
    }

    if (targetUser) {
        console.log(`[UserApi] 重新加载用户源: ${targetUser}`)
        // 清理该用户的旧源
        for (const [id, api] of loadedApis.entries()) {
            if (api.info.owner === targetUser) {
                loadedApis.delete(id)
            }
        }

        // 加载该用户的源
        let dirName = targetUser

        // 特殊处理：如果是 'open'，对应目录是 '_open'
        if (targetUser === 'open') {
            dirName = '_open'
        }

        const userSourceDir = path.join(sourceRoot, dirName)
        if (fs.existsSync(userSourceDir)) {
            await loadSourcesFromDir(userSourceDir, targetUser, stats)
        }

    } else {
        console.log(`[UserApi] 初始化所有自定义源...`)
        loadedApis.clear()

        // 扫描 sourceRoot 下的所有子目录
        try {
            const entries = fs.readdirSync(sourceRoot, { withFileTypes: true })
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    let owner = entry.name
                    // 如果目录是 _open，owner 为 'open'
                    if (entry.name === '_open') {
                        owner = 'open'
                    }

                    const dirPath = path.join(sourceRoot, entry.name)
                    await loadSourcesFromDir(dirPath, owner, stats)
                }
            }
        } catch (error: any) {
            console.error('[UserApi] 扫描源目录失败:', error.message)
        }
    }

    console.log(`[UserApi] 本次加载: ${stats.loadedCount} 个源`)
    console.log(`[UserApi] 当前总计: ${loadedApis.size} 个源`)
    console.log(`[UserApi] ========================================`)
}

// 获取所有已加载的 API
export function getLoadedApis() {
    return Array.from(loadedApis.values()).map(api => api.info)
}

// 检查某个源是否被支持
// clientUsername: 调用者的用户名。如果未提供，则只能检查 open 源
export function isSourceSupported(source: string, clientUsername?: string): boolean {
    for (const [apiId, api] of loadedApis) {
        if (!api.info.enabled || !api.info.sources || !api.info.sources[source]) {
            continue
        }

        // 权限检查
        if (api.info.owner === 'open' || (clientUsername && api.info.owner === clientUsername)) {
            return true
        }
    }
    return false
}
