# 311-building-b 项目笔记

## 项目结构

```
C:\Users\罗\311-building-b\
├── server.js          # Express + Socket.IO 后端
├── public/
│   ├── index.html     # 单页前端
│   ├── app.js         # 客户端逻辑
│   └── style.css      # 样式
├── data/              # → symlink → D:\311-building-b-data\data\
├── uploads/           # → symlink → D:\311-building-b-data\uploads\
├── start.bat
├── stop.bat
└── package.json
```

## 启动方式

```bash
cd /c/Users/罗/311-building-b
node server.js
```

或双击 `start.bat`。

端口 3000，监听 `0.0.0.0`。

## 数据存储

- `data/users.json` — 用户（bcrypt 密码哈希）
- `data/messages.json` — 消息（最多 2000 条）
- `uploads/` — 聊天文件
- `uploads/avatars/` — 用户头像

两个目录是 symlink，指向 D 盘：
```
data    → D:\311-building-b-data\data
uploads → D:\311-building-b-data\uploads
```

## 已实现功能

- 注册/登录（bcrypt 密码）
- 文字消息、图片、文件发送
- 在线成员列表、输入状态提示
- 个人头像设置
- 管理员面板（查看用户列表、新注册通知、清空全部聊天记录）
- **消息撤回**：右键消息 → 撤回（本人或管理员），留灰字提示
- **管理员禁言**：右键成员头像 → 禁言 1/2/10 分钟，被禁言者输入框锁定+倒计时，全员侧边栏显示 🔇 标记，重连恢复禁言状态，到期自动解禁

## 管理员账户

- 首次启动自动创建：用户名 `罗文俊`，密码由 `ADMIN_PASSWORD` 环境变量或默认 `luo20070606`
- 管理员 `isAdmin: true`，ID 以 `admin-` 开头

## 踩坑记录

### 1. symlink 路径问题

`data/` 和 `uploads/` 是 symlink，服务端用 `path.join(__dirname, 'data', ...)` 可以正确跟随。但从外部脚本直接 `require('./data/users.json')` 同样可以跟随 symlink，前提是在项目根目录下执行。用绝对路径 `require('/d/311-building-b-data/data/users.json')` 反而可能因 Node.js CJS 模块解析对非 `.js` 文件处理不同而报 `MODULE_NOT_FOUND`。

**结论**：始终从项目根目录 `C:\Users\罗\311-building-b` 执行 Node.js 命令，用相对路径 `./data/users.json`。

### 2. 服务端代码缩进

server.js 和 app.js 混用了空格和 Tab 缩进，编辑时注意匹配原有缩进（server.js 以 2 空格为主，但部分行是 4 空格）。用 Edit 工具替换文本时，需要精确匹配原始空白字符。

### 3. Admin 密码测试

通过 curl 测试 admin API 需要知道 bcrypt 原始密码。如果密码被改过，只能通过 Web UI 登录或直接修改 `users.json` 重置。快速重置方法：

```bash
node -e "
const u=require('./data/users.json');
const a=u.find(x=>x.isAdmin);
a.password=require('bcryptjs').hashSync('新密码',10);
require('fs').writeFileSync('./data/users.json',JSON.stringify(u,null,2))
"
```

### 4. 消息撤回数据一致性

撤回只删 `messages.json` 中的记录，不影响 `uploads/` 中的文件。如果撤回的是图片/文件消息，文件仍保留在磁盘上。目前没有级联删除文件的逻辑。

### 5. 禁言持久化

禁言状态存储在服务端内存 `Map` 中，服务重启后禁言全部失效。如果需要持久化禁言，需要写入文件并在启动时恢复。

### 6. 并发禁言

同一个用户被连续禁言时，新的 `setTimeout` 会 `clearTimeout` 旧的，以新的时长为准。到期时统一通过 `user-unmuted` 通知全员。
