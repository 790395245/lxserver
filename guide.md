# 修改 filemanager.html 以启用双击编辑文本文件

## 问题描述
目前双击文本文件或右键点击"打开"会下载一个名为 `connector` 的文件，而不是打开文本编辑器。

## 解决方案
需要在 elFinder 的配置中添加 `commandsOptions` 来指定哪些文件类型可以编辑，并配置默认的双击行为。

## 修改步骤

### 1. 找到修改位置
打开 `public/filemanager.html`，找到第 **171** 行左右，也就是这段代码：

```javascript
                },
                ui: ['toolbar', 'tree', 'path', 'stat'],
                uiOptions: {
```

### 2. 在 `ui:` 这一行**之前**插入以下配置

在第 171 行的 `},` 和第 172 行的 `ui:` 之间，插入以下代码：

```javascript
                },
                // 配置编辑命令：指定哪些 MIME 类型可以在线编辑
                commandsOptions: {
                    edit: {
                        mimes: ['text/plain', 'text/html', 'text/javascript', 'text/css', 'application/json', 'text/markdown'],
                        editors: [
                            { 
                                mimes: ['text/plain', 'text/html', 'text/javascript', 'text/css', 'application/json', 'text/markdown'],
                                load: function(textarea) {
                                    // 使用 elFinder 默认的文本编辑器
                                }
                            }
                        ]
                    }
                },
                ui: ['toolbar', 'tree', 'path', 'stat'],
```

### 3. 完整的修改示例

修改前：
```javascript
                contextmenu: {
                    // ... 省略
                },
                ui: ['toolbar', 'tree', 'path', 'stat'],
                uiOptions: {
```

修改后：
```javascript
                contextmenu: {
                    // ... 省略
                },
                // 配置编辑命令：指定哪些 MIME 类型可以在线编辑
                commandsOptions: {
                    edit: {
                        mimes: ['text/plain', 'text/html', 'text/javascript', 'text/css', 'application/json', 'text/markdown'],
                        editors: [
                            { 
                                mimes: ['text/plain', 'text/html', 'text/javascript', 'text/css', 'application/json', 'text/markdown'],
                                load: function(textarea) {}
                            }
                        ]
                    }
                },
                ui: ['toolbar', 'tree', 'path', 'stat'],
                uiOptions: {
```

## 验证修改

1. 保存 `filemanager.html` 文件
2. 刷新浏览器中的文件管理器页面（注意：**不需要**重启服务器，这是纯前端代码）
3. 尝试双击任意文本文件（如 `.txt`, `.js`, `.json`, `.ts` 等）
4. 现在应该会弹出文本编辑器窗口，而不是下载文件

## 注意事项

- 这个修改**只需要刷新页面**，不需要重启 Node.js 服务器
- 如果修改后仍然无效，请按 `Ctrl+Shift+R`（Windows）或 `Cmd+Shift+R`（Mac）强制刷新浏览器缓存
- 右键菜单中的"文本区域"选项应该也能正常工作
