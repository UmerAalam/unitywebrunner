# 🚀 UnityWebRunner

Run **Unity WebGL builds locally** using **Bun + Docker** with ease.

A lightweight TypeScript-based server for serving Unity WebGL builds without complex setup.



## ⚡ Features

* 🧩 Run Unity WebGL builds locally
* 🐳 Docker support (one command setup)
* 🟡 Built with **Bun + TypeScript**
* ⚡ Fast static file serving
* 📦 Simple and minimal setup



## 🛠️ Requirements

### Option 1 — Without Docker (Recommended for Dev)

Install **Bun**:
👉 [https://bun.sh](https://bun.sh)



### Option 2 — With Docker

Install Docker:
👉 [https://www.docker.com](https://www.docker.com)



## 🚀 Run Locally (Without Docker)

```bash
bun install
bun run index.ts
```

Then open:

```
http://localhost:8000
```



## 🐳 Run with Docker

### 1️⃣ Build Image

```bash
docker build -t unitywebrunner .
```

### 2️⃣ Run Container

```bash
docker run -p 8000:8000 unitywebrunner
```



## 📁 How It Works

* Serves Unity WebGL build files
* Runs a simple Bun HTTP server
* Uses TypeScript for clean structure
* Exposes port **8000**



## 📌 Default Docker Setup

```dockerfile
FROM oven/bun:latest

WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install

COPY . .

EXPOSE 8000

CMD ["bun", "run", "index.ts"]
```



## 🌐 Use Case

* Testing Unity WebGL builds locally
* Serving builds without external hosting
* Quick development preview environment



## ⚡ Quick Start (One Line)

```bash
bun install && bun run index.ts
```


## 📜 License

MIT
