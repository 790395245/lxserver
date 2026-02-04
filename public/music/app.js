

const API_BASE = '/api/music';
let currentPage = 1;
let currentSearch = { name: '', source: 'kw' };
let currentPlaylist = [];
let currentIndex = -1;
let currentSearchScope = 'network'; // 'network', 'local_list', 'local_all'
let currentPlayingSong = null; // [Fix] Track currently playing song independently of view
const audio = document.getElementById('audio-player');

// Settings & Batch Selection
let settings = {
    itemsPerPage: 20, // Default 20 items per page, can be 'all'
    preferredQuality: '320k' // 默认音质偏好
};

// 从 localStorage 加载设置
try {
    const saved = localStorage.getItem('lx_settings');
    if (saved) {
        settings = { ...settings, ...JSON.parse(saved) };
    }
} catch (e) {
    console.error('[Settings] 加载设置失败:', e);
}

let batchMode = false;
let selectedItems = new Set(); // Set of item IDs
let selectedSongObjects = new Map(); // Map of ID -> Song Object (for cross-page selection)

// ===== 认证相关代码 =====
let authEnabled = false;
let authToken = sessionStorage.getItem('lx_player_auth');

// 检查认证状态
async function checkAuth() {
    console.log('[Auth] Starting checkAuth...');
    try {
        const response = await fetch('/api/music/config');
        const config = await response.json();
        console.log('[Auth] Config received:', config);

        authEnabled = config['player.enableAuth'] === true;
        console.log('[Auth] authEnabled:', authEnabled, 'authToken:', authToken);

        if (authEnabled && !authToken) {
            // console.log('[Auth] Showing overlay (reason: enabled + no token)');
            showAuthOverlay();
        } else if (authEnabled && authToken) {
            // 验证 token 是否有效
            console.log('[Auth] Verifying token...');
            const valid = await verifyAuthToken(authToken);
            console.log('[Auth] Token valid?', valid);
            if (!valid) {
                // console.log('[Auth] Showing overlay (reason: token invalid)');
                showAuthOverlay();
            }
        } else {
            console.log('[Auth] No action needed');
        }
    } catch (error) {
        console.error('[Auth] 检查认证状态失败:', error);
    }
}

// 显示认证遮罩
function showAuthOverlay() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');
        setTimeout(() => {
            const card = document.getElementById('auth-card');
            if (card) {
                card.style.transform = 'scale(1)';
                card.style.opacity = '1';
            }
        }, 50);

        // 聚焦到密码输入框
        setTimeout(() => {
            const input = document.getElementById('auth-password-input');
            if (input) input.focus();
        }, 300);
    }
}

// 隐藏认证遮罩
function hideAuthOverlay() {
    const card = document.getElementById('auth-card');
    if (card) {
        card.style.transform = 'scale(0.95)';
        card.style.opacity = '0';
    }

    setTimeout(() => {
        const overlay = document.getElementById('auth-overlay');
        if (overlay) {
            overlay.classList.add('hidden');
            overlay.classList.remove('flex');
        }
    }, 300);
}

// 处理认证提交
async function handleAuthSubmit(event) {
    event.preventDefault();
    const password = document.getElementById('auth-password-input').value;
    const errorDiv = document.getElementById('auth-error');

    try {
        const response = await fetch('/api/music/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        const result = await response.json();

        if (result.success) {
            authToken = result.token || password;
            sessionStorage.setItem('lx_player_auth', authToken);
            hideAuthOverlay();
            errorDiv.classList.add('hidden');
        } else {
            errorDiv.classList.remove('hidden');
            const input = document.getElementById('auth-password-input');
            input.value = '';
            input.classList.add('border-red-500');
            setTimeout(() => {
                input.classList.remove('border-red-500');
            }, 500);
        }
    } catch (error) {
        console.error('[Auth] 认证失败:', error);
        errorDiv.classList.remove('hidden');
    }
}

// 验证 token
async function verifyAuthToken(token) {
    try {
        const response = await fetch('/api/music/auth/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        const result = await response.json();
        return result.valid === true;
    } catch (error) {
        console.error('[Auth] 验证 token 失败:', error);
        return false;
    }
}

// 页面加载时检查认证
checkAuth();
// ===== 认证代码结束 =====

// 音质选择器初始化
document.addEventListener('DOMContentLoaded', () => {
    const qualitySelect = document.getElementById('quality-select');
    if (qualitySelect && settings.preferredQuality) {
        qualitySelect.value = settings.preferredQuality;
    }
});

// 切换音质偏好
function changeQualityPreference(quality) {
    settings.preferredQuality = quality;
    try {
        localStorage.setItem('lx_settings', JSON.stringify(settings));
        console.log(`[Settings] 音质偏好已更改为: ${quality}`);

        // 显示提示
        const toast = document.createElement('div');
        toast.className = 'fixed bottom-24 right-4 bg-emerald-500 text-white px-4 py-2 rounded-lg shadow-lg z-50';
        toast.textContent = `默认音质已设置为: ${window.QualityManager.getQualityDisplayName(quality)}`;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('opacity-0', 'transition-opacity');
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    } catch (e) {
        console.error('[Settings] 保存设置失败:', e);
    }
}


// Tab Switching
function switchTab(tabId) {
    document.querySelectorAll('[id^="view-"]').forEach(el => {
        el.classList.add('hidden');
        el.classList.remove('opacity-100');
        el.classList.add('opacity-0');
    });
    const activeView = document.getElementById(`view-${tabId}`);
    activeView.classList.remove('hidden');
    // small delay to allow display block to apply before opacity transition
    setTimeout(() => {
        activeView.classList.remove('opacity-0');
        activeView.classList.add('opacity-100');
    }, 10);

    // Reset Sidebar Highlight
    document.querySelectorAll('[id^="tab-"]').forEach(el => el.classList.remove('active-tab', 'text-emerald-600'));
    const activeTab = document.getElementById(`tab-${tabId}`);
    if (activeTab) { // might be Favorites div
        activeTab.classList.add('active-tab');
        activeTab.classList.remove('text-gray-600');
    }

    // Reset Search Scope if switching to search/settings explicitly
    if (tabId === 'search') {
        currentSearchScope = 'network';
        document.getElementById('search-source').classList.remove('hidden');
        document.getElementById('search-input').placeholder = "搜索歌曲、歌手...";
        document.getElementById('page-title').innerText = "搜索音乐";

        // === 修复：清空搜索结果，显示初始状态 ===
        const resultsContainer = document.getElementById('search-results');
        const searchInput = document.getElementById('search-input');

        currentPlaylist = [];

        // 清空搜索框
        if (searchInput) {
            searchInput.value = '';
        }

        // 总是显示热搜初始状态
        showInitialSearchState();
    }

    // Collapse Favorites if leaving
    if (tabId !== 'favorites') {
        const favList = document.getElementById('favorites-children');
        const arrow = document.getElementById('favorites-arrow');
        if (favList && favList.style.height !== '0px') {
            favList.style.height = '0px';
            if (arrow) arrow.style.transform = 'rotate(-90deg)';
        }
    }

    // Title update (handled above for search, others here)
    if (tabId === 'settings') {
        document.getElementById('page-title').innerText = '设置';
        // 确保设置界面的自定义源列表是最新的
        if (typeof loadCustomSources === 'function') {
            loadCustomSources();
        }
    }

    if (tabId === 'about') {
        document.getElementById('page-title').innerText = '关于';
        loadAboutContent();
    }
}

// Load About Content
async function loadAboutContent() {
    const aboutContainer = document.getElementById('about-content');
    if (!aboutContainer) return;

    try {
        const response = await fetch('/music/about.md');
        if (!response.ok) throw new Error('Failed to load about.md');
        const text = await response.text();

        // Render Markdown
        if (window.marked) {
            // Replace {{version}} placeholder
            const version = (window.CONFIG && window.CONFIG.version) || 'v1.0.0';
            const content = text.replace(/{{version}}/g, version);
            aboutContainer.innerHTML = window.marked.parse(content);
        } else {
            aboutContainer.innerText = text; // Fallback
        }
        aboutContainer.classList.remove('animate-pulse');
    } catch (e) {
        console.error('Failed to load about content:', e);
        aboutContainer.innerHTML = '<p class="text-red-500">加载关于页面失败，请稍后重试。</p>';
    }
}

// Set Version on Load
document.addEventListener('DOMContentLoaded', () => {
    if (window.CONFIG && window.CONFIG.version) {
        const versionEl = document.getElementById('app-version');
        if (versionEl) {
            versionEl.innerText = window.CONFIG.version + ' Web';
        }
    }
});

// Search Logic
function handleSearchKeyPress(e) {
    if (e.key === 'Enter') doSearch();
}

const SOURCES = ['kw', 'kg', 'tx', 'wy', 'mg'];

async function doSearch(page = 1) {
    const input = document.getElementById('search-input').value.trim();
    const resultsContainer = document.getElementById('search-results');

    // Local Search Logic
    if (currentSearchScope === 'local_list' || currentSearchScope === 'local_all') {
        if (!input) {
            renderResults(currentPlaylist);
            return;
        }

        let targets = [];
        if (currentSearchScope === 'local_list') {
            targets = currentPlaylist;
        } else {
            // Aggregate all local
            if (currentListData) {
                targets = [
                    ...(currentListData.defaultList || []),
                    ...(currentListData.loveList || []),
                    ...(currentListData.userList || []).flatMap(l => l.list)
                ];
            }
        }

        const lower = input.toLowerCase();
        const filtered = targets.filter(item =>
            (item.name && item.name.toLowerCase().includes(lower)) ||
            (item.singer && item.singer.toLowerCase().includes(lower))
        );
        renderResults(filtered);
        return;
    }

    // Network Search Logic
    const source = document.getElementById('search-source').value;
    if (!input) return;

    currentSearch = { name: input, source };
    currentPage = page;

    resultsContainer.innerHTML = '<div class="flex items-center justify-center h-full"><i class="fas fa-spinner fa-spin text-4xl text-emerald-500"></i></div>';

    try {
        let list = [];
        if (source === 'all') {
            // Aggregate Search
            const pageInfoEl = document.getElementById('page-info');
            if (pageInfoEl) pageInfoEl.innerText = `聚合搜索 (前20条/源)`;

            const promises = SOURCES.map(s =>
                fetch(`${API_BASE}/search?name=${encodeURIComponent(input)}&source=${s}&page=1`)
                    .then(res => res.json())
                    .then(data => data.map(item => ({ ...item, source: s })))
                    .catch(e => {
                        console.warn(`[聚合搜索] ${s} 源失败:`, e);
                        return [];
                    })
            );
            const results = await Promise.all(promises);
            list = results.flat();
        } else {
            // Single Source Search - 使用老版本简单逻辑
            const res = await fetch(`${API_BASE}/search?name=${encodeURIComponent(input)}&source=${source}&page=${page}`);

            if (!res.ok) {
                throw new Error(`搜索请求失败: ${res.status} ${res.statusText}`);
            }

            const data = await res.json();

            // 检查返回的数据是否为数组
            if (!Array.isArray(data)) {
                console.error('[Search] 后端返回非数组数据:', data);
                throw new Error(data.error || data.message || '搜索返回的数据格式错误');
            }

            list = data.map(item => ({ ...item, source }));

            const pageInfoEl = document.getElementById('page-info');
            if (pageInfoEl) pageInfoEl.innerText = `第 ${page} 页`;
        }
        renderResults(list);
    } catch (e) {
        console.error('[Search] 搜索失败:', e);
        resultsContainer.innerHTML = `<div class="text-center text-red-500 p-8">搜索出错: ${e.message}</div>`;
    }
}

function changePage(delta) {
    const source = document.getElementById('search-source').value;
    if (source === 'all') {
        alert('聚合搜索模式暂不支持翻页');
        return;
    }
    const newPage = currentPage + delta;
    if (newPage < 1) return;
    doSearch(newPage);
}

// ========== 热搜功能 ==========
let hotSearchCache = null;
let hotSearchCacheTime = 0;
const HOT_SEARCH_CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

async function fetchHotSearch(source = 'mg') {
    // 检查缓存（必须匹配 source）
    if (hotSearchCache &&
        hotSearchCache.source === source && // Add checking source
        Date.now() - hotSearchCacheTime < HOT_SEARCH_CACHE_DURATION) {
        return hotSearchCache;
    }

    try {
        const res = await fetch(`${API_BASE}/hotSearch?source=${source}`);
        if (!res.ok) {
            throw new Error(`获取热搜失败: ${res.status}`);
        }
        const data = await res.json();

        // 更新缓存
        hotSearchCache = data;
        // Ensure data also carries the source info if not present
        if (!hotSearchCache.source) hotSearchCache.source = source;

        hotSearchCacheTime = Date.now();

        return data;
    } catch (e) {
        console.error('[HotSearch] 获取热搜失败:', e);
        return null;
    }
}

function renderHotSearch(data) {
    const container = document.getElementById('search-results');
    const header = document.getElementById('search-results-header');

    // 隐藏表头
    if (header) {
        header.classList.add('hidden');
    }

    if (!container || !data || !data.list || data.list.length === 0) {
        // 显示默认空白状态
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full text-gray-400 space-y-4">
                <i class="fas fa-music text-6xl opacity-20"></i>
                <p>输入关键词开始搜索音乐</p>
            </div>
        `;
        return;
    }

    const sourceTag = getSourceTag(data.source);
    const keywords = data.list.slice(0, 20); // 最多显示20个热搜词

    container.innerHTML = `
        <div class="hot-search-container p-8">
            <div class="flex items-center mb-6">
                <i class="fas fa-fire text-orange-500 text-2xl mr-3"></i>
                <h3 class="text-xl font-bold text-gray-700">热门搜索</h3>
                <span class="ml-3">${sourceTag}</span>
            </div>
            <div class="hot-search-list grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                ${keywords.map((keyword, index) => `
                    <button onclick="handleHotSearchClick('${keyword.replace(/'/g, "\\'")}')" 
                            class="hot-search-item group flex items-center p-3 bg-white hover:bg-emerald-50 border border-gray-200 hover:border-emerald-400 rounded-lg transition-all shadow-sm hover:shadow-md overflow-hidden h-14">
                        <span class="rank flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold mr-3 ${index < 3 ? 'bg-gradient-to-r from-orange-400 to-red-500 text-white' : 'bg-gray-100 text-gray-500'
        }">
                            ${index + 1}
                        </span>
                        <span class="keyword flex-1 text-left text-sm font-medium text-gray-700 group-hover:text-emerald-600 truncate">
                            ${keyword}
                        </span>
                        <i class="fas fa-search text-xs text-gray-300 group-hover:text-emerald-500 transition-colors ml-2"></i>
                    </button>
                `).join('')}
            </div>
            <div class="mt-6 text-center">
                <button onclick="showInitialSearchState()" 
                        class="text-sm text-gray-400 hover:text-emerald-500 transition-colors">
                    <i class="fas fa-sync-alt mr-1"></i>
                    刷新热搜
                </button>
            </div>
        </div>
    `;

    // 动态检测溢出并应用滚动效果
    setTimeout(() => {
        const items = container.querySelectorAll('.hot-search-item .keyword');
        items.forEach(el => {
            if (el.scrollWidth > el.clientWidth) {
                const text = el.textContent.trim();
                el.classList.remove('truncate');
                // 使用 mask-image 实现渐变列表
                el.innerHTML = `
                    <div class="w-full overflow-hidden relative" style="mask-image: linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%); -webkit-mask-image: linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%);">
                        <div class="inline-block whitespace-nowrap animate-marquee hover-scroll-paused" style="will-change: transform;">
                             <span>${text}</span>
                             <span class="mx-8"></span>
                             <span>${text}</span>
                             <span class="mx-8"></span>
                        </div>
                    </div>
                `;
            }
        });
    }, 0);
}

function handleHotSearchClick(keyword) {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = keyword;
        doSearch();
    }
}

