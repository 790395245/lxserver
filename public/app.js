const API_BASE = '';

class App {
    constructor() {
        this.password = null;
        this.currentView = 'dashboard';
        this.users = [];
        this.init();
    }

    init() {
        // 检查是否已登录
        const savedPassword = localStorage.getItem('lx_auth');
        if (savedPassword) {
            this.password = savedPassword;
            this.showApp();
            this.loadDashboard();
        }

        // 绑定登录事件
        document.getElementById('login-btn')?.addEventListener('click', () => this.login());
        document.getElementById('access-password')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.login();
        });

        // 绑定退出登录
        document.getElementById('logout-btn')?.addEventListener('click', () => this.logout());

        // 绑定导航
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const view = item.dataset.view;
                this.switchView(view);
            });
        });

        // 绑定快速操作
        document.querySelectorAll('.action-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                this.handleQuickAction(action);
            });
        });

        // 用户管理
        document.getElementById('add-user-btn')?.addEventListener('click', () => this.showAddUserModal());

        // 数据查看
        document.getElementById('refresh-data-btn')?.addEventListener('click', () => this.loadUserData());
        document.getElementById('data-user-select')?.addEventListener('change', () => this.loadUserData());

        // 配置管理
        document.getElementById('config-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveConfig();
        });
        document.getElementById('reload-config-btn')?.addEventListener('click', () => this.loadConfig());

        // 日志查看
        document.getElementById('refresh-logs-btn')?.addEventListener('click', () => this.loadLogs());
        document.getElementById('log-type-select')?.addEventListener('change', () => this.loadLogs());

        // 模态框
        document.querySelector('.modal-close')?.addEventListener('click', () => this.closeModal());
        document.getElementById('modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'modal') this.closeModal();
        });
    }

    async login() {
        const password = document.getElementById('access-password').value;
        const errorEl = document.getElementById('login-error');

        if (!password) {
            errorEl.textContent = '请输入密码';
            return;
        }

        try {
            const res = await this.request('/api/login', {
                method: 'POST',
                body: JSON.stringify({ password })
            });

            if (res.success) {
                this.password = password;
                localStorage.setItem('lx_auth', password);
                this.showApp();
                this.loadDashboard();
            } else {
                errorEl.textContent = '密码错误';
            }
        } catch (err) {
            errorEl.textContent = '登录失败，请重试';
        }
    }

    logout() {
        localStorage.removeItem('lx_auth');
        location.reload();
    }

    showApp() {
        document.getElementById('login-overlay').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
    }

    switchView(viewName) {
        // 更新导航状态
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === viewName);
        });

        // 切换视图
        document.querySelectorAll('.view').forEach(view => {
            view.classList.toggle('active', view.id === `view-${viewName}`);
        });

        // 更新标题
        const titles = {
            dashboard: '仪表盘',
            users: '用户管理',
            data: '数据查看',
            config: '系统配置',
            logs: '系统日志'
        };
        document.getElementById('page-title').textContent = titles[viewName] || viewName;

        this.currentView = viewName;

        // 加载对应数据
        switch (viewName) {
            case 'dashboard':
                this.loadDashboard();
                break;
            case 'users':
                this.loadUsers();
                break;
            case 'data':
                this.loadUserData();
                break;
            case 'config':
                this.loadConfig();
                break;
            case 'logs':
                this.loadLogs();
                break;
        }
    }

    handleQuickAction(action) {
        switch (action) {
            case 'add-user':
                this.switchView('users');
                setTimeout(() => this.showAddUserModal(), 100);
                break;
            case 'view-logs':
                this.switchView('logs');
                break;
            case 'edit-config':
                this.switchView('config');
                break;
        }
    }

    async loadDashboard() {
        try {
            const stats = await this.request('/api/stats');

            document.getElementById('stat-users').textContent = stats.users || 0;
            document.getElementById('stat-devices').textContent = stats.connectedDevices || 0;
            document.getElementById('stat-uptime').textContent = this.formatUptime(stats.uptime);
            document.getElementById('stat-memory').textContent = this.formatMemory(stats.memoryUsage?.heapUsed || 0);

            // 加载用户列表以填充数据查看下拉框
            const users = await this.request('/api/users');
            const select = document.getElementById('data-user-select');
            if (select) {
                select.innerHTML = '<option value="">选择用户</option>' +
                    users.map(u => `<option value="${u.name}">${u.name}</option>`).join('');
            }
        } catch (err) {
            console.error('Failed to load dashboard:', err);
        }
    }

    async loadUsers() {
        try {
            const users = await this.request('/api/users');
            this.users = users;
            this.renderUsers();
        } catch (err) {
            console.error('Failed to load users:', err);
        }
    }

    renderUsers() {
        const container = document.getElementById('users-list');
        if (!this.users.length) {
            container.innerHTML = `
                <div class="glass" style="padding: 3rem; text-align: center; grid-column: 1 / -1;">
                    <p style="color: var(--text-secondary);">暂无用户，点击上方按钮添加用户</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.users.map(user => `
            <div class="user-card">
                <div class="user-card-header">
                    <div class="user-name">${user.name}</div>
                    <div class="user-actions">
                        <button class="btn-delete" onclick="app.deleteUser('${user.name}')">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        `).join('');
    }

    showAddUserModal() {
        const modal = document.getElementById('modal');
        const modalTitle = document.getElementById('modal-title');
        const modalBody = document.getElementById('modal-body');

        modalTitle.textContent = '添加用户';
        modalBody.innerHTML = `
            <form id="add-user-form">
                <div class="form-group">
                    <label>用户名</label>
                    <input type="text" name="name" class="form-input" required />
                </div>
                <div class="form-group">
                    <label>密码</label>
                    <input type="password" name="password" class="form-input" required />
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn-primary">添加</button>
                    <button type="button" class="btn-secondary" onclick="app.closeModal()">取消</button>
                </div>
            </form>
        `;

        modal.classList.remove('hidden');

        document.getElementById('add-user-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData);

            try {
                await this.request('/api/users', {
                    method: 'POST',
                    body: JSON.stringify(data)
                });
                this.closeModal();
                this.loadUsers();
                this.loadDashboard();
            } catch (err) {
                alert('添加用户失败: ' + err.message);
            }
        });
    }

    async deleteUser(username) {
        if (!confirm(`确定要删除用户 "${username}" 吗？`)) return;

        try {
            await this.request('/api/users', {
                method: 'DELETE',
                body: JSON.stringify({ name: username })
            });
            this.loadUsers();
            this.loadDashboard();
        } catch (err) {
            alert('删除用户失败: ' + err.message);
        }
    }

    async loadUserData() {
        const username = document.getElementById('data-user-select')?.value;
        if (!username) {
            document.getElementById('data-content').innerHTML = '<p style="color: var(--text-secondary); padding: 2rem; text-align: center;">请选择用户</p>';
            return;
        }

        try {
            const data = await this.request(`/api/data?user=${encodeURIComponent(username)}`);

            // 统计数据
            let totalSongs = 0;
            const defaultCount = data.defaultList?.length || 0;
            const loveCount = data.loveList?.length || 0;
            const userListCount = data.userList?.length || 0;

            data.userList?.forEach(list => {
                totalSongs += list.list?.length || 0;
            });
            totalSongs += defaultCount + loveCount;

            document.getElementById('data-stats').innerHTML = `
                <div class="data-stat-card">
                    <h4>总歌曲数</h4>
                    <div class="value">${totalSongs}</div>
                </div>
                <div class="data-stat-card">
                    <h4>试听列表</h4>
                    <div class="value">${defaultCount}</div>
                </div>
                <div class="data-stat-card">
                    <h4>我的收藏</h4>
                    <div class="value">${loveCount}</div>
                </div>
                <div class="data-stat-card">
                    <h4>自定义列表</h4>
                    <div class="value">${userListCount}</div>
                </div>
            `;

            // 列表详情
            let content = '<h3 style="margin-bottom: 1rem;">播放列表</h3>';

            if (data.userList && data.userList.length) {
                data.userList.forEach(list => {
                    content += `
                        <div class="playlist-item">
                            <div>
                                <div class="playlist-name">${list.name}</div>
                                <div class="playlist-count">ID: ${list.id}</div>
                            </div>
                            <div class="playlist-count">${list.list?.length || 0} 首歌曲</div>
                        </div>
                    `;
                });
            } else {
                content += '<p style="color: var(--text-secondary); padding: 1rem;">暂无自定义列表</p>';
            }

            document.getElementById('data-content').innerHTML = content;
        } catch (err) {
            document.getElementById('data-content').innerHTML = '<p style="color: var(--accent-error); padding: 2rem; text-align: center;">加载数据失败</p>';
        }
    }

    async loadConfig() {
        try {
            const config = await this.request('/api/config');
            const form = document.getElementById('config-form');

            form.elements['serverName'].value = config.serverName || '';
            form.elements['maxSnapshotNum'].value = config.maxSnapshotNum || 10;
            form.elements['list.addMusicLocationType'].value = config['list.addMusicLocationType'] || 'top';
            form.elements['proxy.enabled'].checked = config['proxy.enabled'] || false;
            form.elements['proxy.header'].value = config['proxy.header'] || '';
            form.elements['frontend.password'].value = config['frontend.password'] || '';
        } catch (err) {
            console.error('Failed to load config:', err);
        }
    }

    async saveConfig() {
        const form = document.getElementById('config-form');
        const formData = new FormData(form);
        const config = {
            serverName: formData.get('serverName'),
            maxSnapshotNum: parseInt(formData.get('maxSnapshotNum')),
            'list.addMusicLocationType': formData.get('list.addMusicLocationType'),
            'proxy.enabled': formData.get('proxy.enabled') === 'on',
            'proxy.header': formData.get('proxy.header'),
            'frontend.password': formData.get('frontend.password'),
        };

        try {
            await this.request('/api/config', {
                method: 'POST',
                body: JSON.stringify(config)
            });

            // 如果密码改了，更新本地存储
            if (config['frontend.password'] && config['frontend.password'] !== this.password) {
                this.password = config['frontend.password'];
                localStorage.setItem('lx_auth', config['frontend.password']);
            }

            alert('配置保存成功！');
        } catch (err) {
            alert('配置保存失败: ' + err.message);
        }
    }

    async loadLogs() {
        const logType = document.getElementById('log-type-select')?.value || 'app';

        try {
            const data = await this.request(`/api/logs?type=${logType}&lines=200`);
            const container = document.getElementById('logs-content');

            if (data.logs && data.logs.length) {
                container.innerHTML = data.logs
                    .filter(line => line.trim())
                    .map(line => `<div class="log-line">${this.escapeHtml(line)}</div>`)
                    .join('');

                // 滚动到底部
                container.scrollTop = container.scrollHeight;
            } else {
                container.innerHTML = '<p style="color: var(--text-secondary);">暂无日志</p>';
            }
        } catch (err) {
            document.getElementById('logs-content').innerHTML = '<p style="color: var(--accent-error);">加载日志失败</p>';
        }
    }

    closeModal() {
        document.getElementById('modal').classList.add('hidden');
    }

    async request(url, options = {}) {
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
                'X-Frontend-Auth': this.password
            }
        };

        const response = await fetch(API_BASE + url, { ...defaultOptions, ...options });

        if (response.status === 401) {
            this.logout();
            throw new Error('Unauthorized');
        }

        if (!response.ok) {
            const text = await response.text();
            throw new Error(text || 'Request failed');
        }

        return response.json();
    }

    formatUptime(seconds) {
        if (!seconds) return '0h';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 24) {
            const days = Math.floor(hours / 24);
            return `${days}d ${hours % 24}h`;
        }
        return `${hours}h ${minutes}m`;
    }

    formatMemory(bytes) {
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// 初始化应用
const app = new App();
