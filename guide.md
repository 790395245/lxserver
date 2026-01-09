# 修复 WebSocket 连接问题 (关键)

经过排查，发现 `src/server/server.ts` 中的 WebSocket 连接处理逻辑（`upgrade` 事件）存在严重缺陷：**它定义了鉴权函数但从未调用，导致连接请求被挂起，无法完成握手。** 这就是为什么输入正确密码时客户端一直显示 "Connecting..." 的原因。

请严格按照以下步骤修改 `src/server/server.ts`。

## 1. 修复 `authConnection` 函数 (约第 114 行)

找到文件顶部的 `authConnection` 函数定义。我们需要修改它的错误处理逻辑，使其在鉴权失败时不再抛出异常，而是优雅地拒绝。

**修改前：**
```typescript
const authConnection = (req: http.IncomingMessage, callback: (err: string | null | undefined, success: boolean) => void) => {
  // ...
  authConnect(req).then(() => {
    callback(null, true)
  }).catch(err => {
    callback(err, false)  // <--- 这里会传递错误对象
  })
}
```

**修改后：**
```typescript
const authConnection = (req: http.IncomingMessage, callback: (err: string | null | undefined, success: boolean) => void) => {
  // console.log(req.headers)
  // // console.log(req.auth)
  // console.log(req._query.authCode)
  authConnect(req).then(() => {
    callback(null, true)
  }).catch(err => {
    // console.log('WebSocket auth failed:', err.message)
    callback(null, false) // <--- 修改为传递 null, false
  })
}
```

## 2. 修复 `upgrade` 事件处理 (约第 1433 行)

找到 `httpServer.on('upgrade', ...)` 代码块。这是问题的核心。
**请删除该代码块内的所有内容，并替换为以下正确的逻辑：**

**修改前（当前错误状态）：**
```typescript
  httpServer.on('upgrade', function upgrade(request, socket, head) {
    socket.addListener('error', onSocketError)
    // This function is not defined on purpose. Implement it with your own logic.
    const authConnection = (req: http.IncomingMessage, callback: (err: string | null | undefined, success: boolean) => void) => {
       // ... 定义了但没调用 ...
    }
  })
```

**修改后（正确逻辑）：**
```typescript
  httpServer.on('upgrade', function upgrade(request, socket, head) {
    socket.addListener('error', onSocketError)

    // 调用鉴权函数
    authConnection(request, (err, success) => {
      if (!success || err) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      // 鉴权通过，升级协议
      wss?.handleUpgrade(request, socket, head, function done(ws) {
        wss?.emit('connection', ws, request)
      })
    })
  })
```

## 3. 重启服务

修改完成后，请重新编译并启动服务：

```bash
npm run build
npm start
```

再次尝试连接客户端，应该就能正常连接了。