function showInitialSearchState() {
    const container = document.getElementById('search-results');
    const header = document.getElementById('search-results-header');

    // 隐藏表头
    if (header) {
        header.classList.add('hidden');
    }

    // 显示加载状态
    container.innerHTML = `
        <div class="flex flex-col items-center justify-center h-full text-gray-400 space-y-4">
            <i class="fas fa-spinner fa-spin text-4xl text-emerald-500"></i>
            <p>正在加载热门搜索...</p>
        </div>
    `;

    // 异步获取并显示热搜
    const sourceSelect = document.getElementById('search-source');
    const source = sourceSelect ? sourceSelect.value : 'wy';

    fetchHotSearch(source).then(data => {
        renderHotSearch(data);
    }).catch(err => {
        console.error('[HotSearch] 显示热搜失败:', err);
        // 失败时显示默认状态
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full text-gray-400 space-y-4">
                <i class="fas fa-music text-6xl opacity-20"></i>
                <p>输入关键词开始搜索音乐</p>
            </div>
        `;
    });
}


function getQualityTags(item) {
    const tags = [];
    const types = item.types || item._types || {};
    // Check various formats based on different source returns
    // Simplified check: usually types is array or object with keys like '320k', 'flac'

    // Normalize types check
    let has320 = false;
    let hasFlac = false;
    let hasHiRes = false;

    if (Array.isArray(types)) {
        has320 = types.some(t => t.type === '320k');
        hasFlac = types.some(t => t.type === 'flac');
        hasHiRes = types.some(t => t.type === 'flac24bit');
    } else {
        has320 = !!types['320k'];
        hasFlac = !!types['flac'];
        hasHiRes = !!types['flac24bit'];
    }

    if (hasHiRes) tags.push('<span class="px-1 py-0.5 rounded text-[10px] bg-yellow-100 text-yellow-700 border border-yellow-200 ml-1">HR</span>');
    else if (hasFlac) tags.push('<span class="px-1 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-700 border border-emerald-200 ml-1">SQ</span>');
    else if (has320) tags.push('<span class="px-1 py-0.5 rounded text-[10px] bg-blue-100 text-blue-700 border border-blue-200 ml-1">HQ</span>');

    return tags.join('');
}

function getSourceTag(source) {
    const colors = {
        kw: 'bg-yellow-50 text-yellow-600 border-yellow-200',
        kg: 'bg-blue-50 text-blue-600 border-blue-200',
        tx: 'bg-green-50 text-green-600 border-green-200',
        wy: 'bg-red-50 text-red-600 border-red-200',
        mg: 'bg-pink-50 text-pink-600 border-pink-200'
    };
    const names = { kw: '酷我', kg: '酷狗', tx: 'QQ', wy: '网易', mg: '咪咕' };
    const color = colors[source] || 'bg-gray-50 text-gray-600 border-gray-200';
    const name = names[source] || source.toUpperCase();
    return `<span class="px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${color} mr-2">${name}</span>`;
}



// Helper for loose image paths
function getImgUrl(item) {
    return item.img || item.pic || item.picture || (item.meta && item.meta.picUrl) || (item.album && item.album.picUrl) || (item.al && item.al.picUrl) || '/music/assets/logo.svg';
}

function renderResults(list) {
    const container = document.getElementById('search-results');
    const header = document.getElementById('search-results-header');

    // 显示表头
    if (header) {
        header.classList.remove('hidden');
    }

    container.innerHTML = '';

    // [Fix] 确保每个歌曲都有唯一的 ID，防止批量操作时因为 ID 缺失(undefined)导致只能选中一个
    // 很多源(如酷狗、咪咕)返回的原始数据可能只有 hash 或 copyrightsId 而没有 id 字段
    if (list && list.length > 0) {
        list.forEach((item, idx) => {
            if (!item.id || item.id === 'undefined') {
                item.id = item.songmid || item.songId || item.hash || item.copyrightId || item.mid || item.mediaMid || `temp_${Date.now()}_${idx}`;
            }
        });
    }

    currentPlaylist = list;

    if (!list || list.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-400 p-8">未找到相关结果</div>';
        updatePaginationInfo(0, 0, 0);
        return;
    }

    // Pagination
    const totalItems = list.length;
    let itemsPerPage = settings.itemsPerPage === 'all' ? totalItems : parseInt(settings.itemsPerPage);
    const totalPages = Math.ceil(totalItems / itemsPerPage);

    // Bounds check
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
    const pageList = list.slice(startIndex, endIndex);

    pageList.forEach((item, pageIndex) => {
        const actualIndex = startIndex + pageIndex; // Index in full list
        const row = document.createElement('div');
        row.className = 'grid grid-cols-12 gap-4 p-3 hover:bg-gray-50 border-b border-gray-50 items-center text-sm group transition-colors';

        // Image
        const imgUrl = getImgUrl(item);

        const isSelected = selectedItems.has(String(item.id));

        // Grid Layout:
        // Mobile (<640px): Index(2) + Title(8) + Actions(2) = 12 (Artist/Album/Time Hidden)
        // SM (640-768px): Index(1) + Title(7) + Artist(3) + Actions(1) = 12 (Album/Time Hidden)
        // MD (768-1024px): Index(1) + Title(6) + Artist(3) + Time(1) + Actions(1) = 12 (Album Hidden)
        // LG (>1024px): Index(1) + Title(4) + Artist(3) + Album(2) + Time(1) + Actions(1) = 12

        row.innerHTML = `
            <!-- Index -->
            <div class="col-span-2 sm:col-span-1 text-center font-mono text-gray-400 text-xs md:text-sm flex items-center justify-center">
                ${batchMode ? `
                    <input type="checkbox" 
                           class="batch-checkbox w-4 h-4 text-emerald-600 rounded" 
                           data-song-id="${item.id}"
                           ${isSelected ? 'checked' : ''}
                    onclick="event.stopPropagation(); handleBatchSelect('${String(item.id)}', this.checked);">
                ` : `<span class="index-num">${actualIndex + 1}</span>`}
            </div>

            <!-- Title (Image + Text) -->
            <div class="col-span-8 sm:col-span-7 md:col-span-6 lg:col-span-4 flex items-center overflow-hidden pr-2">
                <div class="relative w-10 h-10 md:w-12 md:h-12 mr-3 md:mr-4 flex-shrink-0 group cursor-pointer">
                     <img data-src="${imgUrl}" src="/music/assets/logo.svg" 
                          class="lazy-image w-full h-full rounded-lg object-cover shadow-sm group-hover:shadow-md transition-all group-hover:scale-105 duration-300" 
                          alt="${item.name}"
                          onerror="this.src='/music/assets/logo.svg'"
                          onclick="playSong(${JSON.stringify(item).replace(/"/g, '&quot;')}, ${actualIndex})">
                     <div class="absolute inset-0 bg-black/20 rounded-lg hidden group-hover:flex items-center justify-center transition-all"
                          onclick="playSong(${JSON.stringify(item).replace(/"/g, '&quot;')}, ${actualIndex})">
                        <i class="fas fa-play text-white text-xs md:text-sm"></i>
                     </div>
                </div>
                <div class="min-w-0 flex-1 flex flex-col justify-center overflow-hidden">
                    <div class="font-bold text-gray-800 text-sm md:text-base leading-tight hover:text-emerald-600 cursor-pointer transition-colors" 
                         onclick="playSong(${JSON.stringify(item).replace(/"/g, '&quot;')}, ${actualIndex})">
                         ${createMarqueeHtml(item.name)}
                    </div>
                    <div class="flex items-center gap-1 mt-0.5 md:mt-1">
                         ${getSourceTag(item.source)}
                         ${getQualityTags(item)}
                    </div>
                </div>
            </div>

            <!-- Artist (Hidden on Mobile) -->
            <div class="hidden sm:block sm:col-span-3 md:col-span-3 lg:col-span-3 text-gray-600 text-sm md:text-base truncate flex items-center hover:text-emerald-600 transition-colors cursor-pointer"
                 title="${item.singer}"
                 onclick="event.stopPropagation(); document.getElementById('search-input').value = '${item.singer.replace(/'/g, "\\'")}'; doSearch();">
                ${item.singer}
            </div>

            <!-- Album (Hidden until LG) -->
            <div class="hidden lg:block lg:col-span-2 text-gray-500 text-sm truncate flex items-center" title="${item.albumName || ''}">
                ${item.albumName || '-'}
            </div>

            <!-- Duration (Hidden until MD) -->
            <div class="hidden md:block md:col-span-1 text-gray-400 text-sm font-mono text-center flex items-center justify-center">
                ${item.interval || '--:--'}
            </div>

            <!-- Actions -->
            <div class="col-span-2 sm:col-span-1 flex items-center justify-end gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                <button class="p-1.5 hover:bg-emerald-50 rounded text-emerald-600 transition-colors" 
                        title="播放" 
                        onclick="event.stopPropagation(); playSong(${JSON.stringify(item).replace(/"/g, '&quot;')}, ${actualIndex})">
                    <i class="fas fa-play w-4 h-4"></i>
                </button>
                <button class="p-1.5 hover:bg-blue-50 rounded text-blue-600 transition-colors" 
                        title="下载" 
                        onclick="event.stopPropagation(); downloadSong(${JSON.stringify(item).replace(/"/g, '&quot;')})">
                    <i class="fas fa-download w-4 h-4"></i>
                </button>
                ${currentSearchScope !== 'network' ? `
                <button class="p-1.5 hover:bg-red-50 rounded text-red-600 transition-colors" 
                        title="删除" 
                        onclick="event.stopPropagation(); deleteSingleSong('${item.id}')">
                    <i class="fas fa-trash w-4 h-4"></i>
                </button>
                ` : ''}
            </div>
        `;


        container.appendChild(row);
    });

    // Update pagination info
    updatePaginationInfo(startIndex + 1, endIndex, totalItems);

    // Init Lazy Loader
    lazyLoadImages();
}

// Generic Marquee Helper
function createMarqueeHtml(text, className = '') {
    // Simple heuristic: if text length > 8 (approx), make it scroll
    // Ideally we check scrollWidth, but for list generation string length is a cheap proxy
    if (text.length > 8) {
        const gap = '<span class="mx-6"></span>';
        return `
        <div class="overflow-hidden whitespace-nowrap w-full ${className}">
            <div class="inline-block animate-marquee hover:pause-animation">
                <span>${text}</span>${gap}<span>${text}</span>${gap}
            </div>
        </div>`;
    }
    return `<div class="truncate ${className}">${text}</div>`;
}

// Lazy Loading Logic
let imageObserver;

function lazyLoadImages() {
    // If IntersectionObserver is supported
    if ('IntersectionObserver' in window) {
        if (imageObserver) {
            imageObserver.disconnect();
        }

        imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const src = img.getAttribute('data-src');

                    if (src) {
                        img.src = src;
                        img.onload = () => {
                            img.classList.remove('opacity-0'); // Optional fade-in if we add class
                            img.removeAttribute('data-src');
                        };
                        img.onerror = () => {
                            img.src = '/music/assets/logo.svg';
                        };
                    }
                    observer.unobserve(img);
                }
            });
        }, {
            rootMargin: '100px 0px', // Load before it comes into view
            threshold: 0.01
        });

        const images = document.querySelectorAll('img.lazy-image');
        images.forEach(img => {
            imageObserver.observe(img);
        });
    } else {
        // Fallback for older browsers
        const images = document.querySelectorAll('img.lazy-image');
        images.forEach(img => {
            const src = img.getAttribute('data-src');
            if (src) img.src = src;
        });
    }
}


// Playback Logic

let currentQuality = '128k'; // 当前播放音质
let hintTimeout = null;

async function playSong(song, index, forceQuality = null) {
    currentIndex = index;
    currentPlayingSong = song;
    updatePlayerInfo(song);

    // 处理切换提示的显示与隐藏
    const hint = document.getElementById('toggle-hint');
    if (hint) {
        // 重置为可见：清理内联样式，恢复 CSS 类定义的默认状态 (opacity-80, max-h-8, mt-2)
        hint.style.opacity = '';
        hint.style.maxHeight = '';
        hint.style.marginTop = '';
        hint.classList.remove('opacity-0');

        if (hintTimeout) clearTimeout(hintTimeout);
        hintTimeout = setTimeout(() => {
            // 强制使用内联样式隐藏并收起占位
            hint.style.opacity = '0';
            hint.style.maxHeight = '0px';
            hint.style.marginTop = '0px';
        }, 5000);
    }

    // 显示加载状态
    setPlayerStatus('正在获取播放链接...');
    updatePlayButton(false); // 暂停按钮状态

    try {
        // 智能音质选择
        const quality = forceQuality || window.QualityManager.getBestQuality(
            song,
            settings.preferredQuality || '320k'
        );
        currentQuality = quality;

        console.log(`[Player] 播放歌曲: ${song.name} - ${song.singer} [${quality}]`);

        const res = await fetch(`${API_BASE}/url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ songInfo: song, quality })
        });

        if (!res.ok) {
            // [Improvement] Try to get detailed error JSON from server
            let errorMsg = `HTTP ${res.status}`;
            try {
                const errData = await res.json();
                if (errData.error) errorMsg = errData.error;
            } catch (e) { /* ignore JSON parse error */ }
            throw new Error(errorMsg);
        }

        const result = await res.json();

        if (result.url) {
            audio.src = result.url;

            // 尝试播放
            try {
                await audio.play();
                currentQuality = result.type || quality;
                setPlayerStatus(`播放中 (${window.QualityManager.getQualityDisplayName(currentQuality)})`);
                updatePlayButton(true);

                // 保存播放历史
                savePlayHistory(song, currentQuality);

                console.log(`[Player] 播放成功: ${result.url.substring(0, 50)}...`);
            } catch (playError) {
                console.error('[Player] 自动播放被阻止:', playError);
                setPlayerStatus('请点击播放按钮');
            }
        } else {
            throw new Error('服务器未返回播放链接');
        }
    } catch (error) {
        console.error('[Player] 播放失败:', error);

        const isSourceError = error.message.includes('自定义源') || error.message.includes('not supported');

        // 尝试降级重试
        const nextQuality = window.QualityManager.getNextLowerQuality(currentQuality);
        const canRetry = nextQuality && !forceQuality && !isSourceError;

        if (canRetry) {
            console.log(`[Player] 尝试降级到 ${nextQuality} 重试...`);
            setPlayerStatus(`播放失败，尝试降级到 ${window.QualityManager.getQualityDisplayName(nextQuality)}...`);

            setTimeout(() => {
                playSong(song, index, nextQuality);
            }, 1000);
        } else {
            // 无法重试，显示错误并自动下一首
            setPlayerStatus('播放失败，即将跳过...');
            showError(`播放失败: ${error.message}`);

            // 延迟后自动播放下一首
            setTimeout(() => {
                if (playMode === 'single') {
                    // 单曲循环模式下如果出错，强制切换到下一首，避免死循环
                    let nextIndex = currentIndex + 1;
                    if (nextIndex >= currentPlaylist.length) nextIndex = 0;
                    playSong(currentPlaylist[nextIndex], nextIndex);
                } else {
                    playNext();
                }
            }, 2000);
        }
    }
}

