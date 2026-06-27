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
	/** 逗號分隔，允許代理連線的目標 hostname（完整或後綴，例如 data.gov.tw、.gov.tw） */
	CORS_PROXY_ALLOWED_HOSTS?: string;
	MASTODON_TOKEN?: string;
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
	'https://vtaiwan.tw',
	'https://vue.vtaiwan.tw',
	'https://talk.vtaiwan.tw',
	'https://feat-newsletters-page.vtaiwan.pages.dev'
	// 可以根據需要添加更多允許的來源
  ];

/** 僅允許使用 /api/cors-proxy 的瀏覽器來源（生產環境為 www.vtaiwan.tw；本地開發見 localhost） */
const CORS_PROXY_CLIENT_ORIGINS = [
	'https://www.vtaiwan.tw',
	'https://vtaiwan.tw',
	'http://localhost:3000',
	'http://localhost:3001',
	'http://localhost:4173',
	'http://localhost:4174',
	'http://localhost:8080',
	'http://localhost:8081',
	'https://feat-newsletters-page.vtaiwan.pages.dev'
];

function isCorsProxyClientAllowed(origin: string): boolean {
	return CORS_PROXY_CLIENT_ORIGINS.includes(origin);
}

function getCorsHeadersForPath(pathname: string, origin: string) {
	if (pathname.startsWith('/api/cors-proxy')) {
		const allowed = isCorsProxyClientAllowed(origin);
		return {
			'Access-Control-Allow-Origin': allowed ? origin : 'null',
			'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
			'Access-Control-Max-Age': '86400',
			Vary: 'Origin',
		};
	}
	return getCorsHeaders(origin);
}

/** 未設定 Env 時的預設：可依需求修改或改為僅由 wrangler vars 注入 */
const DEFAULT_PROXY_TARGET_HOST_PATTERNS = ['medium.com', 'vtaiwantw.substack.com'];

function parseProxyAllowedHosts(env: Env): string[] {
	const raw = env.CORS_PROXY_ALLOWED_HOSTS;
	if (typeof raw === 'string' && raw.trim()) {
		return raw
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
	}
	return DEFAULT_PROXY_TARGET_HOST_PATTERNS;
}

function isBlockedProxyHostname(hostname: string): boolean {
	const h = hostname.toLowerCase();
	if (h === 'localhost' || h === 'metadata.google.internal') return true;
	if (h.endsWith('.localhost')) return true;
	// IPv4 簡易私有／鏈路本機檢查
	const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
	if (ipv4) {
		const a = Number(ipv4[1]);
		const b = Number(ipv4[2]);
		if (a === 10) return true;
		if (a === 127) return true;
		if (a === 0) return true;
		if (a === 169 && b === 254) return true;
		if (a === 192 && b === 168) return true;
		if (a === 172 && b >= 16 && b <= 31) return true;
	}
	return false;
}

function isProxyTargetHostAllowed(hostname: string, patterns: string[]): boolean {
	if (isBlockedProxyHostname(hostname)) return false;
	return patterns.some((pattern) => {
		const p = pattern.toLowerCase().replace(/^\./, '');
		if (!p) return false;
		if (pattern.startsWith('.')) {
			return hostname === p || hostname.endsWith(`.${p}`);
		}
		return hostname === p;
	});
}

