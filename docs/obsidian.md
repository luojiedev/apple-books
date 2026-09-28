# Obsidian 插件：Apple Books 阅读档案

插件直接读取本机 Apple Books 的 SQLite 数据库。可以在 Obsidian 内浏览书库、搜索摘录、随机回顾、查看年度报告，并将高亮与笔记同步为 Markdown。业务代码使用 TypeScript，SQLite 的 JavaScript 引擎随 `main.js` 一起发布，无需 Go、外部可执行程序或服务器。

当前版本 **0.2.1**，适用于 **macOS 的 Obsidian 桌面版 1.8.0 及以上**。Apple 芯片和 Intel Mac 使用同一个安装包。移动端、Windows 和 Linux 可以阅读已同步的 Markdown，但不能运行本插件。源数据需先通过 Apple Books 同步到这台 Mac。

## 安装：不需要 Go、Git 或终端

1. 下载 `apple-books-reading-archive.zip`。本地构建产物在 `dist/obsidian-0.2.1/`。
2. 解压，将整个 `apple-books-reading-archive` 文件夹放进你的 Obsidian 仓库下的 `.obsidian/plugins/`。Finder 中可按 `Command + Shift + .` 显示隐藏文件夹。
3. 在 Obsidian「设置 → 第三方插件」中启用 **Apple Books Reading Archive**；必要时重新启动 Obsidian。
4. 点击左侧书本图标，进入阅读档案。插件自动发现书库，直接在内存中读取数据。
5. 如连接失败，打开面板的「设置与连接」，点击「检测连接」。数据库权限不足时，在 macOS「系统设置 → 隐私与安全性 → 完全磁盘访问权限」中允许 Obsidian，并完全退出后重新打开。

插件目录只需 `main.js`、`manifest.json`、`styles.css` 三个文件。没有首次依赖下载、辅助程序安装、子进程或网络请求。升级时禁用插件、替换这三个文件，再启用即可；保留 `data.json` 和已有 Markdown。旧版本安装的辅助程序不再使用，本版本不会启动或删除它。

插件目前提供本地安装包，**尚未提交 Obsidian 社区目录，也不会由开发命令自动发布**。此版本移除了自行安装依赖的流程，但不代表已通过社区审核；正式提交前还需维护者选定项目许可证并完成审核。

### 书库正常，但阅读时长显示「暂不可用」

阅读历史保存在独立的 macOS 受保护目录，能读取书籍与批注不代表能读取阅读历史及其 WAL。0.2.1 起，概览、年度报告和「检测连接」会显示具体失败原因。

如果提示 macOS 拒绝读取（日志为 `EPERM` 或 `EACCES`），在「系统设置 → 隐私与安全性 → 完全磁盘访问权限」中添加或开启 Obsidian，然后按 `⌘Q` 完全退出再打开。仅关闭窗口或切换标签页不等于重启应用。无需重新同步 Markdown。

如果提示未找到数据库，应先在本机 Apple Books 完成同步；如果使用自定义书库，需同时指定来自同一数据来源的阅读历史数据库路径。插件不会绕过系统权限或仅忽略 WAL 来显示可能过期的时长。

## 使用

- **阅读概览**：书库数量、在读书籍、累计批注、可用的累计阅读时长和随机回顾；支持只回顾带笔记的批注。
- **我的书库**：按书名/作者搜索，按阅读状态或欲读清单筛选，勾选单本或多本书同步。欲读清单模式不支持关键词搜索。
- **搜索摘录**：跨书搜索高亮正文与 Apple Books 个人笔记，点击书名查看详情。
- **年度报告**：年度读完数量、阅读时长、批注活跃日、月度分布与批注最多的书。
- **同步高亮与笔记**：同步所有有批注的书，以及此前同步过、但后来删掉了全部批注的书。没有批注且从未同步的书不会批量生成空文件；仍可在书库中手动选中同步。
- **启动时同步**：默认关闭，可在插件设置开启。出现冲突时会展示具体书籍与原因。

阅读时长使用 TypeScript 解析本项目已支持的 ReadingHistoryModel CRDT v4。缺失或不支持时显示「暂不可用」，不会显示为零或根据批注日期推测时长。章节识别需要本机可访问、无 DRM 限制且结构可解析的 EPUB；无法解析时仍可同步正文。

## 同步规则与个人内容保护

每本书对应一个 Markdown 文件。书籍通过 `assetId` 识别，批注通过 `UUID` 生成稳定块标识。文件名包含书名与书籍标识摘要，同名书不会混写。

文件中的 `<!-- apple-books:begin ... -->` 到 `<!-- apple-books:end -->` 为自动生成区域。**请把自己的心得写在标记外**，例如默认的「我的读书心得」章节。标记外的正文和已有 frontmatter 属性均保持原样。

