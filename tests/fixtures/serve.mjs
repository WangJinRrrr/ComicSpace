import http from "node:http";

const port = Number(process.env.FIXTURE_PORT || 8787);

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function svg({ title, subtitle, hue, width = 800, height = 1200 }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 45% 22%)"/>
      <stop offset="1" stop-color="hsl(${(hue + 80) % 360} 55% 12%)"/>
    </linearGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M 48 0 L 0 0 0 48" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect width="100%" height="100%" fill="url(#grid)"/>
  <text x="48" y="${height * 0.42}" fill="rgba(255,255,255,.94)" font-family="sans-serif" font-size="54" font-weight="700">${escapeXml(title)}</text>
  <text x="48" y="${height * 0.42 + 58}" fill="rgba(255,255,255,.6)" font-family="sans-serif" font-size="24">${escapeXml(subtitle)}</text>
  <rect x="48" y="${height - 96}" width="${width - 96}" height="2" fill="rgba(255,255,255,.2)"/>
  <text x="48" y="${height - 54}" fill="rgba(255,255,255,.45)" font-family="sans-serif" font-size="18">ComicSpace local fixture</text>
</svg>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts[0] === "covers" && parts[1]) {
    const id = parts[1].replace(/\.svg$/, "");
    res.writeHead(200, {
      "content-type": "image/svg+xml",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    res.end(
      svg({
        title: id,
        subtitle: "cover",
        hue: (id.length * 47) % 360,
        width: 600,
        height: 900,
      }),
    );
    return;
  }

  if (parts[0] === "pages" && parts[1] && parts[2] && parts[3]) {
    const mangaId = parts[1];
    const chapterId = parts[2];
    const page = Number(parts[3].replace(/\.svg$/, "")) || 1;
    const tall = mangaId === "long-scroll";
    res.writeHead(200, {
      "content-type": "image/svg+xml",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    res.end(
      svg({
        title: `${mangaId} · ${chapterId}`,
        subtitle: `page ${page}`,
        hue: (page * 31 + mangaId.length * 19) % 360,
        width: tall ? 700 : 800,
        height: tall ? 1800 : 1200,
      }),
    );
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("fixture not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Fixture image server: http://127.0.0.1:${port}`);
});
