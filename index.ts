import { serve } from "bun";
import { join, dirname } from "path";
import { mkdirSync } from "fs";

let ROOT_DIR = "";
let COMPRESSION: "none" | "gzip" | "brotli" = "none";
const REQUESTED_PORT = process.env.PORT ? Number(process.env.PORT) : undefined;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

async function resolveUnityAssetPath(
  rootDir: string,
  cleanPath: string,
  compression: "none" | "gzip" | "brotli",
) {
  const compressionSuffix =
    compression === "brotli" ? ".br" : compression === "gzip" ? ".gz" : "";
  const logicalPath = cleanPath.replace(/\.(br|gz)$/i, "");
  const exactPath = join(rootDir, cleanPath);
  const logicalFilePath = join(rootDir, logicalPath);
  const compressedPath =
    compressionSuffix && !cleanPath.toLowerCase().endsWith(compressionSuffix)
      ? join(rootDir, `${cleanPath}${compressionSuffix}`)
      : null;

  const candidates = [exactPath];
  if (compressedPath) {
    candidates.push(compressedPath);
  }
  if (logicalFilePath !== exactPath) {
    candidates.push(logicalFilePath);
  }

  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) {
      const encoding = candidate.endsWith(".br")
        ? "br"
        : candidate.endsWith(".gz")
          ? "gzip"
          : undefined;

      return {
        filePath: candidate,
        logicalPath,
        encoding,
      };
    }
  }

  return {
    filePath: exactPath,
    logicalPath,
    encoding: undefined,
  };
}

function detectCompressionFromFiles(fileNames: string[]) {
  const normalized = fileNames.map((name) => name.toLowerCase());

  if (normalized.some((name) => name.endsWith(".br"))) {
    return "brotli" as const;
  }

  if (normalized.some((name) => name.endsWith(".gz"))) {
    return "gzip" as const;
  }

  return "none" as const;
}

const handler = async (req: Request) => {
    const url = new URL(req.url);

    // 1. UPLOAD HANDLER (With Path Flattening)
    if (url.pathname === "/upload" && req.method === "POST") {
      const formData = await req.formData();
      const files = formData.getAll("files");
      const buildFolder = `build_${Date.now()}`;
      const uploadBase = join(process.cwd(), "uploads", buildFolder);
      COMPRESSION = detectCompressionFromFiles(
        files
          .filter((entry): entry is File => entry instanceof File)
          .map((entry) => entry.name),
      );

      for (const entry of files) {
        if (entry instanceof File) {
          // FLATTENING LOGIC:
          // If Unity sends "MyProject/Build/file.js", we strip "MyProject/"
          // to make it "Build/file.js" so index.html stays at the root.
          const parts = entry.name.split("/");
          const fileName =
            parts.length > 1 ? parts.slice(1).join("/") : entry.name;

          const dest = join(uploadBase, fileName);
          mkdirSync(dirname(dest), { recursive: true });
          await Bun.write(dest, entry);
        }
      }

      ROOT_DIR = uploadBase;
      console.log(`✅ Build Flattened & Ready: ${ROOT_DIR} (${COMPRESSION})`);
      return Response.json({ success: true, compression: COMPRESSION });
    }

    // 2. CONFIG HANDLER
    if (url.pathname === "/set-compression") {
      COMPRESSION = (url.searchParams.get("type") as any) || "none";
      return new Response(`Compression: ${COMPRESSION}`);
    }

    // 3. STATIC ASSETS (Dashboard / styles.css)
    const isIframe =
      req.headers.get("sec-fetch-dest") === "iframe" ||
      url.searchParams.has("t");

    if (!isIframe) {
      const requestedFile =
        url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
      const publicFile = Bun.file(join(process.cwd(), "public", requestedFile));

      if (await publicFile.exists()) {
        const headers = new Headers();
        const ext = "." + requestedFile.split(".").pop()?.toLowerCase();
        headers.set(
          "Content-Type",
          MIME_TYPES[ext] || "application/octet-stream",
        );
        return new Response(publicFile, { headers });
      }
    }

    // 4. UNITY GAME FILE SERVING
    if (!ROOT_DIR)
      return new Response("404: No build uploaded.", { status: 404 });

    const cleanPath =
      url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
    const { filePath: finalFilePath, logicalPath, encoding } =
      await resolveUnityAssetPath(
      ROOT_DIR,
      cleanPath,
      COMPRESSION,
    );
    const file = Bun.file(finalFilePath);

    if (await file.exists()) {
      const headers = new Headers();
      const ext = "." + logicalPath.split(".").pop()?.toLowerCase();

      headers.set(
        "Content-Type",
        MIME_TYPES[ext] || "application/octet-stream",
      );

      // Handle Unity Compression
      if (encoding) headers.set("Content-Encoding", encoding);

      // SharedArrayBuffer / Isolation headers (Required for Unity WebGL)
      headers.set("Cross-Origin-Embedder-Policy", "require-corp");
      headers.set("Cross-Origin-Opener-Policy", "same-origin");

      return new Response(file, { headers });
    }

    return new Response(`404: File not found at ${cleanPath}`, { status: 404 });
};

function start() {
  const attemptedPorts = new Set<number>();
  const candidatePorts: number[] = [];

  if (REQUESTED_PORT !== undefined) {
    candidatePorts.push(REQUESTED_PORT);
  }

  while (candidatePorts.length < 20) {
    const port = 20000 + Math.floor(Math.random() * 40000);
    if (!attemptedPorts.has(port)) {
      attemptedPorts.add(port);
      candidatePorts.push(port);
    }
  }

  for (const port of candidatePorts) {
    try {
      const server = serve({
        port,
        fetch: handler,
      });

      console.log(`Unity WebRunner running at http://localhost:${server.port ?? port}`);
      return;
    } catch (error) {
      if (
        error instanceof Error &&
        (error as { code?: string }).code === "EADDRINUSE"
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("No available port found for Unity WebRunner");
}

start();