- 重复同步相同内容，不重复追加、不更新时间戳、不重写无变化的文件。
- 原始书名变化，或你在仓库内改名、移动笔记，仍会更新原文件。插件会扫描仓库 Markdown 中的同步标识。
- 在 Apple Books 修改或删除批注，下次同步会更新自动区域；源书籍不再存在时，不自动删除已有笔记。
- 自动区域内容有 SHA-256 校验。如果你直接编辑了其中内容，插件会**跳过该书并保留原文**，不会覆盖，也不会将数据丢失当成成功。
- 标记损坏、同书存在多个同步文件、缺失/重复批注 UUID、目标文件名被其他文件占用时，同样保留现有文件并报告问题。
- 更新通过 Obsidian `Vault.process()` 读取最新正文后写入，保留同步期间在标记外的编辑。

遇到冲突时，先把需保留的内容移到标记外，再通过 Obsidian 文件恢复或备份还原被修改的自动区域。如果无法恢复，可将整份原笔记移到仓库外保存，再重新同步本书，并手动整理心得。插件不提供静默强制覆盖。

批注正文按文本转义，不执行来源中的 HTML，也不会把来源里的图片语法或嵌入语法变成远程资源加载。

## 本地文件访问与读取一致性

- 使用 Node.js 文件系统 API，只读访问 Vault 之外的 Apple Books 书库、批注及阅读历史数据库，原因是这些数据由 Apple Books 保存在 macOS 容器中。为识别章节，还会读取书库记录指向的 EPUB 及其目录文件。
- 默认数据库位置为 `~/Library/Containers/com.apple.iBooksX/Data/Documents/` 下的 `BKLibrary/` 和 `AEAnnotation/`。阅读历史位于 `~/Library/Group Containers/group.com.apple.iBooks/Documents/BCCloudData-BookDataStoreService/CRDTModelSync-ReadingHistoryModel/CRDTModelSync-ReadingHistoryModel`。
- 插件以 `r` 模式打开源文件，不写数据库、不创建源目录下的 WAL/SHM、不执行 checkpoint。SQL 仅运行在内存副本上，并启用 `query_only`。
- 同时读取主数据库、WAL、SHM 和回滚日志。读取前后校验文件状态，并比较两次读取的完整内容；WAL 校验页大小、salt、滚动校验和与提交边界。有 SHM 时仅使用其已发布提交，拒绝进行中的 checkpoint。之后对内存副本运行 SQLite `quick_check`。
- 这些检查用于发现并发变化，不是 SQLite 原生的加锁备份 API，也不提供多个 Apple Books 数据库之间的原子事务。遇到变化、校验失败或回滚日志时会停止该次读取，保留已有笔记并提示重试。持续失败时请退出 Apple Books，等待后台同步结束；自定义路径应来自一致性备份，不能只复制正在使用的主数据库而丢掉 WAL。
- 为控制内存占用，单个数据库、WAL 或最终数据库镜像上限为 128 MB；EPUB 文件上限 128 MB，单个目录 XML 上限 2 MB。超限数据库会明确报错，EPUB 超限仅影响章节名称。
- 当前支持本项目已有的 Apple Books 私有表结构，没有添加其他版本的兼容分支。数据库结构不受支持时会报错，避免将解析失败误当作空书库。
- 插件不访问网络、不发送书籍或笔记。调试与错误日志写入 Obsidian 开发者工具 Console，可筛选 `[Apple Books]`；不记录摘录正文与搜索词，错误可能包含本机路径。
- `sql.js`、`fflate`、`@xmldom/xmldom` 在构建时打包进插件，相关许可声明包含在 `main.js` 中。

## 开发与打包

开发需要 Node.js 24 和 pnpm。插件构建和测试不需要 Go；最终用户不需要任何开发工具。

```bash
cd obsidian-plugin
pnpm install --frozen-lockfile
pnpm test
pnpm package
```

打包生成单个通用 ZIP 和标准插件文件。修改版本时应同时更新 `manifest.json`、`package.json` 和 `versions.json`。SQLite 使用 sql.js 的 asm.js 分发版本，因此没有 `.node` 原生扩展或运行时 WASM 下载。

测试用 Node 内置 SQLite 创建虚构书库，覆盖真实 WAL 提交/回滚与缓存刷新、只读性、数据库损坏、阅读时长、EPUB 章节和同步冲突；不读取用户的真实 Apple Books 数据。

`.github/workflows/obsidian.yml` 可以手动构建产物。推送 `obsidian-0.2.0` 形式的标签会生成 **Draft Release**，需要维护者检查后发布。现有 Go Web 工具独立保留，不是插件依赖。

## 代码结构

- `obsidian-plugin/src/database-paths.ts`：本机数据库发现与自定义路径校验。
- `obsidian-plugin/src/sqlite-snapshot.ts`：只读快照、WAL 提交恢复与变化检查。
- `obsidian-plugin/src/apple-books-library.ts`：内存 SQLite 查询、缓存、搜索和年度报告。
- `obsidian-plugin/src/reading-history.ts`：CRDT v4 阅读时长解析。
- `obsidian-plugin/src/chapters.ts`：EPUB 目录解析与 CFI 章节映射。
- `obsidian-plugin/src/documents.ts`：稳定标识、Markdown 文本转义、受管区域校验。
- `obsidian-plugin/src/sync.ts`：串行同步、按书错误隔离、冲突保护。
- `obsidian-plugin/src/view.ts`：原生 Obsidian 阅读面板。

此前的 Go 辅助程序、stdio 协议、下载器和安装器均已移除。
