import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('Hello World worker', () => {
	it('responds with Hello World! (unit style)', async () => {
		const request = new IncomingRequest('http://example.com');
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(await response.text()).toMatchInlineSnapshot(`"Hello World!"`);
	});

	it('responds with Hello World! (integration style)', async () => {
		const response = await SELF.fetch('https://example.com');
		expect(await response.text()).toMatchInlineSnapshot(`"Hello World!"`);
	});

	it('encodes user-supplied outlines before storing them', async () => {
		const ctx = createExecutionContext();
		await worker.fetch(new IncomingRequest('http://example.com/api/create-table'), env, ctx);
		await env.DB
			.prepare('INSERT INTO transcriptions (meeting_id, transcription, outline) VALUES (?, ?, ?)')
			.bind('20250621', 'existing transcription', 'existing outline')
			.run();

		const payload = {
			meeting_id: '20250621',
			outline: '<img src=x onerror=alert(1)>',
		};
		const updateResponse = await worker.fetch(
			new IncomingRequest('http://example.com/api/update-outline', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			}),
			env,
			ctx
		);
		await waitOnExecutionContext(ctx);
		expect(updateResponse.status).toBe(200);

		const queryResponse = await worker.fetch(
			new IncomingRequest('http://example.com/api/query-table'),
			env,
			createExecutionContext()
		);
		expect(queryResponse.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
		expect(queryResponse.headers.get('X-Content-Type-Options')).toBe('nosniff');
		const records = await queryResponse.json<Array<{ meeting_id: string; outline: string }>>();
		expect(records.find((record) => record.meeting_id === payload.meeting_id)?.outline)
			.toBe('&lt;img src=x onerror=alert(1)&gt;');
	});
});