// 设置播放器状态文本
function setPlayerStatus(text) {
    const statusEl = document.getElementById('player-status');
    if (statusEl) {
        statusEl.innerText = text;
    }
}

// 保存播放历史
function savePlayHistory(song, quality) {
    try {
        const history = JSON.parse(localStorage.getItem('play_history') || '[]');
        history.unshift({
            ...song,
            quality,
            playedAt: Date.now()
        });
        // 只保留最近 50 条
        localStorage.setItem('play_history', JSON.stringify(history.slice(0, 50)));
    } catch (e) {
        console.error('[Player] 保存播放历史失败:', e);
    }
}

// 显示错误提示（现代化 Toast）
function showError(message) {
    // 移除旧的提示
    const oldToast = document.querySelector('.error-toast');
    if (oldToast) oldToast.remove();

    const toast = document.createElement('div');
    toast.className = 'error-toast fixed bottom-24 right-4 bg-red-500 text-white px-4 py-3 rounded-lg shadow-lg z-50 max-w-sm animate-slide-in';
    toast.innerHTML = `
        <div class="flex items-center gap-2">
            <i class="fas fa-exclamation-circle"></i>
            <span>${message}</span>
        </div>
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('opacity-0', 'transition-opacity');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}


function updatePlayerInfo(song) {
    // Bottom Player
    document.getElementById('player-title').innerText = song.name;
    document.getElementById('player-artist').innerText = song.singer;

    const imgUrl = getImgUrl(song);

    const setImg = (id, src) => {
        const el = document.getElementById(id);
        if (el) {
            el.src = src;
            el.onerror = () => { el.src = '/music/assets/logo.svg'; };
        }
    };

    setImg('player-cover', imgUrl);
    setImg('sidebar-cover', imgUrl);
    setImg('detail-cover', imgUrl);

    // Sidebar Mini Info
    document.getElementById('sidebar-song-info').classList.remove('hidden');
    document.getElementById('sidebar-song-name').innerText = song.name;
    document.getElementById('sidebar-singer').innerText = song.singer;

    // Detail View Info (Lyrics Page)
    // Detail View Info (Lyrics Page)
    const detailTitle = document.getElementById('detail-title');
    const detailContainer = document.getElementById('detail-title-container');

    if (detailTitle && detailContainer) {
        // Reset
        detailTitle.classList.remove('animate-marquee');
        detailTitle.innerText = song.name;

        // Wait for render to check width
        setTimeout(() => {
            if (detailTitle.scrollWidth > detailContainer.clientWidth) {
                // Duplicate text for seamless scroll (Text + Gap + Text + Gap)
                // We use -50% translation, so we need two identical halves.
                const gap = '<span class="mx-8"></span>';
                detailTitle.innerHTML = `<span>${song.name}</span>${gap}<span>${song.name}</span>${gap}`;
                detailTitle.classList.add('animate-marquee');
            }
        }, 100);
    }

    const detailArtist = document.getElementById('detail-artist');
    if (detailArtist) detailArtist.innerText = song.singer;


    // Update Like Button State (Collection Status)
    const btnLike = document.getElementById('player-like-btn');

    // Check if song is in ANY list (except 'default' - temporary list)
    // Actually, 'default' is usually the play queue. We check 'loveList' and 'userList'.
    let isCollected = false;
    if (currentListData) {
        if (currentListData.loveList.some(s => s.id === song.id)) isCollected = true;
        if (currentListData.userList.some(ul => ul.list.some(s => s.id === song.id))) isCollected = true;
    }

    // Bind click to Open Modal
    btnLike.onclick = (e) => {
        e.stopPropagation();
        openPlaylistAddModal();
    };

    if (isCollected) {
        btnLike.classList.add('text-red-500');
        btnLike.classList.remove('text-gray-300');
    } else {
        btnLike.classList.remove('text-red-500');
        btnLike.classList.add('text-gray-300');
    }
}

function togglePlay() {
    if (audio.paused) {
        audio.play().catch(e => console.error("Play blocked:", e));
        updatePlayButton(true);
    } else {
        audio.pause();
        updatePlayButton(false);
    }
}

function updatePlayButton(isPlaying) {
    const btn = document.getElementById('btn-play');
    btn.innerHTML = isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play ml-1"></i>';
}

function playNext() {
    if (currentPlaylist.length === 0) return;

    let nextIndex;

    switch (playMode) {
        case 'single':
            // 单曲循环：继续播放当前歌曲
            nextIndex = currentIndex;
            break;

        case 'random':
            // 随机播放：随机选择一首（避免重复播放当前歌曲）
            if (currentPlaylist.length === 1) {
                nextIndex = 0;
            } else {
                do {
                    nextIndex = Math.floor(Math.random() * currentPlaylist.length);
                } while (nextIndex === currentIndex);
            }
            break;

        case 'order':
            // 顺序播放：播放下一首，到末尾停止
            nextIndex = currentIndex + 1;
            if (nextIndex >= currentPlaylist.length) {
                console.log('[PlayMode] 顺序播放已到末尾');
                return; // 停止播放
            }
            break;

        case 'list':
        default:
            // 列表循环：播放下一首，到末尾回到开头
            nextIndex = currentIndex + 1;
            if (nextIndex >= currentPlaylist.length) nextIndex = 0;
            break;
    }

    playSong(currentPlaylist[nextIndex], nextIndex);
}

function playPrev() {
    if (currentPlaylist.length === 0) return;

    let prevIndex;

    switch (playMode) {
        case 'single':
            // 单曲循环：继续播放当前歌曲
            prevIndex = currentIndex;
            break;

        case 'random':
            // 随机播放：随机选择一首（避免重复播放当前歌曲）
            if (currentPlaylist.length === 1) {
                prevIndex = 0;
            } else {
                do {
                    prevIndex = Math.floor(Math.random() * currentPlaylist.length);
                } while (prevIndex === currentIndex);
            }
            break;

        case 'order':
        case 'list':
        default:
            // 列表循环 & 顺序播放：播放上一首
            prevIndex = currentIndex - 1;
            if (prevIndex < 0) prevIndex = currentPlaylist.length - 1;
            break;
    }

    playSong(currentPlaylist[prevIndex], prevIndex);
}

// Audio Events
audio.addEventListener('timeupdate', () => {
    const current = audio.currentTime;
    const duration = audio.duration;

    document.getElementById('time-current').innerText = formatTime(current);
    document.getElementById('time-total').innerText = formatTime(duration);

    const pct = (current / duration) * 100;
    document.getElementById('progress-bar').style.width = `${pct}%`;
});

// 歌曲播放结束时根据播放模式处理
audio.addEventListener('ended', () => {
    playNext();
});

function seek(e) {
    const container = document.getElementById('progress-container');
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = x / rect.width;
    const time = pct * audio.duration;
    audio.currentTime = time;
}

// ========== 音量控制 ==========
let currentVolume = 0.75; // 默认音量 75%
let isMuted = false;

// 初始化音量
audio.volume = currentVolume;
updateVolumeUI();

// 设置音量
function setVolume(e) {
    const container = document.getElementById('volume-container');
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width)); // 限制在 0-1 之间

    currentVolume = pct;
    audio.volume = currentVolume;
    isMuted = false;

    updateVolumeUI();

    // 保存到本地存储
    try {
        localStorage.setItem('lx_volume', currentVolume.toString());
    } catch (e) {
        console.error('[Volume] 保存音量失败:', e);
    }
}

// 切换静音
function toggleMute() {
    isMuted = !isMuted;
    audio.muted = isMuted;
    updateVolumeUI();
}

// 更新音量 UI
function updateVolumeUI() {
    const volumeBar = document.getElementById('volume-bar');
    const volumeIcon = document.getElementById('volume-icon');

    if (volumeBar) {
        const displayVolume = isMuted ? 0 : currentVolume;
        volumeBar.style.width = `${displayVolume * 100}%`;
    }

    if (volumeIcon) {
        if (isMuted || currentVolume === 0) {
            volumeIcon.className = 'fas fa-volume-mute w-4';
        } else if (currentVolume < 0.5) {
            volumeIcon.className = 'fas fa-volume-down w-4';
        } else {
            volumeIcon.className = 'fas fa-volume-up w-4';
        }
    }
}

// ========== 播放模式 ==========
let playMode = 'list'; // 'list': 列表循环, 'single': 单曲循环, 'random': 随机播放, 'order': 顺序播放

// 设置播放模式
function setPlayMode(mode) {
    playMode = mode;
    updatePlayModeUI();

    // 保存到本地存储
    try {
        localStorage.setItem('lx_play_mode', mode);
    } catch (e) {
        console.error('[PlayMode] 保存播放模式失败:', e);
    }

    // 显示提示
    const modeNames = {
        'list': '列表循环',
        'single': '单曲循环',
        'random': '随机播放',
        'order': '顺序播放'
    };

    // Close menu (Mobile/Click mode)
    const menu = document.getElementById('play-mode-menu');
    if (menu) menu.classList.remove('force-visible');

    const toast = document.createElement('div');
    toast.className = 'fixed bottom-28 right-4 bg-emerald-500 text-white px-4 py-2 rounded-lg shadow-lg z-50';
    toast.innerHTML = `<i class="fas fa-check-circle mr-2"></i>${modeNames[mode]}`;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('opacity-0', 'transition-opacity');
        setTimeout(() => toast.remove(), 300);
    }, 1500);
}

// 切换播放模式菜单（适配移动端点击）
function togglePlayModeMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('play-mode-menu');
    if (menu) {
        menu.classList.toggle('force-visible');
    }
}

// 监听全局点击，关闭菜单
document.addEventListener('click', (e) => {
    const menu = document.getElementById('play-mode-menu');
    const btn = document.getElementById('play-mode-btn');
    if (menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
        menu.classList.remove('force-visible');
    }
});

// 更新播放模式 UI
function updatePlayModeUI() {
    const btn = document.getElementById('play-mode-btn');
    const options = document.querySelectorAll('.play-mode-option');

    // 更新按钮图标和颜色
    if (btn) {
        const icons = {
            'list': 'fa-redo',
            'single': 'fa-redo-alt',
            'random': 'fa-random',
            'order': 'fa-play'
        };
        const colors = {
            'list': 'text-emerald-500',
            'single': 'text-blue-500',
            'random': 'text-purple-500',
            'order': 'text-gray-500'
        };

        const icon = btn.querySelector('i');
        if (icon) {
            icon.className = `fas ${icons[playMode]}`;
            btn.className = `${colors[playMode]} hover:opacity-80 transition-colors`;
            btn.title = getPlayModeName(playMode);
        }
    }

    // 高亮当前选中的选项
    options.forEach(opt => {
        if (opt.dataset.mode === playMode) {
            opt.classList.add('bg-emerald-50', 'font-bold');
        } else {
            opt.classList.remove('bg-emerald-50', 'font-bold');
        }
    });
}

function getPlayModeName(mode) {
    const names = {
        'list': '列表循环',
        'single': '单曲循环',
        'random': '随机播放',
        'order': '顺序播放'
    };
    return names[mode] || '未知';
}

function formatTime(s) {
    if (!s || isNaN(s)) return '00:00';
    const min = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${min < 10 ? '0' + min : min}:${sec < 10 ? '0' + sec : sec}`;
}

