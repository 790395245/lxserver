module.exports = {
  // 服务名称，用于客户端显示
  serverName: 'My Sync Server',

  // 是否启用反向代理支持
  // 如果你的服务运行在 Nginx 等反向代理后面，请设置为 true
  'proxy.enabled': false,

  // 反向代理传递真实 IP 的请求头名称
  // 常见的有 'x-real-ip', 'x-forwarded-for' 等
  'proxy.header': 'x-real-ip',

  // 最大快照备份数量
  // 服务器会保留最近的 N 个数据快照，用于数据恢复或冲突解决
  maxSnapshotNum: 10,

  // 默认添加歌曲到列表的位置
  // 可选值: 'top' (顶部), 'bottom' (底部)
  // 参考客户端设置: 设置 -> 列表设置 -> 添加歌曲到列表时的位置
  'list.addMusicLocationType': 'top',

  // 前端可视化界面访问密码
  // 访问主页时需要输入此密码才能查看系统状态和用户数据
  'frontend.password': '123456',

  // 用户列表
  // 定义允许连接同步服务的用户
  users: [
    // 示例用户配置
    {
      name: 'user1', // 用户名 (必须唯一)
      password: '123456', // 连接密码 (建议复杂一点)
      //   maxSnapshotNum: 10, // 该用户独立的最大快照数设置 (可选)
      //   'list.addMusicLocationType': 'top', // 该用户独立的添加歌曲位置设置 (可选)
    },
  ],

  // 环境变量配置说明
  // 所有以 `env.` 开头的配置项将被解析为环境变量
  // 例如:
  // 'env.PORT': '9527', // 服务端口
  // 'env.BIND_IP': '0.0.0.0', // 绑定 IP
  // 'env.DATA_PATH': '/server/data', // 数据存储路径
  // 'env.LOG_PATH': '/server/logs', // 日志存储路径
}
