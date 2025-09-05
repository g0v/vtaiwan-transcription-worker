/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { readAudioToText } from './utils/readAudioToText';
import { generateOutline } from './utils/ai_summarize';

interface Env {
	AI: Ai;
	DB: D1Database;
	R2: R2Bucket;
}

interface UpdateOutlineRequest {
	meeting_id: string;
	outline: string;
}

// 允許的來源白名單
const ALLOWED_ORIGINS = [
	'https://vtaiwan.pages.dev',
	'http://localhost:3000',
	'http://localhost:3001',
	'http://localhost:4173',
	  'http://localhost:4174',
	'http://localhost:8080',
	'http://localhost:8081',
	'https://vtaiwan.tw',
	'https://www.vtaiwan.tw',
	'https://talk.vtaiwan.tw',
	// 可以根據需要添加更多允許的來源
  ];


// 檢查來源是否被允許
function isOriginAllowed(origin: string) {
	return ALLOWED_ORIGINS.includes(origin);
  }

  // 動態生成 CORS headers
  function getCorsHeaders(origin: string) {
	const isAllowed = isOriginAllowed(origin);

	return {
	  'Access-Control-Allow-Origin': isAllowed ? origin : 'null',
	  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
	  'Access-Control-Max-Age': '86400', // 24 hours
	  'Vary': 'Origin', // 重要：告訴快取這個回應會根據 Origin 而變化
	};
  }

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const origin = request.headers.get('Origin') || '';

		// 處理 CORS preflight 請求
		if (request.method === 'OPTIONS') {
			const corsHeaders = getCorsHeaders(origin);

			// 如果來源不被允許，返回錯誤
			if (!isOriginAllowed(origin)) {
				return new Response('Origin not allowed', {
				status: 403,
				headers: corsHeaders,
				});
			}

			return new Response(null, {
				status: 200,
				headers: corsHeaders,
			});
		}

		const pathname = new URL(request.url).pathname;
		const corsHeaders = getCorsHeaders(origin);

		if (pathname.startsWith('/api/transcription/')) {

			// 取得POST上傳的attachment
			const formData = await request.formData();
			const file = formData.get('file');
			if (!file || typeof file === 'string') {
				return new Response('No file uploaded', { status: 400, headers: corsHeaders });
			}

			try {
				const buffer = await (file as File).arrayBuffer();
				const text = await readAudioToText(buffer, env, 'zh');
				return new Response(text, {
					headers: corsHeaders,
				});
			} catch (error: any) {
				console.error('轉錄失敗:', error.message);

				// 檢查是否為 AI 幻覺回應錯誤
				if (error.message.includes('AI 產生幻覺回應')) {
					return new Response(JSON.stringify({
						error: '音檔音量過低',
						message: error.message,
						code: 'LOW_VOLUME'
					}), {
						status: 422, // 422 = Unprocessable Entity，表示內容有問題但請求格式正確
						headers: {
							...corsHeaders,
							'Content-Type': 'application/json'
						}
					});
				}

				// 其他轉錄失敗錯誤
				return new Response(JSON.stringify({
					error: '轉錄失敗',
					message: error.message,
					code: 'TRANSCRIPTION_ERROR'
				}), {
					status: 400,
					headers: {
						...corsHeaders,
						'Content-Type': 'application/json'
					}
				});
			}
		}

		// 單獨測試AI的整理功能
		if (pathname === '/api/test-ai') {
			// 從POST的attachment file中讀取transcription
			const formData = await request.formData();
			const file = formData.get('file');

			if (!file || typeof file === 'string') {
				return new Response('No file uploaded', { status: 400, headers: corsHeaders });
			}

			// 確保正確處理中文編碼
			const arrayBuffer = await (file as File).arrayBuffer();
			const decoder = new TextDecoder('utf-8');
			const transcription = decoder.decode(arrayBuffer);
			// console.log(transcription);
			const outline = await generateOutline(transcription, env);
			console.log(outline);
			return new Response(outline, {
				status: 200,
				headers: corsHeaders,
			});
		}

		// 查詢整個Table
		if (pathname === '/api/query-table') {
			const transcriptions = await env.DB.prepare('SELECT * FROM transcriptions').all();
			return new Response(JSON.stringify(transcriptions.results), {
				status: 200,
				headers: corsHeaders,
			});
		}

		// 單獨創建Table
		if (pathname === '/api/create-table') {
			await env.DB.prepare('CREATE TABLE IF NOT EXISTS transcriptions (meeting_id TEXT, transcription TEXT, outline TEXT)').run();
			return new Response(JSON.stringify({ message: 'Table created successfully' }), {
				status: 200,
				headers: corsHeaders,
			});
		}

		// 上傳整篇逐字稿
		if (pathname === '/api/upload-transcription') {
			// 從POST的attachment file中讀取
			const formData = await request.formData();
			const file = formData.get('file');

			if (!file || typeof file === 'string') {
				return new Response('No file uploaded', { status: 400, headers: corsHeaders });
			}

			// 檔案名稱例，transcript-2025-06-21.txt，內容是逐字稿
			const meeting_id = (file as File).name
				.replace('.txt', '')
				.replace('transcript-', '')
				.split('-')
				.join('');

			console.log('Meeting ID:', meeting_id);

			// 1. 讀取檔案內容
			const arrayBuffer = await (file as File).arrayBuffer();
			const decoder = new TextDecoder('utf-8');
			const transcription = decoder.decode(arrayBuffer);
			console.log('File content read');

			// 2. 上傳到R2，內容原封不動
			const r2 = env.R2;
			const key = `${meeting_id}.txt`;
			await r2.put(key, (file as File).stream(), {
				httpMetadata: {
					contentType: 'text/plain; charset=utf-8'
				}
			});
			console.log('File uploaded to R2:', key);

			// 3. AI處理
			const outline = await generateOutline(transcription, env);

			// 4. 檢查D1資料庫中是否存在
			const meeting = await env.DB.prepare('SELECT * FROM transcriptions WHERE meeting_id = ?').bind(meeting_id).first();

			if (!meeting) {
				// 創建一個新的逐字稿記錄
				console.log('Creating new transcription record');
				await env.DB.prepare('INSERT INTO transcriptions (meeting_id, transcription, outline) VALUES (?, ?, ?)').bind(meeting_id, transcription, outline).run();

				return new Response(JSON.stringify({
					message: 'Transcription created successfully',
					meeting_id: meeting_id,
					r2_key: key
				}), {
					status: 200,
					headers: corsHeaders,
				});
			} else {
				// 更新現有的逐字稿記錄
				console.log('Updating transcription record');
				await env.DB.prepare('UPDATE transcriptions SET transcription = ?, outline = ? WHERE meeting_id = ?').bind(transcription, outline, meeting_id).run();

				return new Response(JSON.stringify({
					message: 'Transcription updated successfully',
					meeting_id: meeting_id,
					r2_key: key
				}), {
					status: 200,
					headers: corsHeaders,
				});
			}
		}

		// 更新逐字稿的outline，從POST的JSON中獲取meeting_id和outline
		if (pathname === '/api/update-outline') {
			const { meeting_id, outline } = await request.json() as UpdateOutlineRequest;
			await env.DB.prepare('UPDATE transcriptions SET outline = ? WHERE meeting_id = ?').bind(outline, meeting_id).run();
			return new Response(JSON.stringify({ message: 'Outline updated successfully' }), {
				status: 200,
				headers: corsHeaders,
			});
		}

		return new Response(
			'Hello World!',
			{
				headers: corsHeaders,
			}
		);
	},
} satisfies ExportedHandler<Env>;
