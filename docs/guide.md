# Apple Books 阅读档案使用指南

[返回首页](../README.md) · **简体中文** · [English](guide.en.md)

这里保留完整的运行、导出和排错说明。首次使用可先看首页的 [快速开始](../README.md#快速开始)。以下命令默认在项目根目录执行。

## 环境要求

- Go 1.25 或更高版本
- 推荐使用 macOS，以便直接读取最新的 Apple Books 数据及本机 EPUB
- Windows 和 Linux 可以运行，但需要先从 Mac 手动复制 SQLite 数据库

## macOS：自动读取最新数据

在 macOS 上直接运行：

```bash
go run ./cmd/apple-books
```

程序会自动查找以下目录中最新的 `.sqlite` 文件：

```text
~/Library/Containers/com.apple.iBooksX/Data/Documents/BKLibrary/
~/Library/Containers/com.apple.iBooksX/Data/Documents/AEAnnotation/
~/Library/Group Containers/group.com.apple.iBooks/Documents/BCCloudData-BookDataStoreService/CRDTModelSync-ReadingHistoryModel/
```

阅读历史使用 Apple 的 CRDT 格式存在 SQLite 的 `ZCRDTMODELSYNCENTITY.ZPROTODATA` 中。当前支持 macOS 上已验证的 CRDT v4；遇到未知版本时，年度页会明确显示格式不支持，其他书库和批注功能仍可使用。

然后访问：

<http://127.0.0.1:8787>

自动读取是推荐方式，因为 Apple Books 的最新变更可能仍在 SQLite 的 WAL 文件中。程序以只读模式连接数据库，可以读取这些最新记录，不会执行写入或迁移。

如果阅读历史数据库打开失败，程序仍会启动，书库和批注功能可继续使用；阅读时长区域会显示失败原因，日志会记录数据库完整路径。排除文件访问问题后，需要重启程序以重新连接阅读历史数据库。

### iCloud 书籍与批注同步

Apple Books 会分别同步书籍元数据、电子书文件和批注。一本书已经出现在书库或“阅读中”列表里，并不代表它的高亮与笔记已经写入本机的 `AEAnnotation` 数据库。对于仅保存在 iCloud、尚未下载的书籍，本工具可能提示“本机暂未发现这本书的高亮或笔记”，导出的 Markdown 也可能没有正文。

遇到这种情况时：

1. 在 Apple Books 中找到该书并下载到本机。
2. 打开书籍一次，等待高亮和笔记完成同步。
3. 返回本工具，刷新页面或重新打开书籍详情。
4. 如果仍未出现，重启本工具，使其重新建立数据库连接。

本工具不会调用 Apple 的私有接口强制触发 iCloud 下载；书籍文件和批注的首次同步仍需由 Apple Books 完成。原始 EPUB 是否可访问主要影响章节标题识别，而高亮与笔记正文能否导出，取决于相关记录是否已经同步到本机 `AEAnnotation` 数据库。

程序并不是在启动时把整个数据库永久加载到内存：每次页面请求都会重新执行只读 SQL 查询。因此，如果 Apple Books 将新批注正常提交到同一个 SQLite 数据库，刷新页面或重新打开详情通常就能看到变化。但是，本工具目前没有自动轮询或文件变更监听；如果 Apple Books 在同步时替换了数据库或 WAL 文件，已有连接可能继续指向旧文件，此时需要重启本工具。

### macOS 权限

首次访问 Apple Books 容器时，macOS 可能要求授权。请允许启动程序的应用访问相关文件，例如 Terminal、iTerm2、Ghostty、Warp、IDE 或 Codex。

日志中的 `unable to open database file: out of memory (14)` 也可能与文件访问权限有关。SQLite 错误码 `14` 表示 `SQLITE_CANTOPEN`（无法打开数据库文件）；不能仅凭附带的 `out of memory` 文案判断内存不足。如果同一程序在一个终端或 Codex 中能读取数据库，在另一个应用中失败，应优先检查实际启动程序的应用权限。此错误也可能由路径不存在或数据库及其 `-wal`、`-shm` 辅助文件无法访问引起，并不专指权限问题。

如果没有出现弹窗，但日志显示 `operation not permitted` 或 `permission denied`：

1. 打开“系统设置”。
2. 进入“隐私与安全性” → “完全磁盘访问权限”。
3. 为实际启动本程序的应用开启权限，例如 iTerm2、Ghostty、Warp、Terminal、IDE 或 Codex；只为其他终端授权不会解决当前应用的权限问题。
4. 完全退出并重新打开该应用，然后再次运行程序。

程序只需要读取权限，不需要修改 Apple Books 数据。

对于上述错误码 `14`，可以先在报错的同一个终端中运行以下只读查询，路径请使用日志中的实际数据库路径：

```bash
sqlite3 -readonly "/path/from/log/CRDTModelSync-ReadingHistoryModel" \
  'SELECT COUNT(*) FROM sqlite_master;'
```

如果查询同样失败，检查路径和文件访问权限；如果查询成功而 Go 程序仍失败，请保留两者的输出继续排查，不要直接认定为权限问题。退出 Apple Books 不会授予终端访问权限，相关后台服务也可能继续运行。不要为了消除报错而删除 `-wal`、`-shm` 文件。

## 手动复制数据库

无法或不希望授权直接访问时，可以使用数据库快照。建议先完全退出 Apple Books，再复制主数据库以及对应的 `-wal`、`-shm` 文件：

```bash
mkdir -p BKLibrary AEAnnotation ReadingHistory

cp ~/Library/Containers/com.apple.iBooksX/Data/Documents/BKLibrary/*.sqlite* \
  ./BKLibrary/

cp ~/Library/Containers/com.apple.iBooksX/Data/Documents/AEAnnotation/*.sqlite* \
  ./AEAnnotation/

cp ~/Library/Group\ Containers/group.com.apple.iBooks/Documents/BCCloudData-BookDataStoreService/CRDTModelSync-ReadingHistoryModel/CRDTModelSync-ReadingHistoryModel* \
  ./ReadingHistory/
```

在 macOS 上，如果系统数据库仍可访问，自动发现会优先使用系统中的最新数据。要明确使用刚复制的快照，请同时指定两个数据库参数：

```bash
go run ./cmd/apple-books \
  -library-db "./BKLibrary/BKLibrary-1-091020131601.sqlite" \
  -annotation-db "./AEAnnotation/AEAnnotation_v10312011_1727_local.sqlite" \
  -reading-history-db "./ReadingHistory/CRDTModelSync-ReadingHistoryModel"
```

文件名可能随 Apple Books 版本变化，请以实际复制出的文件名为准。书库和批注两个参数必须同时提供；阅读历史参数可选。

也可以修改本机监听端口；为避免阅读数据暴露到局域网，程序只接受回环地址：

```bash
go run ./cmd/apple-books \
  -library-db "/path/to/BKLibrary.sqlite" \
  -annotation-db "/path/to/AEAnnotation.sqlite" \
  -addr "127.0.0.1:9000"
```

## Windows 与 Linux

Windows 和 Linux 无法直接访问 macOS 的 Apple Books 容器。需要先在 Mac 上退出 Apple Books，按照上一节复制数据库，再把 `BKLibrary` 和 `AEAnnotation` 目录传到运行本程序的计算机。

在项目根目录执行：

```bash
go run ./cmd/apple-books \
  -library-db "/path/to/BKLibrary.sqlite" \
  -annotation-db "/path/to/AEAnnotation.sqlite"
```

高亮和笔记正文仍然可以从 SQLite 数据库导出，但章节识别通常会受到限制：数据库中的书籍路径指向 Mac 的 iCloud 或 Apple Books 存储位置，Windows/Linux 无法访问这些原始 EPUB。此时 Markdown 仍会导出内容，并将无法解析的条目标记为“未识别章节”，同时保留原始 EPUB 定位。

## 使用方法

### 导出一本书的高亮与笔记

1. 在书库中搜索或找到目标书籍。
2. 点击书籍卡片打开详情。
3. “隐藏笔记类型和时间”默认勾选；如需保留“高亮 · 时间”等标题，取消勾选，再点击“导出本书高亮与笔记”。
4. 浏览器会下载一个以书名命名的 Markdown 文件。

详情页展示这本书已同步到本机的全部划线与笔记，没有分页限制，默认按创建时间正序显示（最早在前）。可在“批注与笔记”旁的“显示顺序”中切换为倒序（最新在前）；该选项只控制页面展示，Markdown 仍按章节与书中位置整理。

“隐藏引用竖线和分隔横线”也默认勾选，摘录以普通段落导出，条目之间用空行分隔。取消勾选可恢复引用样式和分隔线；此选项与类型和时间的选项独立。

如果原始 EPUB 可访问且没有 DRM 限制，导出内容会按照 EPUB 目录显示章节标题。一本书被拆分为多个 HTML 文件时，程序也会将它们归入正确章节。

### 导出藏书列表

先设置搜索、阅读状态、年份和排序条件，再点击页面右上角的“导出当前列表”。CSV 只包含当前筛选结果。

### 随机回顾

首页会从历史高亮中选择一条内容。开启“仅看笔记”后，只会回顾附带个人笔记的摘录；点击书名可以打开对应书籍详情。

### 搜索全部批注

在“搜索全部批注”区域输入高亮或笔记中的文字，也可以按批注类型和 Apple Books 高亮颜色继续筛选。点击搜索结果中的书名可以打开完整书籍详情。

### 年度报告与智能选书

年度报告按批注创建日期展示月度趋势和批注活跃日；活跃日代表当天创建过批注，不等同于完整阅读天数。智能选书支持从未读书、超过 90 天未打开的在读书，以及整个书库中随机挑选。

## 数据说明

- `BKLibrary` 保存藏书元数据、阅读进度及相关日期。
- `AEAnnotation` 保存高亮、笔记、书签和 EPUB CFI 定位。
- `ZANNOTATIONTYPE=3` 是系统维护的阅读位置，不属于用户批注，程序会将其排除。
- 收集时间取购买日期、书库记录日期（`ZUPDATEDATE`）与数据库对象创建日期中的最早有效值，以减少数据库迁移时间造成的偏差。
- Apple Books 使用的是私有数据库结构；Apple 可能在未来的 macOS 版本中调整表或字段。

## 章节识别限制

批注数据库不直接保存人类可读的章节标题，只保存 EPUB CFI 定位。程序需要读取原始 EPUB 的 package、spine 和目录文件，才能将定位映射为章节。

以下情况可能无法识别章节：

- 原始 EPUB 已被删除或尚未从 iCloud 下载
- Apple Books 数据库来自另一台 Mac
- 在 Windows 或 Linux 上运行，无法访问数据库中记录的 Mac 路径
- 书籍带有 DRM，或者 EPUB 目录结构不完整
- PDF 或其他不使用 EPUB CFI 的内容

章节识别失败不会阻止导出高亮和笔记正文。

需要注意：原始 EPUB 是否存在只影响章节识别；高亮和笔记正文来自 `AEAnnotation` 数据库。但如果 Apple Books 尚未把云端批注同步到本机数据库，正文同样无法导出。请先在 Apple Books 中下载并打开对应书籍。

## 隐私与安全

- SQLite 数据库始终以只读模式打开。
- Web 服务默认只监听 `127.0.0.1`，不会暴露到局域网。
- 页面不会上传书籍、批注或阅读记录。
- 页面不会加载远程封面、字体或分析脚本。
- SQLite 数据库、WAL 文件和运行日志已被 `.gitignore` 排除。

## 测试

```bash
go test ./...
```

测试使用系统级 Go 构建缓存，不会在工程目录创建 `.cache`。

## 日志

日志按照 `slogx` 的约定写入程序运行目录下的 `logs/`。发生数据库权限、字段兼容性或 EPUB 章节解析问题时，请先检查这里的日志。
