const express = require("express");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

const tunnels = [];

const createTunnel = (targetUrl) => {
  const id = `tnl_${Math.random().toString(36).slice(2, 10)}`;
  const subdomain = `free-${id}`;
  const hostname = `${subdomain}.trycloudflare.com`;

  return {
    id,
    targetUrl,
    hostname,
    status: "active",
    createdAt: new Date().toISOString()
  };
};

app.get("/api/tunnels", (req, res) => {
  res.json({ tunnels });
});

app.post("/api/tunnels", (req, res) => {
  const { targetUrl } = req.body;

  if (!targetUrl || typeof targetUrl !== "string") {
    return res.status(400).json({ error: "A valid target URL is required." });
  }

  const tunnel = createTunnel(targetUrl.trim());
  tunnels.unshift(tunnel);
  res.status(201).json(tunnel);
});

app.listen(port, () => {
  console.log(`Tunnel manager running on http://localhost:${port}`);
});
