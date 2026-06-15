# Samply ID3 Export

Chrome extension. Export Samply projects as MP3s with ID3 tags. Downloads original 320kbps files. Includes M3U playlist.

## Features

- ID3 tags: title, artist, album, year, track number, cover art
- Original quality (320kbps, not Samply's re-encoded version)
- M3U playlist in zip
- Works on any Samply project you own

## Install

1. Download zip from [Releases](../../releases)
2. Unzip
3. Go to `chrome://extensions`
4. Enable **Developer mode** (top right)
5. Click **Load unpacked** → select unzipped folder
6. Open a Samply project → click green export button

## Usage

1. Open project on samply.app
2. Click **⬇ Export with ID3** button (bottom right)
3. Fill artist, album, year, upload cover art
4. Click **Download with ID3 tags**
5. Save zip

## Privacy

Extension fetches audio from your own Samply account only. No data collected. No third parties. Auth token used solely to download your files from Samply servers.

## Built with

- Firebase Storage API for original file access
- ID3v2 tag injection
- JSZip
- Chrome MV3 service worker (CORS bypass)
