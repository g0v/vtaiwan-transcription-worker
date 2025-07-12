# vTaiwan 音頻轉錄 Worker

這是一個基於 Cloudflare Workers 的音頻轉錄服務，使用 Whisper AI 模型將音頻檔案轉換為繁體中文文字。

## 功能特點

- 🎵 支援多種音頻格式 (MP3, WAV等)
- 🤖 使用 Cloudflare Whisper AI 模型進行轉錄
- 🇹🇼 自動轉換為繁體中文輸出
- ⚡ 高效能的 Cloudflare Workers 平台
- 🌐 RESTful API 介面

## 安裝與設定

### 1. 安裝依賴

```bash
npm install
```

### 2. 生成類型定義

```bash
npm run cf-typegen
```

## 本地開發

### 啟動開發伺服器

```bash
npm run dev --remote
```

開發伺服器將在 `http://localhost:8787` 啟動。

### 測試基本連接

```bash
curl http://localhost:8787
```

應該返回 "Hello World!"

## API 使用

### 音頻轉錄端點

**POST** `/api/transcription/`

- **Content-Type**: `multipart/form-data`
- **請求體**: 使用 form field `file` 上傳音頻檔案
- **回應**: 轉錄後的繁體中文文字

### 測試範例

#### 準備測試檔案

首先創建測試檔案目錄並放入測試音頻：

# 將你的測試音頻檔案放入 files/test.mp3


#### 使用 curl 測試

```bash
# 測試音頻轉錄
curl -X POST \
  -F "file=@./files/test.mp3" \
  http://localhost:8787/api/transcription/
```


```bash
# 測試.wav音頻轉錄
curl -X POST \
  -F "file=@./files/test.wav" \
  http://localhost:8787/api/transcription/
```

#### 其他音頻格式範例

```bash
# WAV 檔案
curl -X POST \
  -F "file=@./files/test.wav" \
  http://localhost:8787/api/transcription/

# M4A 檔案
curl -X POST \
  -F "file=@./files/test.m4a" \
  http://localhost:8787/api/transcription/
```

## 部署

### 部署到 Cloudflare Workers

```bash
npm run deploy
```

### 生產環境測試

部署後，將上述 curl 命令中的 URL 替換為你的 Worker 域名：

```bash
curl -X POST \
  -F "file=@./files/test.mp3" \
  https://your-worker-name.your-subdomain.workers.dev/api/transcription/
```

## 可用指令

- `npm run dev` - 啟動本地開發伺服器
- `npm run deploy` - 部署到 Cloudflare Workers
- `npm run cf-typegen` - 生成類型定義檔案
- `npm test` - 執行測試

## 疑難排解

### 常見問題

1. **AI 模型未配置錯誤**
   - 確保 `wrangler.jsonc` 中有正確的 AI 綁定配置
   - 執行 `npm run cf-typegen` 重新生成類型

2. **音頻檔案過大**
   - Cloudflare Workers 有請求大小限制
   - 建議音頻檔案小於 100MB

3. **轉錄結果為空**
   - 檢查音頻檔案是否包含可識別的語音
   - 確認音頻格式是否受支援

### 除錯模式

在本地開發時，可以查看 console 輸出來了解轉錄過程：

```bash
npm run dev -- --local
```

## 技術架構

- **Runtime**: Cloudflare Workers
- **AI 模型**: `@cf/openai/whisper-large-v3-turbo`
- **語言處理**: `chinese-conv` (簡轉繁)
- **TypeScript**: 完整類型支援

## 授權

請參考項目授權條款。
