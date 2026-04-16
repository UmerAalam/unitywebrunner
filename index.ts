import { serve } from "bun";
import { join, dirname } from "path";
import { mkdirSync, existsSync } from "fs";

let ROOT_DIR = "";
let COMPRESSION: "none" | "gzip" | "brotli" = "none";

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

serve({
  port: 8000,
  async fetch(req) {
    const url = new URL(req.url);

    // 1. UPLOAD HANDLER (With Path Flattening)
    if (url.pathname === "/upload" && req.method === "POST") {
      const formData = await req.formData();
      const files = formData.getAll("files");
      const buildFolder = `build_${Date.now()}`;
      const uploadBase = join(process.cwd(), "uploads", buildFolder);

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
      console.log(`✅ Build Flattened & Ready: ${ROOT_DIR}`);
      return Response.json({ success: true });
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
    const finalFilePath = join(ROOT_DIR, cleanPath);
    const file = Bun.file(finalFilePath);

    if (await file.exists()) {
      const headers = new Headers();
      const ext = "." + cleanPath.split(".").pop()?.toLowerCase();

      headers.set(
        "Content-Type",
        MIME_TYPES[ext] || "application/octet-stream",
      );

      // Handle Unity Compression
      if (COMPRESSION === "gzip") headers.set("Content-Encoding", "gzip");
      if (COMPRESSION === "brotli") headers.set("Content-Encoding", "br");

      // SharedArrayBuffer / Isolation headers (Required for Unity WebGL)
      headers.set("Cross-Origin-Embedder-Policy", "require-corp");
      headers.set("Cross-Origin-Opener-Policy", "same-origin");

      return new Response(file, { headers });
    }

    return new Response(`404: File not found at ${cleanPath}`, { status: 404 });
  },
});

console.log("🚀 Liquid Studio running at http://localhost:8000");
