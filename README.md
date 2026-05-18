# Unity WebRunner


![Unity WebGL](https://img.shields.io/badge/Unity-WebGL-black?style=for-the-badge&logo=unity)
![Electron App](https://img.shields.io/badge/Electron-App-47848F?style=for-the-badge&logo=electron&logoColor=white)
![Node.js Local Server](https://img.shields.io/badge/Node.js-Local_Server-339933?style=for-the-badge&logo=node.js&logoColor=white)
![GitHub Repo stars](https://img.shields.io/github/stars/UmerAalam/unitywebrunner?style=social)

Unity WebRunner is a lightweight Electron app for running Unity WebGL builds locally.

It starts a local server for your Unity WebGL export, so you can test your game without manually setting up Node.js, Python servers, MIME types, or compression headers.

Useful for testing Unity WebGL builds before uploading to itch.io, Netlify, Cloudflare Pages, GitHub Pages, or any web host.

<img width="1919" height="1025" alt="image" src="https://github.com/user-attachments/assets/ca1d22e6-d5bd-44dd-921e-2df1d1d729b5" />


## Features

- Run Unity WebGL builds locally
- Built with Electron and Node.js
- Supports Unity WebGL `.wasm`, `.data`, `.js`, `.gz`, and `.br` files
- Helps fix common local WebGL loading issues
- Available for Linux, Windows, and macOS Intel

## Download

Download the latest build from the **Releases** page.

Available builds:

- `unitywebrunner-linux`
- `unitywebrunner-windows`
- `unitywebrunner-macos-intel`

## Install from ZIP

Download the ZIP for your operating system, extract it, then run the app.

### Linux

```bash
unzip unitywebrunner-linux.zip
cd unitywebrunner-linux
chmod +x unitywebrunner-linux
./unitywebrunner-linux
````

### Windows

Extract the ZIP and run the `.exe` file.

### macOS Intel

Extract the ZIP and open the app.

If macOS blocks it, allow it from:

```text
System Settings → Privacy & Security
```

## Run from Source

```bash
git clone https://github.com/UmerAalam/unitywebrunner.git
cd unitywebrunner
npm install
npm run dev
```

You can also download the source as ZIP, extract it, then run:

```bash
npm install
npm run dev
```

## Build

```bash
npm run dist:linux
npm run dist:win
```

Builds are created inside the `release/` folder.

## How to Use

Export your Unity project as WebGL.

Your build folder should contain:

```text
index.html
Build/
TemplateData/
```

Open Unity WebRunner, select your WebGL build folder, then run it locally in your browser.

## Why Use This?

Opening Unity WebGL directly from `index.html` can cause errors like:

```text
Unable to parse Build/*.framework.js.gz
Unable to parse Build/*.framework.js.br
Compression enabled but server headers are missing
```

Unity WebRunner serves the build through a local server, which makes WebGL testing easier.

## GitHub Topics

```text
unity
unity-webgl
webgl
electron
nodejs
local-server
gamedev
unity-tools
webgl-runner
desktop-app
```

## Release Tags

```bash
git tag v1.0.0
git push origin v1.0.0
```

## Author

Created by **Umer Aalam**

GitHub: [@UmerAalam](https://github.com/UmerAalam)
Instagram: [@umerrazzaq2022](https://instagram.com/umerrazzaq2022)
YouTube: [@umergamedev](https://youtube.com/@umergamedev)

## License

MIT License
