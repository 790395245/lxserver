# LX Music Web Player

LX Music Sync Server 内置了一个功能强大的 Web 播放器，让你可以随时随地在浏览器中享受音乐。

![Web Player Interface](player.png)

## ✨ 核心特性

### 1. 现代化界面
采用清爽的现代化 UI 设计，支持深色模式，提供极致的视觉体验。

### 2. 多源搜索
支持聚合搜索各大音乐平台的资源，想听什么搜什么。

![Search Interface](search.png)

### 3. 歌单同步
与 LX Music 客户端数据完美互通，收藏的歌曲瞬间同步到 Web 端。

![Favorite List](favorite.png)

### 4. 强大的播放控制
支持播放模式切换（单曲循环、列表循环、随机播放）、音质选择、歌词显示等功能。

### 5. 自定义源管理
支持导入自定义源脚本，扩展更多音乐来源。

![Source Management](source.png)

## 🔒 访问控制

为了保护你的隐私，Web 播放器支持开启访问密码。

![Auth Check](setting.png)

### 开启方式

1. **环境变量配置**（推荐 Docker 用户使用）：
   - `ENABLE_WEBPLAYER_AUTH=true`: 开启认证
   - `WEBPLAYER_PASSWORD=yourpassword`: 设置访问密码

2. **Web 界面配置**：
   登录管理后台，进入 **"系统配置"**，勾选 **"启用 Web 播放器访问密码"** 并设置密码。

开启后，访问 `/music` 将需要输入密码才能进入播放器界面。

## 📱 移动端适配

Web 播放器针对移动端进行了深度优化，手机浏览器访问也能获得原生 App 般的体验。
