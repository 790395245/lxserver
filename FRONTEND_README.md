# LX Music Sync Server - 管理控制台

## 功能概述

这是一个功能完整、界面精美的 LX Music 同步服务器管理系统，提供以下核心功能：

### 🎯 核心功能

#### 1. 仪表盘
- **系统概览**: 用户总数、在线设备数、服务器运行时间、内存使用情况
- **实时统计**: 动态显示服务器状态
- **快速操作**: 一键访问常用功能

#### 2. 用户管理
- ✅ 查看所有同步用户列表
- ✅ 添加新用户（用户名+密码）
- ✅ 删除用户
- ✅ 用户数据持久化存储（users.json）

#### 3. 数据查看
- ✅ 选择用户查看其同步数据
- ✅ 显示歌曲统计：总歌曲数、试听列表、我的收藏、自定义列表数量
- ✅ 详细展示每个播放列表的内容
- ✅ 实时刷新数据

#### 4. 系统配置
- ✅ 基本配置
  - 服务器名称
  - 最大快照备份数
  - 添加歌曲位置（顶部/底部）
- ✅ 代理配置
  - 启用/禁用代理
  - 代理请求头设置
- ✅ 前端配置
  - 前端访问密码修改
- ✅ 实时保存并应用配置

#### 5. 系统日志
- ✅ 多种日志类型（应用日志、访问日志、错误日志）
- ✅ 实时查看最新日志（最多200行）
- ✅ 日志内容自动滚动到底部

### 🔐 安全特性

1. **密码保护**: 前端访问需要输入密码
2. **环境变量支持**: 支持通过 `FRONTEND_PASSWORD` 环境变量设置前端密码
3. **会话管理**: 密码存储在 localStorage，登出自动清除
4. **API 认证**: 所有 API 请求都需要密码验证

### 🎨 界面特性

- **现代设计**: 采用玻璃拟态（Glassmorphism）设计风格
- **深色主题**: 护眼的深色配色方案
- **渐变配色**: 使用蓝紫渐变色作为主色调
- **流畅动画**: 所有交互都有平滑的过渡动画
- **响应式布局**: 支持桌面和移动设备
- **图标系统**: 使用 SVG 图标，清晰美观

## API 接口

### 认证
- `POST /api/login` - 前端登录验证

### 用户管理
- `GET /api/users` - 获取用户列表
- `POST /api/users` - 添加新用户
- `DELETE /api/users` - 删除用户

### 数据查看
- `GET /api/data?user={username}` - 获取指定用户的音乐数据

### 系统配置
- `GET /api/config` - 获取当前配置
- `POST /api/config` - 保存配置

### 系统状态
- `GET /api/stats` - 获取系统统计信息

### 日志查看
- `GET /api/logs?type={logType}&lines={count}` - 获取系统日志

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| FRONTEND_PASSWORD | 前端访问密码 | 123456 |
| PORT | 服务端口 | 9527 |
| BIND_IP | 绑定IP | 127.0.0.1 |
| MAX_SNAPSHOT_NUM | 最大快照数 | 10 |
| LIST_ADD_MUSIC_LOCATION_TYPE | 添加歌曲位置 | top |

## Docker 使用

### 使用 docker-compose

```bash
# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

### 使用环境变量

```yaml
environment:
  - FRONTEND_PASSWORD=your_password_here
  - LX_USER_myuser=mypassword
```

## 配置文件

### config.js

```javascript
module.exports = {
  serverName: 'My Sync Server',
  maxSnapshotNum: 10,
  'list.addMusicLocationType': 'top',
  'proxy.enabled': false,
  'proxy.header': 'x-real-ip',
  'frontend.password': '123456',
  users: [
    {
      name: 'user1',
      password: 'password1'
    }
  ]
}
```

## 数据持久化

- **users.json**: 存储所有用户信息
- **data/**: 用户数据目录
- **logs/**: 日志文件目录

## 技术栈

### 后端
- Node.js + TypeScript
- WebSocket (ws)
- log4js (日志管理)

### 前端
- 原生 JavaScript（ES6+）
- CSS3（Glassmorphism 设计）
- SVG 图标

## 特色功能

1. **实时数据管理**: 所有用户操作立即生效
2. **配置热更新**: 修改配置后实时应用
3. **用户数据可视化**: 图表展示音乐数据统计
4. **日志实时查看**: 方便排查问题
5. **美观的UI**: 专业级的管理界面

## 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 生产运行
npm start
```

## 注意事项

1. **密码安全**: 请及时修改默认密码
2. **数据备份**: 定期备份 data 目录
3. **日志管理**: 日志文件会持续增长，需要定期清理
4. **端口配置**: 确保 9527 端口未被占用

## License

Apache-2.0
