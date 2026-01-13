# Cloudflare Tunnel Manager

A lightweight Node.js + HTML/CSS interface for managing free and named Cloudflare tunnel campaigns with basic account tracking and authentication.

## Requirements

- Node.js 18+ (or current LTS)
- npm (ships with Node.js)
- A Cloudflare account (required for named tunnels)
- One or more Cloudflare-managed domains (required for named tunnels)

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Update credentials in `config.json` (used by the login screen).
3. Start the server:
   ```bash
   npm start
   ```
4. Open the app at `http://localhost:3000`.

## Features

- 🔐 **Secure** login-protected UI backed by an Express API.
- 🚀 **Blazing-fast** free tunnel campaigns with configurable tunnel counts and optional proxy rotation.
- 🌐 **Powerful** named tunnels tied to Cloudflare accounts/domains with optional failover proxy routing.
- 🧭 **Streamlined** Cloudflare account entries, domain lists, and connection status management.
- ⚡ **Ultra-lightweight** in-memory storage for tunnels and accounts for rapid development iteration.

## Notes

- Tunnels and accounts are stored in memory and reset when the server restarts.
- Update `config.json` with the desired username/password before deploying.
