# 浮词

> **English** — Look up English, Japanese, or Chinese without leaving the page. **[Read in English →](README.en.md)**
>
> **日本語** — 読んでいるページを離れずに、中・英・日を引けます。**[日本語で読む →](README.ja.md)**
>
> **中文** — 本页就是中文说明，往下读即可。

读英文或日文时，不用再切去浏览器查词。浮词贴在屏幕最上层：打一个词，卡片马上出现；打一整句，只给整句译文和逐词释义。查过的词留在本机，下次不用再等。

界面可以一键换成中文、日语或英语。这只改按钮和说明。译文方向在搜索框上：中文、日语、英语可以两两互译。中文用简体还是繁体，在设置里选。

## 看一眼就知道它做什么

平时只有一条搜索框，挡不住正在读的内容。

![悬浮搜索框](docs/bar.png)

单词会展开成一张卡片：译文、音标、词性、英英释义、例句，还能点喇叭听读音。

![单词卡片](docs/word.png)

句子不铺成词条，只留整句译文、拼音或音标，以及逐词释义。

![句子卡片](docs/sentence.png)

双击搜索框左侧的放大镜，它会收成一颗小球，停在桌面上。双击小球再展开。

![悬浮球](docs/orb.png)

设置页最上面就是界面语言。点「中文」「日本語」或「English」，按钮和菜单立刻换成那种语言。

![设置里的界面语言](docs/settings.png)

换成英语之后，卡片上的「单词」「复制」会变成 Word、Copy。译文本身仍按你设的方向显示，所以英文界面下也可以继续把英语译成中文。

![英语界面下的单词卡片](docs/en/word.png)

主题有七种：晴空、青竹、朱砂、藤紫、琥珀、海棠、夜色。点一下，搜索条、白板和悬浮球一起换。不透明度拉杆同时作用于搜索框和结果板，默认 88%。下面是夜色、64% 的样子，主题色块和拉杆都在这一页。

![主题和透明度](docs/look.png)

## 下载

在 [全部版本](https://github.com/jayson-sheyue/fuci/releases) 里下载安装包。打开后把「浮词」拖进「应用程序」。这是 Apple 芯片（arm64）的安装包。

- [1.3.0（当前）](https://github.com/jayson-sheyue/fuci/releases/download/v1.3.0/fuci-1.3.0-arm64.dmg)
- [1.2.2](https://github.com/jayson-sheyue/fuci/releases/download/v1.2.2/fuci-1.2.2-arm64.dmg)
- [1.2.1](https://github.com/jayson-sheyue/fuci/releases/download/v1.2.1/fuci-1.2.1-arm64.dmg)
- [1.2.0](https://github.com/jayson-sheyue/fuci/releases/download/v1.2.0/fuci-1.2.0-arm64.dmg)
- [1.1.0](https://github.com/jayson-sheyue/fuci/releases/download/v1.1.0/fuci-1.1.0-arm64.dmg)

从浏览器下载的安装包没有苹果公证。第一次打开如果弹出「“浮词” Not Opened」，点 **Done**，不要点 Move to Trash。然后在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/浮词.app
open /Applications/浮词.app
```

也可以点 Done 之后，打开「系统设置 → 隐私与安全性」，在安全性一栏点「仍要打开」。

## 启动

也可以双击桌面上的「浮词.app」。从这份源码执行 `npm run pack` 时，它和项目里的 `dist/浮词.app` 会一起换成新打的包，并在 `dist/` 写出上面的 DMG。

从源码重新打包：

```bash
npm install
npm run pack
```

开发时也可以 `npm start`。搜索条会停在所有桌面的最上层。`⌘⇧Space` 呼出（如果被占用，则改用 `⌘⇧D`）。双击左侧放大镜收成悬浮球，双击悬浮球再展开。按住放大镜或悬浮球可以拖动。`Esc` 先收起白板，再按一次收成悬浮球。搜索框上的方向按钮默认是「英→中」。点一下按英→中、英→日、日→中、日→英、中→英、中→日循环。界面换成英语时，按钮显示成 EN→ZH 这一类。

查完整的单词和句子会记在本机，大约保留最近 400 条。下次同样的查询直接用这份结果，不用再等翻译接口和 Gemini。英文大小写视为同一个词。译文方向、模型或区域不同时另存一份。不完整的结果不会被记住，比如词条接口失败，或者句子还缺读音、缺逐词释义。点小喇叭朗读仍然会向语音接口要音频。

设置页标题右侧会显示当前版本。同一页可以一键切换界面语言：中文、日语、英语。也可以选七种主题：晴空、青竹、朱砂、藤紫、琥珀、海棠、夜色。点一下立即换上，搜索条、白板和悬浮球一起变。设置页底部有「退出」和「重启」，都会先保存当前设置。齿轮或悬浮球上出现红点时，表示 GitHub 上的 `main` 有可以快进的新版本。打开设置，点「更新」：源码运行的会 `git pull`，安装包会下载仓库里的最新程序文件并换掉应用里的代码。本机的设置、登录和查词缓存都留着。本地还有没推上去的提交时，不会覆盖。

## 连接 GCP

仓库里没有项目 ID、访问令牌或 Google 账号，这些只保存在本机。DMG 里带有 Google Cloud CLI，装好就能点「一键链接」，不用先在电脑上安装 gcloud。设置里填写项目 ID、Location 和模型 ID。点「一键链接」后，应用执行 `gcloud auth print-access-token` 取得大约 1 小时的访问令牌。如果还没登录，会自动打开浏览器完成 `gcloud auth login`。右侧倒计时结束或显示已失效时，再点一次一键链接。同一页的「面板不透明度」拉杆会同时调整搜索框和结果板，默认 88%，拖动后立即生效。「中文用字」决定方向里的中文是简体还是繁体。改完后，当前查询会按新写法重查。

项目需要已开通结算，并启用 Cloud Translation API 和 Vertex AI API。登录的账号需要有这两个 API 的调用权限。

单词查询会同时调用两个接口：

- **Cloud Translation API**：按搜索框上的方向出译文。句子也优先走这里
- **Vertex AI Gemini**（默认 `gemini-3.8-flash`，区域 `global`）：词条的音标、假名或拼音，以及词性、释义和例句

如果 Cloud Translation 还没启用，句子会先由 Gemini 翻译，白板底部会写明。启用之后自动改走翻译接口。词条由模型生成，生僻读音建议再核对。

如果 `npm start` 说 Electron 没有安装成功，通常是公司证书挡住了 Node 的下载。改用系统自带的 curl 下载 `electron-v版本号-darwin-arm64.zip`，解压到 `node_modules/electron/dist`，并让 `node_modules/electron/path.txt` 的内容为 `Electron.app/Contents/MacOS/Electron`。
