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

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {

		const pathname = new URL(request.url).pathname;
		if (pathname.startsWith('/api/transcription/')) {

			// 取得POST上傳的attachment
			const formData = await request.formData();
			const file = formData.get('file');
			if (!file || typeof file === 'string') {
				return new Response('No file uploaded', { status: 400 });
			}
			const buffer = await (file as File).arrayBuffer();
			const text = await readAudioToText(buffer, env, 'zh');
			return new Response(text);
		}

		return new Response('Hello World!');
	},
} satisfies ExportedHandler<Env>;
