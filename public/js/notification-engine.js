/**
 * PostHog 通用通知引擎 (混合模式 + 多样式美化版)
 * 核心特性：
 * 1. 优先级控制：System > Remote
 * 2. 队列系统：FIFO 队列处理
 * 3. 智能样式：根据 type 和 title 自动匹配图标与配色 (版本火箭、警告三角、广播铃铛)
 */
(function () {
    // ================= 1. 基础配置与资源 =================
    const CONFIG = {
        PRIORITY_KEYS: ['system_notification_config', 'remote_config_source'],
        getLocalVersion: () => (window.CONFIG && window.CONFIG.version) ? window.CONFIG.version : '0.0.0'
    };

    // 图标库 (SVG Path)
    const ICONS = {
        bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path>',
        rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path><path d="M9 12H4s.55-3.03 2-4c1.62-1.1 2.73-1.68 4.12-1.98"></path><path d="M15 13v5c0 1.8.71 2.93 2 4 1.15-1.46 1.83-2.6 1.98-4.02.26-2.48.51-3.66 1.02-4.98"></path>',
        warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>',
        check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>',
        info: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>'
    };

    // 队列状态
    const NOTIFICATION_QUEUE = [];
    let isShowing = false;

    // ================= 2. 工具函数 =================

    function compareVersions(local, remote) {
        if (!local || !remote) return 0;
        const v1 = local.replace(/^v/, '').split('.').map(Number);
        const v2 = remote.replace(/^v/, '').split('.').map(Number);
        const len = Math.max(v1.length, v2.length);
        for (let i = 0; i < len; i++) {
            const n1 = v1[i] || 0;
            const n2 = v2[i] || 0;
            if (n1 < n2) return -1;
            if (n1 > n2) return 1;
        }
        return 0;
    }

    function processQueue() {
        if (isShowing || NOTIFICATION_QUEUE.length === 0) return;

        const { item, storageKey } = NOTIFICATION_QUEUE.shift();
        isShowing = true;
        console.log(`[Notification] Showing from queue: ${item.id}`);

        renderModal(item, storageKey, () => {
            isShowing = false;
            setTimeout(processQueue, 300);
        });
    }

    // 智能获取样式配置
    function getStyleConfig(type, title) {
        const t = title.toLowerCase();

        // 1. 版本更新 (Rocket)
        if (type === 'version' || t.includes('update') || t.includes('更新') || t.includes('版本')) {
            return {
                icon: ICONS.rocket,
                color: 'var(--c-600, #2563eb)', // 主题色
                bg: 'var(--c-50, #eff6ff)',
                label: 'New Update'
            };
        }

        // 2. 警告/维护 (Warning) - 使用醒目的橙色
        if (t.includes('维护') || t.includes('警告') || t.includes('失败') || t.includes('error') || t.includes('warning')) {
            return {
                icon: ICONS.warning,
                color: '#f59e0b', // Amber 500 (固定橙色，起警示作用)
                bg: '#fffbeb',    // Amber 50
                label: 'System Alert'
            };
        }

        // 3. 成功/连接 (Success) - 使用绿色
        if (t.includes('成功') || t.includes('success') || t.includes('完成')) {
            return {
                icon: ICONS.check,
                color: '#10b981', // Emerald 500
                bg: '#ecfdf5',    // Emerald 50
                label: 'Success'
            };
        }

        // 4. 默认/广播 (Bell)
        return {
            icon: ICONS.bell,
            color: 'var(--c-600, #4b5563)', // 默认使用主题色或深灰
            bg: 'var(--c-50, #f3f4f6)',
            label: 'Notification'
        };
    }

    // 渲染 UI (多样式版)
    function renderModal(item, storageKey, onModalClose) {
        if (document.getElementById('ph-notification-overlay')) return;

        const styleConfig = getStyleConfig(item.type, item.ui.title || '');

        const overlay = document.createElement('div');
        overlay.id = 'ph-notification-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);z-index:99999;display:flex;justify-content:center;align-items:center;font-family:sans-serif;backdrop-filter:blur(4px);transition:opacity 0.3s;';

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: #ffffff; 
            width: 340px; 
            padding: 0;
            border-radius: 16px; 
            box-shadow: 0 20px 40px rgba(0,0,0,0.15); 
            text-align: center; 
            overflow: hidden;
            animation: phFadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        `;

        // 注入全局动画样式
        if (!document.getElementById('ph-style')) {
            const style = document.createElement('style');
            style.id = 'ph-style';
            style.textContent = `
                @keyframes phFadeIn { from {opacity:0;transform:scale(0.95) translateY(20px);} to {opacity:1;transform:scale(1) translateY(0);} }
                .ph-btn { transition: all 0.2s; position: relative; overflow: hidden; }
                .ph-btn:hover { filter: brightness(1.05); transform: translateY(-1px); }
                .ph-btn:active { transform: scale(0.98); }
            `;
            document.head.appendChild(style);
        }

        const { title, message, confirm_text, cancel_text } = item.ui;
        const hasCancel = cancel_text && cancel_text.length > 0;

        // 根据样式配置动态生成头部
        modal.innerHTML = `
            <div style="padding: 32px 24px 24px;">
                <div style="
                    margin: 0 auto 16px; 
                    width: 64px; height: 64px; 
                    border-radius: 50%; 
                    background: ${styleConfig.bg}; 
                    color: ${styleConfig.color};
                    display: flex; align-items: center; justify-content: center;
                ">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        ${styleConfig.icon}
                    </svg>
                </div>
                
                <h3 style="margin:0 0 10px; color:var(--c-900, #111827); font-size:20px; font-weight:700; letter-spacing: -0.5px;">${title}</h3>
                ${item.ui.date ? `<p style="margin:0 0 8px; color:var(--c-500, #9ca3af); font-size:12px;">更新日期: ${item.ui.date}</p>` : ''}
                <p style="margin:0; color:var(--c-600, #6b7280); font-size:15px; line-height:1.6;">${message.replace(/\n/g, '<br/>')}</p>
            </div>

            <div style="padding: 20px 24px 24px; display:flex; gap:12px; justify-content:center;">
                ${hasCancel ? `
                <button id="ph-btn-cancel" class="ph-btn" style="
                    flex:1; padding:12px; border:1px solid var(--c-200, #e5e7eb); background:white; 
                    border-radius:12px; cursor:pointer; color:var(--c-600, #4b5563); font-weight:600; font-size:15px;
                ">${cancel_text}</button>` : ''}
                
                <button id="ph-btn-confirm" class="ph-btn" style="
                    flex:1; padding:12px; border:none; background:${styleConfig.color}; 
                    color:#ffffff; border-radius:12px; cursor:pointer; font-weight:600; font-size:15px;
                    box-shadow: 0 4px 12px -2px ${styleConfig.color}40;
                ">${confirm_text}</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const close = () => {
            if (document.body.contains(overlay)) {
                overlay.style.opacity = '0';
                modal.style.transform = 'scale(0.95) translateY(10px)';
                modal.style.opacity = '0';
                modal.style.transition = 'all 0.2s ease-in';
                setTimeout(() => {
                    if (document.body.contains(overlay)) document.body.removeChild(overlay);
                    if (onModalClose) onModalClose();
                }, 200);
            }
        };

        const recordView = () => {
            if (item.logic.interval_hours !== 0) {
                localStorage.setItem(storageKey, Date.now().toString());
            }
        };

        document.getElementById('ph-btn-confirm').onclick = () => {
            recordView();
            const action = item.action ? item.action.type : 'close';

            // 动作处理逻辑
            if (action === 'reload') {
                close();
                if (navigator.serviceWorker) {
                    navigator.serviceWorker.getRegistrations().then(regs => {
                        for (let reg of regs) reg.unregister();
                        window.location.reload(true);
                    });
                } else {
                    window.location.reload(true);
                }
            } else if (action === 'link') {
                close();
                window.open(item.action.url, '_blank');
            } else {
                close();
            }
        };

        if (hasCancel) {
            document.getElementById('ph-btn-cancel').onclick = () => {
                if (item.logic.interval_hours > 0) {
                    localStorage.setItem(storageKey, Date.now().toString());
                }
                close();
            };
        }
    }

    // ================= 3. 核心逻辑处理 =================
    function processItem(item, isManual = false) {
        if (!item || item.status !== 'active') return false;

        // Manual check: ONLY allow 'version' type notifications
        if (isManual && item.type !== 'version') return false;

        const currentVer = CONFIG.getLocalVersion();
        const storageKey = `ph_notif_${item.id}`;
        const lastSeen = localStorage.getItem(storageKey);

        // 如果是手动检查，忽略时间间隔限制
        if (!isManual && lastSeen) {
            const interval = item.logic.interval_hours;
            if (interval === -1) return false;
            const hoursPassed = (Date.now() - parseInt(lastSeen)) / (1000 * 60 * 60);
            if (hoursPassed < interval) return false;
        }

        if (item.type === 'version') {
            const target = item.logic.target_version;
            // 如果是手动检查，且已经是最新版，返回 false
            if (item.logic.operator === '<' && compareVersions(currentVer, target) >= 0) {
                return false;
            }
        }

        NOTIFICATION_QUEUE.push({ item, storageKey });
        processQueue();
        return true;
    }

    // ================= 4. 数据获取与处理 =================
    async function handlePayload(payload, sourceKey, isManual = false) {
        if (!payload) return false;
        let hasUpdate = false;
        try {
            if (typeof payload === 'object' && payload.url && typeof payload.url === 'string') {
                await fetchRemoteConfig(payload.url, isManual);
                return; // fetchRemoteConfig 会处理结果，这里不好直接返回 hasUpdate，简化处理
            }
            if (typeof payload === 'string' && payload.startsWith('http')) {
                await fetchRemoteConfig(payload, isManual);
                return;
            }
            const data = (typeof payload === 'string') ? JSON.parse(payload) : payload;
            if (Array.isArray(data)) {
                data.forEach(item => {
                    if (processItem(item, isManual)) hasUpdate = true;
                });
            } else {
                if (processItem(data, isManual)) hasUpdate = true;
            }
        } catch (e) {
            console.error(`[Notification] Error processing payload from ${sourceKey}:`, e);
        }
        return hasUpdate;
    }

    async function fetchRemoteConfig(url, isManual = false) {
        try {
            const bustUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
            const res = await fetch(bustUrl);
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            const data = await res.json();
            let hasUpdate = false;
            if (Array.isArray(data)) {
                data.forEach(item => {
                    if (processItem(item, isManual)) hasUpdate = true;
                });
            } else {
                if (processItem(data, isManual)) hasUpdate = true;
            }

            if (isManual && !hasUpdate) {
                // Construct a temporary item for "Up to date"
                const upToDateItem = {
                    id: 'manual_check_uptodate',
                    type: 'info', // Will use Success/Check icon based on title match in getStyleConfig
                    ui: {
                        title: '当前已是最新版本',
                        message: '您的 LX Music Server 已更新到最新版本，无需更新。',
                        confirm_text: '确定',
                        cancel_text: ''
                    },
                    action: { type: 'close' },
                    logic: { interval_hours: 0 }
                };
                renderModal(upToDateItem, 'temp_manual_check', null);
            }
        } catch (e) {
            console.error('[Notification] Check failed:', e);
            if (isManual) {
                let errorTitle = '检查更新失败';
                let errorMessage = '无法连接到更新服务器，请检查网络连接或稍后重试。';

                // 更精确的错误提示
                if (e.message.includes('404')) {
                    errorMessage = '当前服务器未发现预设的更新通知文件，且在线更新检查功能已关闭。';
                } else if (!window.CONFIG || window.CONFIG.disableTelemetry) {
                    errorMessage = '由于你已在设置或环境变量中禁用了「数据收集与统计」，系统无法自动连接到远程更新服务器。请直接前往 GitHub 发布页面下载最新版本。';
                }

                const errorItem = {
                    id: 'manual_check_error',
                    type: 'warning',
                    ui: {
                        title: errorTitle,
                        message: errorMessage,
                        confirm_text: '确定',
                        cancel_text: ''
                    },
                    action: { type: 'close' },
                    logic: { interval_hours: 0 }
                };
                renderModal(errorItem, 'temp_manual_error', null);
            }
        }
    }

    // ================= 5. 初始化入口 =================
    function init() {
        if (typeof posthog === 'undefined') {
            if (!window._ph_retry) window._ph_retry = 0;
            if (window._ph_retry < 10) {
                window._ph_retry++;
                setTimeout(init, 500);
            }
            return;
        }

        posthog.onFeatureFlags(() => {
            checkUpdates(false);
        });
    }

    function checkUpdates(isManual = false) {
        // 如果服务没加载，或者配置里明确禁用了，直接弹窗告知原因
        if (typeof posthog === 'undefined' || (window.CONFIG && window.CONFIG.disableTelemetry)) {
            if (isManual) {
                const errorItem = {
                    id: 'manual_check_disabled',
                    type: 'warning',
                    ui: {
                        title: '检查更新失败',
                        message: '由于你已禁用了「数据收集与统计」，在线更新检查服务未加载。请前往 GitHub 检查最新版本。',
                        confirm_text: '确定',
                        cancel_text: ''
                    },
                    action: { type: 'close' },
                    logic: { interval_hours: 0 }
                };
                renderModal(errorItem, 'temp_manual_disabled', null);
            }
            return;
        }

        let checked = false;
        for (const key of CONFIG.PRIORITY_KEYS) {
            const isEnabled = posthog.isFeatureEnabled(key);
            if (isEnabled) {
                const payload = posthog.getFeatureFlagPayload(key);
                if (payload) {
                    handlePayload(payload, key, isManual);
                    checked = true;
                    return;
                }
            }
        }

        if (isManual && !checked) {
            // 如果 Feature Flags 里没东西，仅显示“已是最新”即可，不再尝试虚假的本地路径
            const upToDateItem = {
                id: 'manual_check_uptodate',
                type: 'info',
                ui: {
                    title: '当前已是最新版本',
                    message: '未发现可用更新，您的 LX Music Server 运行良好。',
                    confirm_text: '确定',
                    cancel_text: ''
                },
                action: { type: 'close' },
                logic: { interval_hours: 0 }
            };
            renderModal(upToDateItem, 'temp_manual_check', null);
        }
    }

    // 暴露给全局的方法
    window.LxNotification = {
        checkUpdates: checkUpdates
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