/** 上游若帶 CORS，避免與 proxy 回應衝突 */
const UPSTREAM_STRIP_CORS_HEADERS = new Set([
	'access-control-allow-origin',
	'access-control-allow-methods',
	'access-control-allow-headers',
	'access-control-expose-headers',
	'access-control-max-age',
	'access-control-allow-credentials',
]);

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
		const pathname = new URL(request.url).pathname;

		// 處理 CORS preflight 請求
		if (request.method === 'OPTIONS') {
			const corsHeaders = getCorsHeadersForPath(pathname, origin);

			if (pathname.startsWith('/api/cors-proxy')) {
				if (!isCorsProxyClientAllowed(origin)) {
					return new Response('Origin not allowed', {
						status: 403,
						headers: corsHeaders,
					});
				}
			} else if (!isOriginAllowed(origin)) {
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

		const corsHeaders = getCorsHeadersForPath(pathname, origin);

		// 給 www.vtaiwan.tw（與本地開發）專用的連外 CORS proxy：GET/POST 等會轉發至 ?url= 指定之目標
		if (pathname === '/api/cors-proxy' || pathname.startsWith('/api/cors-proxy/')) {
			if (!origin || !isCorsProxyClientAllowed(origin)) {
				return new Response(
					JSON.stringify({ error: 'Origin not allowed for CORS proxy' }),
					{
						status: 403,
						headers: {
							...corsHeaders,
							'Content-Type': 'application/json',
						},
					}
				);
			}

			const targetUrlParam = new URL(request.url).searchParams.get('url');
			if (!targetUrlParam) {
				return new Response(
					JSON.stringify({
						error: 'Missing url',
						hint: 'Use /api/cors-proxy?url=' + encodeURIComponent('https://example.com/path'),
					}),
					{
						status: 400,
						headers: {
							...corsHeaders,
							'Content-Type': 'application/json',
						},
					}
				);
			}

			let targetUrl: URL;
			try {
				targetUrl = new URL(targetUrlParam);
			} catch {
				return new Response(JSON.stringify({ error: 'Invalid url parameter' }), {
					status: 400,
					headers: {
						...corsHeaders,
						'Content-Type': 'application/json',
					},
				});
			}

			if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
				return new Response(JSON.stringify({ error: 'Only http(s) URLs are allowed' }), {
					status: 400,
					headers: {
						...corsHeaders,
						'Content-Type': 'application/json',
					},
				});
			}

			const allowedHosts = parseProxyAllowedHosts(env);
			if (!isProxyTargetHostAllowed(targetUrl.hostname, allowedHosts)) {
				return new Response(
					JSON.stringify({
						error: 'Target host not allowed',
						hostname: targetUrl.hostname,
					}),
					{
						status: 403,
						headers: {
							...corsHeaders,
							'Content-Type': 'application/json',
						},
					}
				);
			}

			const forwardHeaderNames = ['accept', 'accept-language', 'authorization', 'content-type', 'user-agent'];
			const forwardHeaders = new Headers();
			for (const name of forwardHeaderNames) {
				const v = request.headers.get(name);
				if (v) forwardHeaders.set(name, v);
			}

			const method = request.method;
			const init: RequestInit = {
				method,
				headers: forwardHeaders,
				redirect: 'follow',
			};
			if (method !== 'GET' && method !== 'HEAD') {
				init.body = request.body;
			}

			try {
				const upstream = await fetch(targetUrl.toString(), init);
				const outHeaders = new Headers();
				upstream.headers.forEach((value, key) => {
					if (!UPSTREAM_STRIP_CORS_HEADERS.has(key.toLowerCase())) {
						outHeaders.set(key, value);
					}
				});
				for (const [k, v] of Object.entries(corsHeaders)) {
					outHeaders.set(k, v);
				}
				outHeaders.set('Access-Control-Allow-Origin', origin);

				return new Response(upstream.body, {
					status: upstream.status,
					statusText: upstream.statusText,
					headers: outHeaders,
				});
			} catch (e: unknown) {
				const message = e instanceof Error ? e.message : String(e);
				console.error('CORS proxy upstream error:', message);
				return new Response(
					JSON.stringify({ error: 'Upstream request failed', message }),
					{
						status: 502,
						headers: {
							...corsHeaders,
							'Content-Type': 'application/json',
						},
					}
				);
			}
		}

		if (pathname.startsWith('/api/transcription/')) {

			// '/api/transcription/zh-TW'
			// '/api/transcription/ja'
			const language = pathname.replace('/api/transcription/', '') || 'zh-TW';

			// INSERT_YOUR_CODE
			// 語言 mapping
			const languageMap: Record<string, string> = {
				'zh-TW': 'zh',
				'en': 'en',
				'ja': 'ja'
			};
			const mappedLanguage = languageMap[language] || language;

			// 取得POST上傳的attachment
			const formData = await request.formData();
			const file = formData.get('file');
			if (!file || typeof file === 'string') {
				return new Response('No file uploaded', { status: 400, headers: corsHeaders });
			}

			try {
				const buffer = await (file as File).arrayBuffer();
				const text = await readAudioToText(buffer, env, mappedLanguage);
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

		// Mastodon
		if (pathname === '/api/mastodon') {
			if (!env.MASTODON_TOKEN) {
				return new Response('Mastodon token not found', { status: 500, headers: {
					...corsHeaders,
					'Content-Type': 'application/json'
				} });
			}
			const response = await fetch('https://g0v.social/api/v1/timelines/tag/vtaiwan?limit=20&local=true', {
				headers: {
					'Authorization': `Bearer ${env.MASTODON_TOKEN}`,
					'Content-Type': 'application/json'
				}
			});
			const data = await response.json();
			return new Response(JSON.stringify(data), {
				status: response.status,
				headers: {
					...corsHeaders,
					'Content-Type': 'application/json'
				},
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
