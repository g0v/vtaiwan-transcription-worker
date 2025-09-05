## 測試命令

### 測試AI整理功能

```bash
curl -X POST \
  -F "file=@files/transcript-2025-08-13.txt" \
  -H "Origin: http://localhost:3000" \
  http://localhost:8787/api/test-ai
```

### 測試上傳一篇逐字稿

```bash
curl -X POST \
  -F "file=@files/transcript-2025-06-21.txt" \
  -H "Origin: http://localhost:3000" \
  http://localhost:8787/api/upload-transcription
```

### 創建資料庫表格

```bash
curl -X POST \
  -H "Origin: http://localhost:3000" \
  http://localhost:8787/api/create-table
```

### 查詢整個table

```bash
http://localhost:8787/api/query-table
```

### 更新逐字稿的outline

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{
    "meeting_id": "20250621",
    "outline": "這是一個樣稿，大綱內容為一項測試"
  }' \
  http://localhost:8787/api/update-outline
```

### 測試音檔轉錄（AI 幻覺回應檢測）

#### 測試靜音音檔（應該返回 422 狀態碼）
```bash
curl -X POST \
  -F "file=@files/silence_10s.mp3" \
  -H "Origin: http://localhost:3000" \
  http://localhost:8787/api/transcription/
```
**預期回應**：`422 Unprocessable Entity` - AI 幻覺回應，音檔音量過低

#### 測試正常音檔（應該成功轉錄）
```bash
curl -X POST \
  -F "file=@files/test.mp3" \
  -H "Origin: http://localhost:3000" \
  http://localhost:8787/api/transcription/
```
**預期回應**：`200 OK` - 成功轉錄

#### 測試 WebM 格式音檔
```bash
curl -X POST \
  -F "file=@files/test.webm" \
  -H "Origin: http://localhost:3000" \
  http://localhost:8787/api/transcription/
```
**預期回應**：根據音檔內容決定

#### 狀態碼說明
- **200 OK**：轉錄成功
- **422 Unprocessable Entity**：AI 幻覺回應（音檔音量過低）
- **400 Bad Request**：轉錄技術失敗