// Update pagination information display
function updatePaginationInfo(start, end, total) {
    const infoEl = document.getElementById('pagination-info');
    if (infoEl) {
        if (total === 0) {
            infoEl.textContent = '暂无数据';
        } else {
            infoEl.textContent = `显示 ${start}-${end} 条，共 ${total} 条`;
        }
    }
}

// Load settings from localStorage
function loadSettings() {
    try {
        const saved = localStorage.getItem('lx_settings');
        if (saved) {
            const loaded = JSON.parse(saved);
            settings = { ...settings, ...loaded };
            console.log('[Settings] 加载设置成功:', settings);
        }
    } catch (e) {
        console.error('[Settings] 加载设置失败:', e);
    }
}


// Expose functions to window for HTML access
window.switchTab = switchTab;
window.handleSearchKeyPress = handleSearchKeyPress;
window.doSearch = doSearch;
window.changePage = changePage;
window.handleHotSearchClick = handleHotSearchClick;
window.playSong = playSong;
window.togglePlay = togglePlay;
window.playNext = playNext;
window.playPrev = playPrev;
window.seek = seek;
// 音量控制
window.setVolume = setVolume;
window.toggleMute = toggleMute;
// 播放模式
window.setPlayMode = setPlayMode;
// --- Lyrics & Detail View Logic ---

let currentLyricLines = [];
let isLyricViewOpen = false;
let currentLyricIndex = -1;
let lyricPlayer = null; // LinePlayer instance for parsing and syncing
let isUserScrolling = false; // 用户是否正在手动滚动
let scrollLockTimeout = null; // 滚动锁定计时器
let isProgrammaticScroll = false; // 标记是否为程序自动滚动
const SCROLL_LOCK_DURATION = 5000; // 5秒后解除锁定

function toggleLyrics() {
    isLyricViewOpen = !isLyricViewOpen;
    const view = document.getElementById('view-player-detail');

    if (isLyricViewOpen) {
        view.classList.remove('hidden');
        // Trigger reflow
        void view.offsetWidth;
        view.classList.remove('translate-y-[100%]', 'opacity-0');

        // Update UI
        if (currentPlayingSong) {
            updateDetailInfo(currentPlayingSong);
            // If no lyrics yet, try fetch
            if (currentLyricLines.length === 0) {
                fetchLyric(currentPlayingSong);
            }
            // LinePlayer handles syncing automatically
        }
    } else {
        view.classList.add('translate-y-[100%]', 'opacity-0');
        setTimeout(() => {
            view.classList.add('hidden');
        }, 500); // match transition duration
    }
}

function updateDetailInfo(song) {
    document.getElementById('detail-title').innerText = song.name;
    document.getElementById('detail-artist').innerText = song.singer;
    const imgUrl = getImgUrl(song);
    // Use high res image if possible or same URL
    document.getElementById('detail-cover').src = imgUrl; // Need bigger res?
    document.getElementById('detail-bg-cover').src = imgUrl;
}

async function fetchLyric(song) {
    if (!song) {
        return;
    }

    // 支持两种数据结构:
    // 1. 搜索结果: song.songmid, song.source 在顶层
    // 2. 收藏列表: song.songmid, song.source 可能在 meta 中
    // 3. 不同平台字段名差异: songmid vs songId
    let songmid = song.songmid || song.songId;
    let source = song.source;

    // 如果顶层没有,尝试从 meta 中获取
    if (!songmid && song.meta) {
        songmid = song.meta.songmid || song.meta.songId;
    }
    if (!source && song.meta) {
        source = song.meta.source;
    }

    // 如果还是没有必要的数据,退出
    if (!songmid || !source) {
        console.warn('[Lyric] 歌曲缺少必要的字段 songmid/songId 或 source:', song);
        return;
    }

    document.getElementById('lyric-content').innerHTML = '<p class="text-gray-400 text-lg animate-pulse">正在加载歌词...</p>';
    currentLyricLines = [];

    try {
        // 构建完整的URL参数，包含酷狗和咪咕所需的所有字段
        // KuGou (kg) needs: name, hash, interval
        // MiGu (mg) needs: copyrightId, lrcUrl, mrcUrl, trcUrl (优先，避免调用getMusicInfo API)
        const params = new URLSearchParams({
            source,
            songmid,
            name: song.name || song.songname || '',
            singer: song.singer || song.singername || '',
            hash: song.hash || '',
            interval: song.interval || song.duration || '',
            copyrightId: song.copyrightId || '',
            albumId: song.albumId || '',
            lrcUrl: song.lrcUrl || '',
            mrcUrl: song.mrcUrl || '',
            trcUrl: song.trcUrl || ''
        });

        const url = `${API_BASE}/lyric?${params.toString()}`;
        const res = await fetch(url);

        if (!res.ok) {
            throw new Error(`Fetch lyric failed: ${res.status}`);
        }

        const data = await res.json();
        const lrc = data.lyric || data.lrc || '';
        const tlyric = data.tlyric || '';

        if (!lrc) {
            renderLyric([]);
            return;
        }

        // Check if LinePlayer is available
        if (!window.LinePlayer) {
            console.error('[Lyric] LinePlayer not loaded');
            renderLyric([], '歌词解析器加载失败');
            return;
        }

        // Initialize LinePlayer if not exists
        if (!lyricPlayer) {
            lyricPlayer = new window.LinePlayer({
                offset: 0,
                rate: 1,
                onPlay: (lineNum, text, curTime) => {
                    syncLyricByLineNum(lineNum);
                },
                onSetLyric: (lines, offset) => {
                    currentLyricLines = lines;
                    renderLyric(lines);
                }
            });
        }

        // Set lyric with translation as extended lyric
        const extendedLyrics = [];
        if (tlyric) extendedLyrics.push(tlyric);

        lyricPlayer.setLyric(lrc, extendedLyrics);

        // Start playing if audio is already playing
        if (!audio.paused && audio.currentTime > 0) {
            lyricPlayer.play(audio.currentTime * 1000);
        }

    } catch (e) {
        console.error('[Lyric] Failed:', e);
        renderLyric([], '暂无歌词');
    }
}

// Helper to scroll to active line
function scrollToActiveLine(force = false) {
    if (isUserScrolling && !force) return;

    const containerBox = document.getElementById('lyric-container');
    const lyricContent = document.getElementById('lyric-content');
    if (!containerBox || !lyricContent) return;

    const lines = lyricContent.children;
    if (lines.length === 0) return;

    // Use currentLyricIndex, default to 0 if invalid
    let targetIndex = currentLyricIndex;
    if (targetIndex < 0 || targetIndex >= lines.length) targetIndex = 0;

    const currentLine = lines[targetIndex];
    if (!currentLine) return;

    const lineTop = currentLine.offsetTop;

    // 计算目标参考线位置
    let offsetInContainer;
    const cover = document.getElementById('detail-cover');
    // 桌面端且封面存在时，对齐到封面中心
    if (window.innerWidth >= 768 && cover) {
        const coverRect = cover.getBoundingClientRect();
        const containerRect = containerBox.getBoundingClientRect();
        // 计算封面中心相对于容器顶部的偏移量
        offsetInContainer = (coverRect.top + coverRect.height / 2) - containerRect.top;
    } else {
        // 移动端或无封面时，保持 38% 黄金分割位
        offsetInContainer = containerBox.clientHeight * 0.38;
    }

    const targetScroll = lineTop - offsetInContainer;

    // 标记为程序滚动
    isProgrammaticScroll = true;

    // Clear any existing forced cleanup timer
    if (window.programmaticScrollTimer) clearTimeout(window.programmaticScrollTimer);

    containerBox.scrollTo({
        top: targetScroll,
        behavior: 'smooth'
    });

    // 1000ms 后清除标记 (给予平滑滚动足够的时间)
    window.programmaticScrollTimer = setTimeout(() => {
        isProgrammaticScroll = false;
        window.programmaticScrollTimer = null;
    }, 800);
}

// Sync lyric by line number (called by LinePlayer)
function syncLyricByLineNum(lineNum) {
    // Always update the highlight classes regardless of scroll
    const container = document.getElementById('lyric-content');
    if (!container) return;

    const lines = container.children;

    // Check if index actually changed to update classes
    if (lineNum !== currentLyricIndex) {
        currentLyricIndex = lineNum;

        // Remove active class from previous line
        const prev = container.querySelector('.active');
        if (prev) prev.classList.remove('active');

        // Add active class to current line
        if (lineNum >= 0 && lineNum < lines.length) {
            lines[lineNum].classList.add('active');
        }
    }

    // Perform scroll (scrollToActiveLine handles isUserScrolling check)
    scrollToActiveLine();
}

// 节流函数
let scrollThrottleTimer = null;

// 用户手动滚动歌词
function handleLyricScroll() {
    // 忽略程序自动滚动
    if (isProgrammaticScroll) {
        return;
    }

    // 标记用户正在滚动
    isUserScrolling = true;

    // 显示指示器
    const indicator = document.getElementById('lyric-scroll-indicator');
    if (indicator) {
        indicator.classList.remove('hidden');
        indicator.style.display = 'flex';
    }

    // 清除之前的计时器
    if (scrollLockTimeout) {
        clearTimeout(scrollLockTimeout);
    }

    // 优化：如果有正在等待的帧，直接返回，不重复计算 (Leading throttle behavior)
    if (scrollThrottleTimer) {
        return;
    }

    // 使用 requestAnimationFrame 实时更新（约16ms一次，流畅无延迟）
    scrollThrottleTimer = requestAnimationFrame(() => {
        updateScrollIndicator();
        scrollThrottleTimer = null;
    });

    // 5秒后恢复自动滚动并隐藏指示器
    scrollLockTimeout = setTimeout(() => {
        isUserScrolling = false;
        scrollLockTimeout = null;

        // 隐藏指示器
        if (indicator) {
            indicator.classList.add('hidden');
            indicator.style.display = 'none';
        }

        // 清除滚动目标高亮
        const lyricContent = document.getElementById('lyric-content');
        if (lyricContent) {
            const lines = lyricContent.children;
            for (let i = 0; i < lines.length; i++) {
                lines[i].classList.remove('scroll-target');
            }
        }

        // 恢复后立即同步到当前播放位置
        if (lyricPlayer && !audio.paused) {
            // 确保内部状态同步
            lyricPlayer.play(audio.currentTime * 1000);
        }

        // [Fix] 立即滚动回当前歌词，不等待下一句更新
        scrollToActiveLine(true);

    }, SCROLL_LOCK_DURATION);
}

