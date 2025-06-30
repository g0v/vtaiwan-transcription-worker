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

interface Env {
	AI: Ai;
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
		if (pathname.startsWith('/api/transcription/')) {

			// 取得POST上傳的attachment
			const formData = await request.formData();
			const file = formData.get('file');
			if (!file || typeof file === 'string') {
				return new Response('No file uploaded', { status: 400, headers: getCorsHeaders(request.headers.get('origin') || '') });
			}
			const buffer = await (file as File).arrayBuffer();
			const text = await readAudioToText(buffer, env, 'zh');
			return new Response(text, {
				headers: getCorsHeaders(request.headers.get('origin') || ''),
			});
		}

		return new Response(
			'Hello World!',
			{
				headers: getCorsHeaders(request.headers.get('origin') || ''),
			}
		);
	},
} satisfies ExportedHandler<Env>;
