# 浮词

> **English** — This page.
>
> **中文** — 不用离开正在读的页面就能查词。**[阅读中文说明 →](README.md)**
>
> **日本語** — 読んでいるページを離れずに、中・英・日を引けます。**[日本語で読む →](README.ja.md)**

浮词 stays on top of whatever you are reading. Type a word and a card appears. Type a sentence and you get the whole translation plus a gloss for each word. You do not have to leave the page. Lookups you have already made stay on this Mac, so the next time they come back without waiting.

The interface can be Chinese, Japanese, or English. That only changes buttons and labels. Translation direction is the button on the search bar: Chinese, Japanese, and English can translate into each other. When Chinese is involved, simplified or traditional is chosen in settings.

## What it does

Most of the time it is only a search bar, so it does not cover the page.

![Floating search bar](docs/en/bar.png)

A word opens into a card: translation, pronunciation, part of speech, a same-language gloss, an example, and a speaker button.

![Word card](docs/en/word.png)

A sentence stays a sentence. You get the translation, a pronunciation line, and a short gloss for each word.

![Sentence card](docs/en/sentence.png)

Double-click the magnifying glass to collapse 浮词 into an orb. Double-click the orb to open it again.

![Floating orb](docs/en/orb.png)

Interface language is the first control in settings. Choose 中文, 日本語, or English and the buttons and menus switch at once. The translation itself still follows the direction button, so an English interface can keep translating English into Chinese.

![Interface language in settings](docs/en/settings.png)

There are seven themes: Sky, Bamboo, Cinnabar, Wisteria, Amber, Crabapple, and Night. One click changes the search bar, the card, and the orb together. The opacity slider affects both the search bar and the card. The default is 88%. The picture below is Night at 64%, with the theme choices and the slider on the same page.

![Themes and opacity](docs/en/look.png)

## Download

Download a package from [all releases](https://github.com/jayson-sheyue/fuci/releases). Open it and drag 浮词 into Applications. The package is for Apple silicon (arm64).

- [1.3.0 (current)](https://github.com/jayson-sheyue/fuci/releases/download/v1.3.0/fuci-1.3.0-arm64.dmg)
- [1.2.2](https://github.com/jayson-sheyue/fuci/releases/download/v1.2.2/fuci-1.2.2-arm64.dmg)
- [1.2.1](https://github.com/jayson-sheyue/fuci/releases/download/v1.2.1/fuci-1.2.1-arm64.dmg)
- [1.2.0](https://github.com/jayson-sheyue/fuci/releases/download/v1.2.0/fuci-1.2.0-arm64.dmg)
- [1.1.0](https://github.com/jayson-sheyue/fuci/releases/download/v1.1.0/fuci-1.1.0-arm64.dmg)

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

The repository does not contain a project ID, access token, or Google account. Those stay on this Mac. The DMG includes the Google Cloud CLI, so Connect works without installing gcloud yourself. Enter the project ID, location, and model ID. Connect runs `gcloud auth print-access-token` and gets a token that lasts about an hour. If you are signed out, the browser opens for `gcloud auth login`. When the countdown ends or the token is expired, connect again. Panel opacity changes the search bar and the card together, starting at 88%, and applies as you drag. Chinese script chooses simplified or traditional for any direction that includes Chinese. The current lookup runs again after you change it.

The project needs billing, Cloud Translation API, and Vertex AI API. The signed-in account needs permission to call both.

A word lookup calls two APIs:

- **Cloud Translation API**: the translation for the direction on the search bar. Sentences use this first
- **Vertex AI Gemini** (default `gemini-3.8-flash`, region `global`): pronunciation, part of speech, glosses, and examples

If Cloud Translation is not enabled yet, a sentence is translated by Gemini first and the card says so. After you enable the API, sentences use it automatically. Dictionary entries are generated, so an unusual pronunciation is worth checking.

If `npm start` says Electron did not install, a company certificate often blocked Node’s download. Use the system `curl` to download `electron-v<version>-darwin-arm64.zip`, unzip it into `node_modules/electron/dist`, and set `node_modules/electron/path.txt` to `Electron.app/Contents/MacOS/Electron`.