// 更新滚动指示器（显示当前对准的歌词时间）
function updateScrollIndicator() {
    const container = document.getElementById('lyric-container');
    const indicator = document.getElementById('lyric-scroll-indicator');
    const lyricContent = document.getElementById('lyric-content');

    // 如果不在滚动状态，清除所有高亮并返回
    if (!container || !indicator || !lyricContent || !isUserScrolling) {
        if (lyricContent) {
            const lines = lyricContent.children;
            for (let i = 0; i < lines.length; i++) {
                lines[i].classList.remove('scroll-target');
            }
        }
        return;
    }


    // 初始化虚线位置（只在第一次调用时设置，之后固定不动）
    if (!indicator.dataset.positioned) {
        let referenceTop;
        const cover = document.getElementById('detail-cover');
        const parent = indicator.parentElement;
        const parentRect = parent.getBoundingClientRect();

        if (window.innerWidth >= 768 && cover) {
            // 桌面端：对齐封面中心
            const coverRect = cover.getBoundingClientRect();
            referenceTop = (coverRect.top + coverRect.height / 2) - parentRect.top;
        } else {
            // 移动端：38%
            referenceTop = parentRect.height * 0.38;
        }

        indicator.style.top = `${referenceTop}px`;
        indicator.dataset.positioned = 'true';
    }

    // 直接获取虚线的实际屏幕位置
    const indicatorRect = indicator.getBoundingClientRect();
    const referenceY = indicatorRect.top + indicatorRect.height / 2;

    const lines = lyricContent.children;
    let overlapIndex = -1;
    let closestIndex = -1;
    let minDist = Infinity;

    // 遍历查找重叠或最近的歌词行
    // 改为纯几何碰撞检测，比 elementFromPoint 更可靠
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const rect = line.getBoundingClientRect();

        // 1. 检查是否重叠 (Green line inside the rect)
        if (referenceY >= rect.top && referenceY <= rect.bottom) {
            overlapIndex = i;
        }

        // 2. 检查距离 (Fallback)
        const center = rect.top + rect.height / 2;
        const dist = Math.abs(center - referenceY);
        if (dist < minDist) {
            minDist = dist;
            closestIndex = i;
        }
    }

    // 优先使用重叠的行，其次使用距离最近的行
    const targetIndex = overlapIndex !== -1 ? overlapIndex : closestIndex;

    let targetTime = 0;
    if (targetIndex !== -1 && lines[targetIndex]) {
        targetTime = parseFloat(lines[targetIndex].dataset.time) / 1000;
    }

    // 高亮对应的歌词行
    for (let i = 0; i < lines.length; i++) {
        if (i === targetIndex) {
            lines[i].classList.add('scroll-target');
        } else {
            lines[i].classList.remove('scroll-target');
        }
    }

    // 更新时间显示
    const timeDisplay = indicator.querySelector('.time-display');
    if (timeDisplay && targetTime > 0) {
        const minutes = Math.floor(targetTime / 60);
        const seconds = Math.floor(targetTime % 60);
        timeDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
}

// renderLyric function - generates DOM elements for each lyric line
function renderLyric(lines, emptyMsg = '暂无歌词') {
    const container = document.getElementById('lyric-content');
    container.innerHTML = '';

    if (lines.length === 0) {
        container.innerHTML = `<p class="text-gray-400 text-lg font-medium">${emptyMsg}</p>`;
        return;
    }

    // Create fragment for better performance
    const frag = document.createDocumentFragment();

    lines.forEach((line, idx) => {
        // Create line container with classes mirroring the desktop app's logic
        const div = document.createElement('div');
        div.className = `lyric-line relative py-2 px-1 text-center transition-all duration-300`;
        div.dataset.time = line.time;
        div.dataset.index = idx;

        // Click to seek
        div.onclick = () => {
            // line.time 是毫秒，audio.currentTime 需要秒
            audio.currentTime = line.time / 1000;

            // 解除滚动锁定
            isUserScrolling = false;
            if (scrollLockTimeout) {
                clearTimeout(scrollLockTimeout);
                scrollLockTimeout = null;
            }

            // 隐藏指示器
            const indicator = document.getElementById('lyric-scroll-indicator');
            if (indicator) {
                indicator.classList.add('hidden');
                indicator.style.display = 'none';
            }

            // [Fix] 清除所有的高亮样式 (scroll-target)
            const allLines = document.querySelectorAll('.lyric-line');
            allLines.forEach(l => l.classList.remove('scroll-target'));

            // 播放
            audio.play();
            updatePlayButton(true);
        };

        // Inner content wrapper
        const contentDiv = document.createElement('div');
        contentDiv.className = 'line-content';

        // Main lyric text
        const span = document.createElement('span');
        span.className = 'font-lrc text-lg md:text-xl text-gray-500 transition-all block';
        span.textContent = line.text;
        contentDiv.appendChild(span);

        // Translation (if available)
        if (line.trans) {
            const transSpan = document.createElement('span');
            transSpan.className = 'extended text-sm md:text-base text-gray-400 mt-1 block';
            transSpan.textContent = line.trans;
            contentDiv.appendChild(transSpan);
        }

        div.appendChild(contentDiv);
        frag.appendChild(div);
    });

    container.appendChild(frag);

    // [Fix] Ensure we are in auto-scroll mode and centered on load
    isUserScrolling = false;
    // Force a scroll update after a short delay to ensure layout is ready
    setTimeout(() => {
        scrollToActiveLine(true);
    }, 50);
}


// syncLyric removed - LinePlayer handles all syncing via syncLyricByLineNum callback
// Audio timeupdate listener removed - LinePlayer automatically syncs lyrics

// Hook into PlaySong to clear/fetch lyrics
const originalPlaySong = window.playSong;
// We need to intercept playSong call in some way or just update playSong function?
// Since I can't override const declared in file easily without redefining,
// I will just modify the `playSong` function inside `app.js` using replace, OR
// I can just rely on `updatePlayerInfo` which is called by `playSong`.

// Let's modify `updatePlayerInfo` to also trigger generic 'song changed' event logic?
// No, I'll modify `playSong` via Replace.
// Wait, I can't easily replace the whole `playSong` as it's big.
// I will just Hook into `updatePlayerInfo` as it is called when song starts.
// Actually `updatePlayerInfo` is perfect.

const _originalUpdatePlayerInfo = updatePlayerInfo;
updatePlayerInfo = function (song) {
    _originalUpdatePlayerInfo(song);
    // Detail View update
    updateDetailInfo(song);
    // Fetch lyrics
    fetchLyric(song);
};

window.toggleLyrics = toggleLyrics;

// Initial
console.log('App.js loaded successfully');

// Initialize Favorites as hidden (collapsed)
const favList = document.getElementById('favorites-children');
if (favList) {
    favList.style.height = '0px';
    // favList.classList.add('hidden'); // using height transition instead
}

function toggleFavorites() {
    const list = document.getElementById('favorites-children');
    const arrow = document.getElementById('favorites-arrow');

    // Toggle logic
    if (list.style.height === '0px' || list.style.height === '') {
        list.style.height = 'auto'; // Estimate or auto
        list.style.height = list.scrollHeight + 'px'; // Smooth transition
        arrow.style.transform = 'rotate(0deg)'; // Arrow down
    } else {
        list.style.height = '0px';
        arrow.style.transform = 'rotate(-90deg)'; // Arrow right
    }
}

// Initial rotate for collapsed state
const favArrow = document.getElementById('favorites-arrow');
if (favArrow) favArrow.style.transform = 'rotate(-90deg)';


// Link SyncManager from user_sync.js
// Link SyncManager from user_sync.js
const syncManager = window.SyncManager;
let currentListData = null;
let syncModeResolve = null;

function switchSyncMode(mode) {
    const btnLocal = document.getElementById('btn-mode-local');
    const btnRemote = document.getElementById('btn-mode-remote');
    const formLocal = document.getElementById('sync-form-local');
    const formRemote = document.getElementById('sync-form-remote');

    if (mode === 'local') {
        btnLocal.className = "px-4 py-2 rounded-lg text-sm font-medium bg-emerald-100 text-emerald-700 ring-2 ring-emerald-500 transition-all";
        btnRemote.className = "px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all";
        formLocal.classList.remove('hidden');
        formRemote.classList.add('hidden');
    } else {
        btnLocal.className = "px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all";
        btnRemote.className = "px-4 py-2 rounded-lg text-sm font-medium bg-blue-100 text-blue-700 ring-2 ring-blue-500 transition-all";
        formLocal.classList.add('hidden');
        formRemote.classList.remove('hidden');
        // Reset Remote Flow
        handleRemoteBack();
    }
}

async function handleLocalLogin() {
    const user = document.getElementById('sync-local-user').value;
    const pass = document.getElementById('sync-local-pass').value;
    const statusEl = document.getElementById('sync-status');

    if (!user || !pass) {
        alert('请输入用户名和密码');
        return;
    }

    statusEl.innerHTML = '<i class="fas fa-spinner fa-spin text-emerald-500"></i> 正在登录...';

    try {
        syncManager.initLocal(user, pass);
        const success = await syncManager.client.login();

        if (success) {
            statusEl.innerHTML = '<i class="fas fa-check-circle text-emerald-500"></i> 登录成功，正在同步...';
            // Fetch List
            const listData = await syncManager.sync();
            currentListData = listData;
            renderMyLists(listData);

            // [Cache] Save list data immediately for offline availability / quick load
            localStorage.setItem('lx_list_data', JSON.stringify(listData));

            statusEl.innerHTML = `<i class="fas fa-check-circle text-emerald-500"></i> 已同步 (用户: ${user})`;
            // Save credentials to localStorage (Simple version)
            localStorage.setItem('lx_sync_mode', 'local'); // [Fix] Save mode
            localStorage.setItem('lx_sync_user', user);
            localStorage.setItem('lx_sync_pass', pass);
        } else {
            statusEl.innerHTML = '<i class="fas fa-times-circle text-red-500"></i> 登录失败: 用户名或密码错误';
        }
    } catch (e) {
        statusEl.innerHTML = `<i class="fas fa-exclamation-circle text-red-500"></i> 错误: ${e.message}`;
    }
}

