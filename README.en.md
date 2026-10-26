# 浮词

> **English** — This page. One word should not make you leave the page.
>
> **中文** — 查一个词，不该离开正在读的这一页。**[阅读中文说明 →](README.md)**
>
> **日本語** — 一つの単語のために、読んでいるページを離れたくない。**[日本語で読む →](README.ja.md)**

You are mid-page, and one word sends you to a browser. When you come back, that line is gone. 浮词 stays on top of what you are reading, so the lookup never leaves the page.

It is good at three things:

- A word becomes a card: translation, pronunciation, part of speech, and an example. A sentence stays a sentence: the translation, plus a short gloss for each word.
- Chinese, Japanese, and English translate into each other, including into your own language.
- A lookup stays on this Mac. The next time that word shows up on the page, you do not wait again.

The word stays on the page. Type it, the card opens over the text, and the page is still there when the card closes.

![Look up a word without leaving the page](docs/en/lookup.gif)

## What it does

Most of the time it is only a search bar, so it does not cover the page.

![Floating search bar](docs/en/bar.png)

A Chinese word opens into an English card: translation, pronunciation, part of speech, a same-language gloss, an example, and a speaker button. The direction button says ZH→EN.

![Chinese into English](docs/en/zh-word.png)

A Japanese word does the same, with the direction set to JA→EN.

![Japanese into English](docs/en/ja-word.png)

A sentence stays a sentence. You get the English translation, a pronunciation line, and a short gloss for each word.

![Chinese sentence into English](docs/en/sentence.png)

Double-click the magnifying glass to collapse 浮词 into an orb. Double-click the orb to open it again.

![Floating orb](docs/en/orb.png)

Interface language is the first control in settings. Choose 中文, 日本語, or English and the buttons and menus switch at once. Translation direction stays on the search bar, separate from that choice.

![Interface language in settings](docs/en/settings.png)

There are seven themes: Sky, Bamboo, Cinnabar, Wisteria, Amber, Crabapple, and Night. One click changes the search bar, the card, and the orb together. The opacity slider affects both the search bar and the card. The default is 88%. The picture below is Night at 64%, with the theme choices and the slider on the same page.

![Themes and opacity](docs/en/look.png)

## Before you start

Lookups use your own GCP project. This repository has no project ID, account, or key.

- A Mac with Apple silicon (arm64).
- A Google Cloud project with billing enabled.
- Enable these APIs on that project:
  - **Cloud Translation API** for the translation. Sentences use it first.
  - **Vertex AI API** for the dictionary entry, pronunciation, and examples. The default model is `gemini-3.8-flash` in `global`.
  - **Cloud Text-to-Speech API** only for the speaker button. Lookups work without it.
- Add the Google account you will sign in with to that project, and grant:
  - **Cloud Translation API User** (`roles/cloudtranslate.user`)
  - **Vertex AI User** (`roles/aiplatform.user`)

The installer contains the window. The first time you choose Connect, if this Mac does not already have a working gcloud, the sign-in component is downloaded once, about 80MB. Enter the project ID in settings and choose Connect. The account, token, and lookup cache stay on this Mac.

## Download

Download the package from the [release](https://github.com/jayson-sheyue/fuci/releases/tag/v1.3.3). Open it and drag 浮词 into Applications. The package is for Apple silicon (arm64).

- [1.3.3](https://github.com/jayson-sheyue/fuci/releases/download/v1.3.3/fuci-1.3.3-arm64.dmg)

The downloaded app is not notarized. If macOS says “浮词” Not Opened, click **Done**, not Move to Trash. Then run:

```bash
xattr -dr com.apple.quarantine /Applications/浮词.app
open /Applications/浮词.app
```

You can also click Done, open System Settings → Privacy & Security, and choose Open Anyway.

## Launch

You can also double-click 浮词.app on the Desktop. `npm run pack` replaces that copy and `dist/浮词.app`, and writes the DMG into `dist/`.

To pack from source:

```bash
npm install
npm run pack
```

For development, use `npm start`. The bar stays above every desktop. `⌘⇧Space` shows it, or `⌘⇧D` if that shortcut is taken. Double-click the magnifying glass to collapse it, and double-click the orb to expand it. Drag from the magnifying glass or the orb. `Esc` closes the card first, then collapses to the orb. The direction button starts at EN→ZH and cycles through EN→ZH, EN→JA, JA→ZH, JA→EN, ZH→EN, and ZH→JA. In Chinese or Japanese the same button reads 英→中 and so on.

Finished word and sentence lookups are kept on this Mac, about the latest 400. The next identical lookup uses that copy and does not wait on Translation or Gemini. English capitalization does not matter. A different direction, model, or region is stored separately. Incomplete results are not stored, such as a failed dictionary call or a sentence that is still missing pronunciation or word glosses. The speaker button still requests audio from the speech API.

The current version is shown at the right of the settings title. The same page switches the interface among Chinese, Japanese, and English, and offers the seven themes. Quit and Restart at the bottom save settings first. A red dot on the gear or the orb means `main` on GitHub can be fast-forwarded onto this install. Open settings and choose Update. A source checkout runs `git pull`. An installed app downloads the latest program files and replaces the code inside the app. Settings, sign-in, and the lookup cache stay on this Mac. A local commit that has not been pushed is left untouched.

## Connect to GCP

The repository does not contain a project ID, access token, or Google account. Those stay on this Mac. The DMG contains the window. The first Connect downloads the sign-in component, about 80MB, once, if this Mac does not already have a working gcloud. Enter the project ID, location, and model ID. Connect runs `gcloud auth print-access-token` and gets a token that lasts about an hour. If you are signed out, the browser opens for `gcloud auth login`. When the countdown ends or the token is expired, connect again. Panel opacity changes the search bar and the card together, starting at 88%, and applies as you drag. Chinese script chooses simplified or traditional for any direction that includes Chinese. The current lookup runs again after you change it.

Which APIs to enable, and which roles to grant, are listed in Before you start.

A word lookup calls two APIs:

- **Cloud Translation API**: the translation for the direction on the search bar. Sentences use this first
- **Vertex AI Gemini** (default `gemini-3.8-flash`, region `global`): pronunciation, part of speech, glosses, and examples

If Cloud Translation is not enabled yet, a sentence is translated by Gemini first and the card says so. After you enable the API, sentences use it automatically. Dictionary entries are generated, so an unusual pronunciation is worth checking.

If `npm start` says Electron did not install, a company certificate often blocked Node’s download. Use the system `curl` to download `electron-v<version>-darwin-arm64.zip`, unzip it into `node_modules/electron/dist`, and set `node_modules/electron/path.txt` to `Electron.app/Contents/MacOS/Electron`.