function showSyncModeModal() {
    const modal = document.getElementById('sync-auth-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('sync-connect-form').classList.add('hidden');
    document.getElementById('sync-mode-selection').classList.remove('hidden');
}


function closeSyncModal() {
    const modal = document.getElementById('sync-auth-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    // Reset views
    document.getElementById('sync-connect-form').classList.remove('hidden');
    document.getElementById('sync-mode-selection').classList.add('hidden');

    if (syncModeResolve) {
        syncModeResolve('cancel');
        syncModeResolve = null;
    }
}

function selectSyncMode(mode) {
    const fullOverwrite = document.getElementById('sync-full-overwrite').checked;
    if (fullOverwrite && mode.startsWith('overwrite')) {
        mode += '_full';
    }

    if (syncModeResolve) {
        syncModeResolve(mode);
        syncModeResolve = null;
    }
    closeSyncModal();
}

function cancelSyncMode() {
    if (syncModeResolve) {
        syncModeResolve('cancel');
        syncModeResolve = null;
    }
    closeSyncModal();
}

function handleRemoteStep1() {
    const url = document.getElementById('sync-remote-url').value.trim();
    if (!url) {
        alert('请输入链接地址');
        return;
    }
    // Basic validation
    if (!url.match(/^(ws|http)s?:\/\//)) {
        alert('链接格式错误，应以 http://, https://, ws:// 或 wss:// 开头');
        return;
    }

    document.getElementById('sync-remote-step1').classList.add('hidden');
    document.getElementById('sync-remote-step2').classList.remove('hidden');
}

function handleRemoteBack() {
    document.getElementById('sync-remote-step1').classList.remove('hidden');
    document.getElementById('sync-remote-step2').classList.add('hidden');
    document.getElementById('sync-remote-code').value = ''; // Optional clear
}

function handleRemoteConnect() {
    const url = document.getElementById('sync-remote-url').value;
    const code = document.getElementById('sync-remote-code').value;
    const statusEl = document.getElementById('sync-status');

    if (!code) {
        alert('请输入连接码');
        return;
    }

    statusEl.innerHTML = '<i class="fas fa-spinner fa-spin text-blue-500"></i> 正在连接远程服务器...';

    try {
        syncManager.initRemote(url, code, {
            getData: async () => {
                // Try to load from cache first
                const cached = localStorage.getItem('lx_list_data');
                if (cached) {
                    try {
                        const data = JSON.parse(cached);
                        console.log('[Cache] 从缓存加载列表数据');
                        return data;
                    } catch (e) {
                        console.error('[Cache] 解析缓存失败:', e);
                    }
                }
                return currentListData || { defaultList: [], loveList: [], userList: [] };
            },
            setData: async (data) => {
                console.log('[Sync] 远程数据已同步:', data);
                // Save to cache
                localStorage.setItem('lx_list_data', JSON.stringify(data));
                // Update global
                currentListData = data;
                // Render UI
                renderMyLists(data);
                statusEl.innerHTML = '<i class="fas fa-check-circle text-blue-500"></i> 数据已同步';
            },
            getSyncMode: async () => {
                return new Promise((resolve) => {
                    syncModeResolve = resolve;
                    showSyncModeModal();
                });
            }
        });

        // Setup Callbacks
        syncManager.client.onLogin = async (success, msg) => {
            if (success) {
                statusEl.innerHTML = '<i class="fas fa-check-circle text-green-500"></i> 已连接 (等待同步...)';
                // Remove manual sync() call. Let the server drive the sync via RPC.

                // Save connection info and authInfo to localStorage
                localStorage.setItem('lx_sync_mode', 'remote');
                localStorage.setItem('lx_sync_url', url);
                localStorage.setItem('lx_sync_code', code);

                // Save authInfo for reconnection
                if (syncManager.client.authInfo) {
                    localStorage.setItem('lx_ws_auth', JSON.stringify(syncManager.client.authInfo));
                    console.log('[Cache] WS认证信息已保存');
                }
            } else {
                statusEl.innerHTML = `<i class="fas fa-times-circle text-red-500"></i> 连接失败: ${msg || '未知错误'}`;
            }
        };

        syncManager.client.connect();

    } catch (e) {
        statusEl.innerHTML = `<i class="fas fa-exclamation-circle text-red-500"></i> 错误: ${e.message}`;
    }
}

function renderMyLists(data) {
    const container = document.getElementById('my-lists-container');
    container.innerHTML = '';

    if (!data) return;

    // Helper to create list item
    const createItem = (id, name, icon, count) => {
        const div = document.createElement('div');
        div.className = "px-6 py-2 text-sm text-gray-600 hover:bg-gray-50 cursor-pointer flex items-center group transition-colors overflow-hidden";
        div.onclick = () => handleListClick(id);

        // Use createMarqueeHtml for list name
        const nameHtml = name.length > 8 ? createMarqueeHtml(name, 'flex-1') : `<span class="ml-2 flex-1 truncate">${name}</span>`;

        div.innerHTML = `
            <i class="fas ${icon} w-5 text-gray-400 group-hover:text-emerald-500 transition-colors flex-shrink-0"></i>
            ${name.length > 8 ? `<div class="ml-2 flex-1 overflow-hidden">${nameHtml}</div>` : nameHtml}
            <span class="text-xs text-gray-300 group-hover:text-gray-400 mr-2 flex-shrink-0">${count}</span>
            ${id !== 'default' && id !== 'love' ? `<i class="fas fa-trash text-gray-300 hover:text-red-500 hidden group-hover:block flex-shrink-0" onclick="handleRemoveList('${id}', event)"></i>` : ''}
        `;
        return div;
    };

    // Default List
    if (data.defaultList) {
        container.appendChild(createItem('default', '默认列表', 'fa-list', data.defaultList.length));
    }
    // Love List
    if (data.loveList) {
        container.appendChild(createItem('love', '我的收藏', 'fa-heart', data.loveList.length));
    }
    // User Lists
    if (data.userList) {
        data.userList.forEach(l => {
            const listLen = l.list ? l.list.length : 0;
            container.appendChild(createItem(l.id, l.name, 'fa-music', listLen));
        });
    }
}

function handleListClick(listId) {
    if (!currentListData) return;

    // Set current viewing list ID for batch operations
    window.currentViewingListId = listId;
    currentSearchScope = 'local_list';

    let list = [];
    let title = '';

    if (listId === 'default') {
        list = currentListData.defaultList;
        title = '默认列表';
    } else if (listId === 'love') {
        list = currentListData.loveList;
        title = '我的收藏';
    } else {
        const uList = currentListData.userList.find(l => l.id === listId);
        if (uList) {
            list = uList.list;
            title = uList.name;
        }
    }

    // Switch to Search View (as List View)
    // Manually handle tab switch to avoid 'network' reset
    document.querySelectorAll('[id^="view-"]').forEach(el => el.classList.add('hidden'));
    const activeView = document.getElementById('view-search');
    activeView.classList.remove('hidden');
    setTimeout(() => {
        activeView.classList.remove('opacity-0');
        activeView.classList.add('opacity-100');
    }, 10);

    // UI Updates
    document.getElementById('page-title').innerText = title;
    document.getElementById('search-input').value = '';
    document.getElementById('search-input').placeholder = `在 ${title} 中搜索...`;

    // Set Scope
    currentSearchScope = 'local_list';
    document.getElementById('search-source').classList.add('hidden'); // Hide selector

    // Render
    currentPlaylist = list; // Update global playlist
    currentPage = 1; // Reset pagination
    renderResults(list);
}

function handleFavoritesClick() {
    toggleFavorites(); // Toggle folder

    // Switch to Search View (Global Local)
    document.querySelectorAll('[id^="view-"]').forEach(el => el.classList.add('hidden'));
    const activeView = document.getElementById('view-search');
    activeView.classList.remove('hidden');
    setTimeout(() => activeView.classList.remove('opacity-0'), 10); // Simple fade

    // Highlight Header
    document.querySelectorAll('[id^="tab-"]').forEach(el => el.classList.remove('active-tab', 'text-emerald-600'));
    const favTab = document.getElementById('tab-favorites');
    if (favTab) {
        favTab.classList.add('active-tab'); // Styling
        // favTab inner content text color? The class `active-tab` has color.
    }

    // UI Updates
    document.getElementById('page-title').innerText = "我的收藏 (全部)";
    document.getElementById('search-input').value = '';
    document.getElementById('search-input').placeholder = "搜索所有收藏...";
    document.getElementById('search-source').classList.add('hidden');

    // Set Scope
    currentSearchScope = 'local_all';

    // Initial Render: Show Love List + Default List?
    // Or just show nice empty state "Search to find in all collections"
    // Let's show Love List as a default view for "Overview"
    if (currentListData) {
        renderResults(currentListData.loveList || []);
    } else {
        renderResults([]);
    }
}

function handleCreateList() {
    const name = prompt("请输入新歌单名称:");
    if (name && currentListData) {
        const newList = {
            id: 'list_' + Date.now(),
            name: name,
            source: 'local',
            list: []
        };
        currentListData.userList.push(newList);
        // Sync
        pushDataChange().then(() => {
            renderMyLists(currentListData);
            alert('歌单创建成功');
        });
    }
}

async function toggleLove() {
    if (!currentListData || currentIndex < 0) return;
    const song = currentPlaylist[currentIndex];

    const index = currentListData.loveList.findIndex(s => s.id === song.id);
    if (index >= 0) {
        currentListData.loveList.splice(index, 1);
    } else {
        currentListData.loveList.push(song);
    }

    // Update UI immediately
    updatePlayerInfo(song);

    // Sync
    await pushDataChange();
}

function handleRemoveList(listId, event) {
    event.stopPropagation();
    if (!confirm('确定要删除此歌单吗？')) return;

    if (currentListData) {
        const index = currentListData.userList.findIndex(l => l.id === listId);
        if (index >= 0) {
            currentListData.userList.splice(index, 1);
            pushDataChange().then(() => {
                renderMyLists(currentListData);
            });
        }
    }
}

// Auto-restore on page load
window.addEventListener('load', () => {
    // 0. Load settings first
    loadSettings();

    // Update UI to match settings
    const selectEl = document.getElementById('items-per-page-select');
    if (selectEl && settings.itemsPerPage) {
        selectEl.value = settings.itemsPerPage.toString();
    }

    // [新增] 恢复音量设置
    try {
        const savedVolume = localStorage.getItem('lx_volume');
        if (savedVolume) {
            currentVolume = parseFloat(savedVolume);
            audio.volume = currentVolume;
            updateVolumeUI();
            console.log('[Volume] 已恢复音量设置:', currentVolume);
        }
    } catch (e) {
        console.error('[Volume] 恢复音量设置失败:', e);
    }

    // [新增] 恢复播放模式设置
    try {
        const savedMode = localStorage.getItem('lx_play_mode');
        if (savedMode && ['list', 'single', 'random', 'order'].includes(savedMode)) {
            playMode = savedMode;
            updatePlayModeUI();
            console.log('[PlayMode] 已恢复播放模式:', playMode);
        } else {
            // 默认模式
            updatePlayModeUI();
        }
    } catch (e) {
        console.error('[PlayMode] 恢复播放模式失败:', e);
    }

    // 1. Restore cached list data
    const cachedList = localStorage.getItem('lx_list_data');
    if (cachedList) {
        try {
            currentListData = JSON.parse(cachedList);
            renderMyLists(currentListData);
            console.log('[Cache] 已恢复缓存的列表数据');
        } catch (e) {
            console.error('[Cache] 恢复列表数据失败:', e);
        }
    }

    // 2. Auto-reconnect or auto-login
    const syncMode = localStorage.getItem('lx_sync_mode');

    if (syncMode === 'local') {
        // Local mode: auto-login
        const user = localStorage.getItem('lx_sync_user');
        const pass = localStorage.getItem('lx_sync_pass');
        if (user && pass) {
            document.getElementById('sync-local-user').value = user;
            document.getElementById('sync-local-pass').value = pass;
            console.log('[Cache] 自动登录本地账号:', user);
            handleLocalLogin();
        }
    } else if (syncMode === 'remote') {
        // Remote mode: auto-reconnect
        const url = localStorage.getItem('lx_sync_url');
        const code = localStorage.getItem('lx_sync_code');
        const authStr = localStorage.getItem('lx_ws_auth');

        if (url && code) {
            document.getElementById('sync-remote-url').value = url;
            document.getElementById('sync-remote-code').value = code;

            // Check if we have saved authInfo
            if (authStr) {
                try {
                    const authInfo = JSON.parse(authStr);
                    console.log('[Cache] 使用缓存的认证信息自动重连...');

                    // Pre-populate authInfo in client
                    syncManager.initRemote(url, code, {
                        getData: async () => {
                            const cached = localStorage.getItem('lx_list_data');
                            return cached ? JSON.parse(cached) : { defaultList: [], loveList: [], userList: [] };
                        },
                        setData: async (data) => {
                            localStorage.setItem('lx_list_data', JSON.stringify(data));
                            currentListData = data;
                            renderMyLists(data);
                            document.getElementById('sync-status').innerHTML = '<i class="fas fa-check-circle text-blue-500"></i> 数据已同步';
                        },
                        getSyncMode: async () => {
                            return new Promise((resolve) => {
                                syncModeResolve = resolve;
                                showSyncModeModal();
                            });
                        }
                    });

                    syncManager.client.authInfo = authInfo; // Reuse saved auth
                    syncManager.client.onLogin = (success) => {
                        if (success) {
                            console.log('[Cache] 自动重连成功');
                            document.getElementById('sync-status').innerHTML = '<i class="fas fa-check-circle text-green-500"></i> 已自动重连';
                        } else {
                            console.log('[Cache] 自动重连失败,需要手动重新配对');
                            localStorage.removeItem('lx_ws_auth'); // Clear invalid auth
                        }
                    };
                    syncManager.client.connect();
                } catch (e) {
                    console.error('[Cache] 自动重连失败:', e);
                }
            } else {
                console.log('[Cache] 无缓存认证信息,请手动连接');
            }
        }
    }
});

window.switchSyncMode = switchSyncMode;
window.handleLocalLogin = handleLocalLogin;

// Helper to Push Changes to Remote
async function pushDataChange() {
    if (!currentListData) return;
    try {
        await window.SyncManager.push(currentListData);
        console.log('Data Pushed to Remote');
    } catch (e) {
        console.error('Push Failed', e);
    }
}
window.handleRemoteConnect = handleRemoteConnect;
window.handleCreateList = handleCreateList;
window.handleListClick = handleListClick;
window.toggleLove = toggleLove;
window.handleRemoveList = handleRemoveList;
window.handleRemoveList = handleRemoveList;
window.toggleFavorites = toggleFavorites;
window.handleFavoritesClick = handleFavoritesClick;
window.handleRemoteStep1 = handleRemoteStep1;
window.handleRemoteBack = handleRemoteBack;


// ========================================
// Custom Source Management (自定义源管理)
// ========================================

let customSourceMode = 'file'; // 'file' or 'url'

// 切换上传方式
function switchCustomSourceMode(mode) {
    customSourceMode = mode;

    // 更新按钮样式
    document.getElementById('btn-source-file').className = mode === 'file'
        ? 'px-4 py-2 text-sm font-medium bg-emerald-100 text-emerald-700 rounded-lg'
        : 'px-4 py-2 text-sm font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200';

    document.getElementById('btn-source-url').className = mode === 'url'
        ? 'px-4 py-2 text-sm font-medium bg-emerald-100 text-emerald-700 rounded-lg'
        : 'px-4 py-2 text-sm font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200';

    // 切换显示
    document.getElementById('custom-source-file').classList.toggle('hidden', mode !== 'file');
    document.getElementById('custom-source-url').classList.toggle('hidden', mode !== 'url');
}

// 处理本地文件上传
async function handleFileUpload(input) {
    const file = input.files[0];
    if (!file) return;

    // 验证文件类型
    if (!file.name.endsWith('.js')) {
        showError('请选择 .js 文件');
        return;
    }

    // 更新文件名显示
    // document.getElementById('file-name-display').textContent = file.name;

    try {
        // 读取文件内容
        const content = await file.text();

        // 先验证脚本
        showInfo('正在验证脚本...');
        const validation = await fetch('/api/custom-source/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ script: content })
        }).then(r => r.json());

        if (!validation.valid) {
            showError(`脚本无效: ${validation.error}`);
            input.value = '';
            // document.getElementById('file-name-display').textContent = '点击选择 .js 文件';
            return;
        }

        // 验证通过，上传
        showInfo(`验证通过，正在上传 "${validation.metadata.name}"...`);
        await uploadCustomSource(file.name, content, 'file');

        showSuccess(`已上传: ${validation.metadata.name} v${validation.metadata.version}`);

        // 重置输入
        input.value = '';
        // document.getElementById('file-name-display').textContent = '点击选择 .js 文件';

        // 刷新源列表
        loadCustomSources();
    } catch (error) {
        console.error('[CustomSource] 上传失败:', error);
        showError(`上传失败: ${error.message}`);
    }
}

// 处理远程链接导入
// 处理远程链接导入
async function handleUrlImport() {
    // [Fix] UI does not have an input box, use Prompt
    const input = prompt("请输入自定义源脚本的 URL 地址 (.js):");
    if (input === null) return; // User cancelled

    const url = input.trim();

    if (!url) {
        showError('请输入链接地址');
        return;
    }

    if (!url.endsWith('.js')) {
        showError('链接必须指向 .js 文件');
        return;
    }

    try {
        // 获取文件名
        const filename = url.split('/').pop();

        // 从服务器代理下载
        const response = await fetch(`/api/custom-source/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, filename })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || `HTTP ${response.status}`);
        }

        const result = await response.json();
        showSuccess(`已导入: ${result.filename}`);

        // 刷新源列表
        loadCustomSources();
    } catch (error) {
        console.error('[CustomSource] 导入失败:', error);
        showError(`导入失败: ${error.message}`);
    }
}

// 上传自定义源到服务器
async function uploadCustomSource(filename, content, type) {
    const response = await fetch('/api/custom-source/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            filename,
            content,
            type,
            username: currentListData?.username || 'default' // 使用当前登录用户
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(error || `HTTP ${response.status}`);
    }

    return await response.json();
}

// 加载自定义源列表 (随时可以调用以刷新界面)
async function loadCustomSources() {
    await renderCustomSources();
}

// ========== 自定义源管理逻辑 ==========

async function fetchCustomSources() {
    try {
        const username = currentListData?.username || 'default';
        const res = await fetch(`/api/custom-source/list?username=${username}`);
        if (!res.ok) throw new Error('Failed to fetch sources');
        return await res.json();
    } catch (err) {
        console.error('Fetch sources failed:', err);
        return [];
    }
}

async function renderCustomSources() {
    const list = await fetchCustomSources();

    // 渲染目标容器 ID 列表：模态框内 & 设置界面内
    const targetIds = ['custom-sources-list', 'settings-custom-sources-list'];

    targetIds.forEach(containerId => {
        const container = document.getElementById(containerId);
        if (!container) return;

        // 空状态
        if (list.length === 0) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center p-6 text-gray-400">
                    <i class="fas fa-box-open text-3xl mb-3 opacity-30"></i>
                    <p class="text-sm">暂无自定义源</p>
                    ${containerId === 'custom-sources-list' ?
                    `<button onclick="document.getElementById('script-file').click()" class="mt-3 text-emerald-600 hover:text-emerald-700 text-sm font-medium">即刻上传</button>`
                    : ''}
                </div>
            `;
            return;
        }

        container.innerHTML = '';

        list.forEach(source => {
            const div = document.createElement('div');
            // 设置界面使用稍紧凑的样式，模态框使用标准样式 (这里为了统一先用一样的，微调边距)
            div.className = `bg-white p-4 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all mb-3 relative group`;

            // 格式化支持的源
            let supportedBadges = '';
            if (source.supportedSources && source.supportedSources.length > 0) {
                const sourceMap = {
                    'kg': { name: '酷狗', color: 'bg-blue-100 text-blue-700' },
                    'kw': { name: '酷我', color: 'bg-yellow-100 text-yellow-700' },
                    'tx': { name: 'QQ', color: 'bg-green-100 text-green-700' },
                    'wy': { name: '网易', color: 'bg-red-100 text-red-700' },
                    'mg': { name: '咪咕', color: 'bg-pink-100 text-pink-700' }
                };

                supportedBadges = `<div class="flex flex-wrap gap-2 mt-2">
                ${source.supportedSources.map(s => {
                    const info = sourceMap[s] || { name: s, color: 'bg-gray-100 text-gray-600' };
                    return `<span class="px-2 py-0.5 rounded-md text-[10px] font-semibold ${info.color}">${info.name}</span>`;
                }).join('')}
            </div>`;
            } else {
                supportedBadges = `<div class="mt-2 text-[10px] text-gray-400 italic">未知支持源</div>`;
            }

            const size = source.size && !isNaN(source.size) ? (source.size / 1024).toFixed(1) + ' KB' : '未知大小';
            let date = '未知日期';
            try {
                if (source.uploadTime) date = new Date(source.uploadTime).toLocaleDateString();
            } catch (e) { }

            /* Status Badge Logic */
            let statusBadge = '';
            let errorMsg = '';

            if (source.enabled) {
                if (source.status === 'success') {
                    statusBadge = `<span class="text-[10px] bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded-full border border-emerald-100 flex items-center gap-1"><i class="fas fa-check-circle"></i>正常</span>`;
                } else if (source.status === 'failed') {
                    statusBadge = `<span class="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded-full border border-red-100 flex items-center gap-1 cursor-help" title="${source.error || '加载失败'}"><i class="fas fa-times-circle"></i>失败</span>`;
                    errorMsg = `<div class="text-[10px] text-red-500 mt-1 flex items-start gap-1 p-1.5 bg-red-50 rounded"><i class="fas fa-info-circle mt-0.5 flex-shrink-0"></i><span class="break-all">${source.error || '未知错误'}</span></div>`;
                } else {
                    // If enabled but no status (yet), assume initializing or loaded before status tracking
                    statusBadge = `<span class="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full border border-blue-100 flex items-center gap-1"><i class="fas fa-circle-notch fa-spin"></i>加载...</span>`;
                }
            }

            div.innerHTML = `
            <div class="flex justify-between items-start">
                <div class="flex-1 pr-4 min-w-0">
                    <div class="flex items-center gap-2 mb-1 flex-wrap">
                        <div class="flex items-center gap-2">
                            <i class="fas fa-file-code text-emerald-500"></i>
                            <h4 class="font-bold text-gray-800 text-sm line-clamp-1 break-all" title="${source.name}">${source.name}</h4>
                        </div>
                        <div class="flex items-center gap-2">
                             <span class="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded shrink-0">v${source.version}</span>
                             ${statusBadge}
                        </div>
                    </div>
                    ${errorMsg}
                    <div class="flex items-center text-[10px] text-gray-400 space-x-2 mt-1">
                        <span><i class="fas fa-user mr-1"></i>${source.author || '未知'}</span>
                        <span class="hidden sm:inline"><i class="far fa-hdd mr-1"></i>${size}</span>
                    </div>
                    ${supportedBadges}
                </div>
                
                <div class="flex flex-col items-end gap-2 shrink-0">
                    <button onclick="toggleSource('${source.id}', ${source.enabled})" 
                            class="px-3 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap w-20 flex justify-center items-center ${source.enabled
                    ? (source.status === 'failed' ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200')
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}">
                        ${source.enabled ? '已启用' : '已禁用'}
                    </button>
                    
                    <div class="flex items-center gap-1">
                        ${source.enabled && source.status === 'failed' ? `
                        <button onclick="reloadSource('${source.id}')" 
                                class="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                                title="尝试重新加载">
                            <i class="fas fa-sync-alt text-sm"></i>
                        </button>` : ''}
                        
                        <button onclick="deleteSource('${source.id}')" 
                                class="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                title="删除">
                            <i class="fas fa-trash-alt text-sm"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
            container.appendChild(div);
        });
    });
}

// 重新加载源 (强制重新启用)
async function reloadSource(sourceId) {
    try {
        const username = currentListData?.username || 'default';
        const response = await fetch('/api/custom-source/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, sourceId, enabled: true }) // Force enable triggers reload
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        showInfo('正在重新加载...');
        // Wait a bit for server to process
        setTimeout(() => {
            renderCustomSources();
        }, 1000);

    } catch (error) {
        console.error('Reload failed:', error);
        showError(`重载请求失败: ${error.message}`);
    }
}

// 切换状态
async function toggleSource(sourceId, currentEnabled) {
    try {
        const username = currentListData?.username || 'default';
        const response = await fetch('/api/custom-source/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, sourceId, enabled: !currentEnabled }) // Send new state
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        // 刷新列表
        await renderCustomSources();
        showSuccess(currentEnabled ? '已禁用' : '已启用');
    } catch (error) {
        console.error('[CustomSource] 切换状态失败:', error);
        showError(`操作失败: ${error.message}`);
    }
}

// 删除源
async function deleteSource(sourceId) {
    if (!confirm('确定要删除这个自定义源吗？')) return;

    try {
        const username = currentListData?.username || 'default';
        const response = await fetch('/api/custom-source/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, sourceId })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        showSuccess('已删除');
        await renderCustomSources();
    } catch (error) {
        console.error('[CustomSource] 删除失败:', error);
        showError(`删除失败: ${error.message}`);
    }
}

// 模态框控制
function openCustomSourceModal() {
    const modal = document.getElementById('custom-source-modal');
    const content = document.getElementById('custom-source-modal-content');
    if (modal) modal.classList.remove('hidden');

    // 渲染列表
    renderCustomSources();

    setTimeout(() => {
        if (content) {
            content.classList.remove('scale-95', 'opacity-0');
            content.classList.add('scale-100', 'opacity-100');
        }
    }, 10);
}

function closeCustomSourceModal() {
    const modal = document.getElementById('custom-source-modal');
    const content = document.getElementById('custom-source-modal-content');

    if (content) {
        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
    }

    setTimeout(() => {
        if (modal) modal.classList.add('hidden');
    }, 300);
}


// ========================================
// Playlist Add Modal (Collections)
// ========================================

// ========================================
// Playlist Add Modal (Collections)
// ========================================

async function openPlaylistAddModal() {
    if (!currentListData) {
        showError('请先登录后使用收藏功能');
        return;
    }
    // [Fix] Use currentPlayingSong instead of currentPlaylist[currentIndex]
    // currentPlaylist might have changed if user searched for something else
    const song = currentPlayingSong;
    if (!song) {
        showError('当前没有正在播放的歌曲');
        return;
    }

    const modal = document.getElementById('playlist-add-modal');
    const content = document.getElementById('playlist-add-modal-content');
    const listContainer = document.getElementById('playlist-add-list');
    const nameLabel = document.getElementById('playlist-add-song-name');

    if (!modal) return;

    // Set Info
    nameLabel.innerText = song.name;

    // Render List Items (Grid Buttons)
    listContainer.innerHTML = '';

    // Helper to create grid item
    const createGridItem = (listId, listName, count, isIncluded) => {
        const btn = document.createElement('button');
        // Base styles
        let className = "relative h-14 rounded-lg text-sm font-bold transition-all duration-200 flex items-center justify-center gap-1 shadow-sm overflow-hidden ";

        // Active/Inactive styles
        if (isIncluded) {
            className += "bg-red-500 text-white shadow-md scale-[1.02] ring-2 ring-red-200";
        } else {
            className += "bg-red-50 text-red-500 hover:bg-red-100 hover:shadow";
        }

        btn.className = className;
        btn.onclick = () => handleTogglePlaylist(listId, btn); // Use handler wrapper

        btn.innerHTML = `
            <span class="truncate max-w-[80%]">${listName}</span>
            ${isIncluded ? '<i class="fas fa-check text-xs ml-1 opacity-80"></i>' : ''}
        `;
        return btn;
    };

    // 1. My Love
    const loveList = currentListData.loveList || [];
    const isLoved = loveList.some(s => s.id === song.id);
    listContainer.appendChild(createGridItem('love', '我的收藏', loveList.length, isLoved));

    // 2. User Lists
    if (currentListData.userList) {
        currentListData.userList.forEach(list => {
            const isIncluded = list.list.some(s => s.id === song.id);
            listContainer.appendChild(createGridItem(list.id, list.name, list.list.length, isIncluded));
        });
    }

    // Show Modal
    modal.classList.remove('hidden');
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);
}

function closePlaylistAddModal() {
    const modal = document.getElementById('playlist-add-modal');
    const content = document.getElementById('playlist-add-modal-content');

    if (content) {
        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
    }

    setTimeout(() => {
        if (modal) modal.classList.add('hidden');
        // Update Player Info to refresh heart icon state
        if (currentPlayingSong) {
            updatePlayerInfo(currentPlayingSong);
        }
    }, 300);
}

// 绑定模态框背景点击
const playlistAddModal = document.getElementById('playlist-add-modal');
if (playlistAddModal) {
    playlistAddModal.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            closePlaylistAddModal();
        }
    });
}


// Helper: Clean song data to match LX.Music.MusicInfoOnline interface
function cleanSongData(song) {
    if (!song) return null;

    // Ensure meta exists, defaulting to empty object if missing
    const sourceMeta = song.meta || {};

    // 1. Resolve Song ID (songId or songmid or id)
    // Different sources/APIs place the ID in different spots
    let songId = sourceMeta.songId || song.songId || song.songmid || song.id;

    // 2. Resolve Album Name
    let albumName = sourceMeta.albumName || song.albumName || song.album?.name || '';

    // 3. Resolve Pic URL
    let picUrl = sourceMeta.picUrl || song.picUrl || song.img || song.album?.cover;

    // Common Meta
    const meta = {
        songId: songId,
        albumName: albumName,
        picUrl: picUrl,
        qualitys: sourceMeta.qualitys || song.qualitys,
        _qualitys: sourceMeta._qualitys || song._qualitys,
        albumId: sourceMeta.albumId || song.albumId
    };

    // Source Reference: src/types/music.d.ts
    // 补全特定源的字段
    if (song.source === 'kg') {
        meta.hash = sourceMeta.hash || song.hash;
    } else if (song.source === 'tx') {
        meta.strMediaMid = sourceMeta.strMediaMid || song.strMediaMid || song.mediaMid;
        meta.id = sourceMeta.id || song.songId || song.id; // tx often uses numerical ID here
        meta.albumMid = sourceMeta.albumMid || song.albumMid;
    } else if (song.source === 'mg') {
        meta.copyrightId = sourceMeta.copyrightId || song.copyrightId || songId; // fallback
        meta.lrcUrl = sourceMeta.lrcUrl || song.lrcUrl;
        meta.mrcUrl = sourceMeta.mrcUrl || song.mrcUrl;
        meta.trcUrl = sourceMeta.trcUrl || song.trcUrl;
    }

    // Common Base
    const cleanSong = {
        id: song.id, // Keep the main unique ID (often prefix_id)
        name: song.name,
        singer: song.singer,
        source: song.source,
        interval: song.interval,
        meta: meta
    };

    // Remove undefined keys
    const removeUndefined = (obj) => {
        Object.keys(obj).forEach(key => {
            if (obj[key] === undefined) delete obj[key];
            else if (typeof obj[key] === 'object' && obj[key] !== null) removeUndefined(obj[key]);
        });
        return obj;
    };

    return removeUndefined(cleanSong);
}


// Modified handler for Grid Buttons
async function handleTogglePlaylist(listId, btnElement) {
    if (!currentListData || !currentPlayingSong) return;
    const song = currentPlayingSong;

    // Determine current state based on data, NOT UI
    // (UI might represent old state if sync failed, but we assume optimistic UI for responsiveness)

    let targetListArray;
    if (listId === 'love') {
        targetListArray = currentListData.loveList;
    } else {
        const uList = currentListData.userList.find(l => l.id === listId);
        if (uList) targetListArray = uList.list;
    }

    if (!targetListArray) return;

    const isCurrentlyIncluded = targetListArray.some(s => s.id === song.id);
    const willAdd = !isCurrentlyIncluded;

    // Optimistic UI Update
    updateGridItemVisuals(btnElement, willAdd);

    try {
        if (willAdd) {
            targetListArray.unshift(cleanSongData(song));
        } else {
            const idx = targetListArray.findIndex(s => s.id === song.id);
            if (idx >= 0) targetListArray.splice(idx, 1);
        }

        await pushDataChange();

        // No toast needed for rapid toggling, visual feedback on button is enough
        // showSuccess(willAdd ? '已添加' : '已移除'); 

        // Update My Lists sidebar
        renderMyLists(currentListData);
    } catch (e) {
        showError('同步失败: ' + e.message);
        // Revert UI if failed
        updateGridItemVisuals(btnElement, !willAdd);
    }
}

function updateGridItemVisuals(btn, isIncluded) {
    if (isIncluded) {
        btn.className = "relative h-14 rounded-lg text-sm font-bold transition-all duration-200 flex items-center justify-center gap-1 shadow-sm overflow-hidden bg-red-500 text-white shadow-md scale-[1.02] ring-2 ring-red-200";
        // Update icon if needed, though innerHTML replacement is easiest
        const textSpan = btn.querySelector('span'); // Assuming first span is text
        const text = textSpan ? textSpan.innerText : btn.innerText;
        btn.innerHTML = `
            <span class="truncate max-w-[80%]">${text}</span>
            <i class="fas fa-check text-xs ml-1 opacity-80"></i>
        `;
    } else {
        btn.className = "relative h-14 rounded-lg text-sm font-bold transition-all duration-200 flex items-center justify-center gap-1 shadow-sm overflow-hidden bg-red-50 text-red-500 hover:bg-red-100 hover:shadow";
        const textSpan = btn.querySelector('span');
        const text = textSpan ? textSpan.innerText : btn.innerText;
        btn.innerHTML = `<span class="truncate max-w-[80%]">${text}</span>`;
    }
}


// Legacy compatibility wrapper if needed, or just remove
async function toggleSongInList(listId, isAdd) {
    // Deprecated in favor of handleTogglePlaylist
    console.warn("toggleSongInList is deprecated");
}


// ========================================
// 导出函数到 window (ES Module 需要显式暴露)
// ========================================

// Custom Source functions
window.openCustomSourceModal = openCustomSourceModal;
window.closeCustomSourceModal = closeCustomSourceModal;
window.switchCustomSourceMode = switchCustomSourceMode;
window.handleFileUpload = handleFileUpload;
window.handleUrlImport = handleUrlImport;

// Playlist Modal functions
window.openPlaylistAddModal = openPlaylistAddModal;
window.closePlaylistAddModal = closePlaylistAddModal;
window.toggleSongInList = toggleSongInList;


// 新版函数名
window.toggleSource = toggleSource;
window.deleteSource = deleteSource;
window.reloadSource = reloadSource;

// 兼容旧版函数名 (Alias)
window.toggleCustomSource = toggleSource;
window.deleteCustomSource = deleteSource;
window.importFromUrl = handleUrlImport;

// Core functions
window.switchTab = switchTab;
window.handleSearchKeyPress = handleSearchKeyPress;
window.doSearch = doSearch;
window.changePage = changePage;
window.handleHotSearchClick = handleHotSearchClick;
window.playSong = playSong;
window.togglePlay = togglePlay;
window.playNext = playNext;
window.playPrev = playPrev;
window.seek = seek;
window.changeQualityPreference = changeQualityPreference;

// Volume
window.setVolume = setVolume;
window.toggleMute = toggleMute;
window.setPlayMode = setPlayMode;

// Lyrics
window.toggleLyrics = toggleLyrics;

// Favorites & Lists
window.toggleFavorites = toggleFavorites;
window.handleFavoritesClick = handleFavoritesClick;
window.handleListClick = handleListClick;
window.handleCreateList = handleCreateList;
window.handleRemoveList = handleRemoveList;
window.toggleLove = toggleLove;

// Sync functions
window.switchSyncMode = switchSyncMode;
window.handleLocalLogin = handleLocalLogin;
window.handleRemoteConnect = handleRemoteConnect;
window.handleRemoteStep1 = handleRemoteStep1;
window.handleRemoteBack = handleRemoteBack;
window.selectSyncMode = selectSyncMode;
window.cancelSyncMode = cancelSyncMode;
window.closeSyncModal = closeSyncModal;

// Audio event listeners for lyric syncing
if (audio) {
    audio.addEventListener('play', () => {
        if (lyricPlayer && lyricPlayer.lines && lyricPlayer.lines.length > 0) {
            lyricPlayer.play(audio.currentTime * 1000);
        }
    });

    audio.addEventListener('pause', () => {
        if (lyricPlayer) {
            lyricPlayer.pause();
        }
    });

    audio.addEventListener('seeked', () => {
        if (lyricPlayer && lyricPlayer.lines && lyricPlayer.lines.length > 0) {
            if (!audio.paused) {
                lyricPlayer.play(audio.currentTime * 1000);
            } else {
                lyricPlayer.pause();
                const lineNum = lyricPlayer._findCurLineNum(audio.currentTime * 1000);
                if (lineNum >= 0) {
                    syncLyricByLineNum(lineNum);
                }
            }
        }
    });
}

// ========================================
// UI Helper Functions (Toast Notifications)
// ========================================

// 显示成功提示
function showSuccess(message) {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-24 right-4 bg-emerald-500 text-white px-4 py-3 rounded-lg shadow-lg z-50 animate-slide-in';
    toast.innerHTML = `
        <div class="flex items-center gap-2">
            <i class="fas fa-check-circle"></i>
            <span>${message}</span>
        </div>
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('opacity-0', 'transition-opacity');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

// 显示信息提示
function showInfo(message) {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-24 right-4 bg-blue-500 text-white px-4 py-3 rounded-lg shadow-lg z-50 animate-slide-in';
    toast.innerHTML = `
        <div class="flex items-center gap-2">
            <i class="fas fa-info-circle"></i>
            <span>${message}</span>
        </div>
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('opacity-0', 'transition-opacity');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

// 显示错误提示
function showError(message) {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-24 right-4 bg-red-500 text-white px-4 py-3 rounded-lg shadow-lg z-50 animate-slide-in';
    toast.innerHTML = `
        <div class="flex items-center gap-2">
            <i class="fas fa-exclamation-circle"></i>
            <span>${message}</span>
        </div>
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('opacity-0', 'transition-opacity');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// 监听窗口大小变化
window.addEventListener('resize', () => {
    const indicator = document.getElementById('lyric-scroll-indicator');
    if (indicator) {
        indicator.dataset.positioned = '';
    }
});

// ========== 页面初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Init] 页面加载完成');

    // 预加载自定义源数据，确保设置界面和模态框打开时有数据
    loadCustomSources();

    // 默认在搜索界面，直接显示热搜
    if (typeof showInitialSearchState === 'function') {
        showInitialSearchState();
    }

    // [Fix] Listen to scroll event for real-time highlighting
    const lyricContainer = document.getElementById('lyric-container');
    if (lyricContainer) {
        // Core user interaction detection
        // 只有当用户真的 "摸" 了或者是 "滑" 了，才认为是用户滚动
        // 纯 scroll 事件会被 scrollTo 触发，所以不能仅依赖 scroll 事件来 *启动* 手动模式
        const setUserInteracting = () => {
            // 强制清除程序滚动标记，因为用户干预了
            isProgrammaticScroll = false;
            if (window.programmaticScrollTimer) {
                clearTimeout(window.programmaticScrollTimer);
                window.programmaticScrollTimer = null;
            }
        };

        lyricContainer.addEventListener('mousedown', setUserInteracting, { passive: true });
        lyricContainer.addEventListener('touchstart', setUserInteracting, { passive: true });
        lyricContainer.addEventListener('wheel', setUserInteracting, { passive: true });
        lyricContainer.addEventListener('keydown', setUserInteracting, { passive: true }); // Keyboard arrow keys

        // 使用 passive: true 提高滚动性能
        lyricContainer.addEventListener('scroll', handleLyricScroll, { passive: true });
    }

    // 绑定音质选择
    const qualitySelect = document.getElementById('quality-select');
    if (qualitySelect && settings.preferredQuality) {
        qualitySelect.value = settings.preferredQuality;
    }

    // 恢复其他设置
    loadSettings();

    // 监听源切换，自动刷新热搜
    const searchSourceSelect = document.getElementById('search-source');
    if (searchSourceSelect) {
        searchSourceSelect.addEventListener('change', () => {
            const searchInput = document.getElementById('search-input');
            // 仅当搜索框为空（即处于显示热搜状态）时刷新
            if (!searchInput || !searchInput.value.trim()) {
                showInitialSearchState();
            }
        });
    }

    // [Fix] Auto-Login logic (Restore Session)
    const savedMode = localStorage.getItem('lx_sync_mode');
    if (savedMode === 'local') {
        const u = localStorage.getItem('lx_sync_user');
        const p = localStorage.getItem('lx_sync_pass');
        if (u && p) {
            console.log('[AutoLogin] 检测到本地账户，正在自动登录...');
            // Fill UI
            document.getElementById('sync-local-user').value = u;
            document.getElementById('sync-local-pass').value = p;
            // Trigger login
            handleLocalLogin();
        }
    } else if (savedMode === 'remote') {
        const url = localStorage.getItem('lx_sync_url');
        const code = localStorage.getItem('lx_sync_code');
        if (url && code) {
            console.log('[AutoLogin] 检测到远程同步设置，正在自动连接...');
            // Fill UI
            document.getElementById('sync-remote-url').value = url;
            document.getElementById('sync-remote-step1').classList.add('hidden');
            document.getElementById('sync-remote-step2').classList.remove('hidden');
            document.getElementById('sync-remote-code').value = code;
            // Trigger connect
            handleRemoteConnect();
        }
    }
});

// ========================================
// Global Overrides
// ========================================

// Override batch_pagination.js helper to access local currentSearchScope
window.getCurrentActiveListId = function () {
    if (currentSearchScope === 'local_list') return window.currentViewingListId;
    if (currentSearchScope === 'local_all') return 'love';
    return null;
};



// ========================================
// Mobile Optimization Logic
// ========================================

// Mobile Sidebar Toggle
function toggleSidebar() {
    const sidebar = document.getElementById('main-sidebar');
    const backdrop = document.getElementById('mobile-sidebar-backdrop');

    if (sidebar.classList.contains('-translate-x-full')) {
        // Open
        sidebar.classList.remove('-translate-x-full');
        sidebar.classList.add('translate-x-0');
        backdrop.classList.remove('hidden');
    } else {
        // Close
        sidebar.classList.remove('translate-x-0');
        sidebar.classList.add('-translate-x-full');
        backdrop.classList.add('hidden');
    }
}

// Close sidebar when clicking a link on mobile
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('#main-sidebar a, #main-sidebar div[onclick]').forEach(el => {
        el.addEventListener('click', () => {
            if (window.innerWidth < 768) {
                const sidebar = document.getElementById('main-sidebar');
                if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
                    toggleSidebar();
                }
            }
        });
    });
});

// Auto-adjust layout on resize
window.addEventListener('resize', () => {
    const sidebar = document.getElementById('main-sidebar');
    const backdrop = document.getElementById('mobile-sidebar-backdrop');

    if (sidebar && window.innerWidth >= 768) {
        // Reset styles for desktop
        sidebar.classList.remove('-translate-x-full', 'translate-x-0');
        if (backdrop) backdrop.classList.add('hidden');
    } else if (sidebar) {
        // Ensure default closed state for mobile if not explicitly open
        if (!sidebar.classList.contains('translate-x-0')) {
            sidebar.classList.add('-translate-x-full');
        }
    }
});

// 切换详情页封面显示（移动端优化）
function toggleDetailCover() {
    const cover = document.getElementById('mobile-player-cover-container');
    const container = document.getElementById('player-detail-container');

    if (!cover || !container) return;

    // Toggle state based on class presence
    const isHidden = cover.classList.contains('opacity-0');

    if (!isHidden) {
        // Hide Cover
        // We set max-height to 0 to collapse it smoothly
        cover.style.maxHeight = '0px';
        cover.classList.remove('mb-8', 'md:mb-0');
        // Fade out and shrink
        cover.classList.add('opacity-0', 'scale-90', 'border-0');

        // Move container UP by reducing top padding
        container.classList.remove('pt-24');
        container.classList.add('pt-8'); // Less padding on top

    } else {
        // Show Cover
        cover.style.maxHeight = ''; // Remove inline style to revert to CSS class
        // Restore styles
        cover.classList.remove('opacity-0', 'scale-90', 'border-0');

        // Restore padding
        container.classList.add('pt-24');
        container.classList.remove('pt-8');
    }
}
