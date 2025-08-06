// 智能分段函數：優先按段落分割，如果段落太大則按句子分割
function splitTextIntoChunks(text: string, maxCharsPerChunk: number = 3000): string[] {
	const chunks: string[] = [];

	// 首先按段落分割（以換行為分隔符）
	const paragraphs = text.split(/\n/).filter(p => p.trim().length > 0);

	let currentChunk = '';

	for (const paragraph of paragraphs) {
		// 如果當前段落單獨就超過限制，需要進一步分割
		if (paragraph.length > maxCharsPerChunk) {
			// 先保存當前chunk（如果有內容）
			if (currentChunk.trim()) {
				chunks.push(currentChunk.trim());
				currentChunk = '';
			}

			// 將大段落按句子分割
			const sentences = paragraph.split(/[。！？]/).filter(s => s.trim().length > 0);

			for (const sentence of sentences) {
				const sentenceWithPunctuation = sentence + '。';

				// 如果加入這個句子會超過限制，先保存當前chunk
				if (currentChunk.length + sentenceWithPunctuation.length > maxCharsPerChunk) {
					if (currentChunk.trim()) {
						chunks.push(currentChunk.trim());
					}
					currentChunk = sentenceWithPunctuation;
				} else {
					currentChunk += sentenceWithPunctuation;
				}
			}
		} else {
			// 如果加入這個段落會超過限制，先保存當前chunk
			if (currentChunk.length + paragraph.length + 1 > maxCharsPerChunk) {
				if (currentChunk.trim()) {
					chunks.push(currentChunk.trim());
				}
				currentChunk = paragraph;
			} else {
				if (currentChunk) {
					currentChunk += '\n' + paragraph;
				} else {
					currentChunk = paragraph;
				}
			}
		}
	}

	// 不要忘記最後一個chunk
	if (currentChunk.trim()) {
		chunks.push(currentChunk.trim());
	}

	return chunks;
}

// 為單個chunk生成摘要（添加超時控制）
async function generateChunkSummary(chunk: string, env: any, chunkIndex: number, totalChunks: number): Promise<string> {

	console.log(`開始處理第${chunkIndex + 1}/${totalChunks}段，長度：${chunk.length} 字符`);

	const prompt = totalChunks > 1
		? `請為以下第${chunkIndex + 1}/${totalChunks}段內容生成重點摘要：`
		: `請用正體中文把以下內容整理出來，重點整理。：`;

	//console.log(`prompt：${prompt}`);
	//console.log(`chunk：${chunk}`);

	try {
		// 使用 gpt-oss-20b 模型
		const response = await env.AI.run("@cf/openai/gpt-oss-20b", {
			instructions: prompt,
			input: chunk
		});

		// 處理回應格式
		let result = '';

		console.log(JSON.stringify(response));

		let output = response.output;
		console.log(output[output.length - 1].content[0].text);

		result = output[output.length - 1].content[0].text;

		if (!result) {
			console.error('無法解析 AI 回應格式:', response);
			throw new Error('AI 模型返回了無法解析的結果格式');
		}

		return result;
	} catch (error) {
		console.error(`Chunk ${chunkIndex + 1} AI處理失敗:`, error);
		return `第${chunkIndex + 1}段：AI處理失敗，原始內容長度 ${chunk.length} 字符`;
	}
}

// 合併多個摘要為最終大綱（簡化版本）
async function mergeSummaries(summaries: string[], env: any): Promise<string> {
	if (summaries.length === 1) {
		return summaries[0];
	} else {
		return summaries
			.filter((summary: string) => summary.replace(/\s/g, '').length > 0)
			.map((summary, index) => `## 第${index + 1}部分\n${summary}`)
			.join('\n\n');
	}
}

export async function generateOutline(transcription: string, env: any): Promise<string> {
	console.log(`開始處理逐字稿，總長度：${transcription.length} 字符`);

	// 如果文本較短，直接處理
	if (transcription.length <= 3000) {
		console.log("文本較短，直接處理");
		const summary = await generateChunkSummary(transcription, env, 0, 1);
		console.log(`摘要：${summary}`);
		return summary;
	}

	// 將文本分割成適當大小的段落（增加chunk大小到3000）
	const chunks = splitTextIntoChunks(transcription, 3000);
	console.log(`分割成 ${chunks.length} 個段落進行處理`);

	if (chunks.length === 0) {
		return "無法處理空內容";
	}

	// 限制最大chunk數量避免超時
	if (chunks.length > 10) {
		console.log(`段落數量過多(${chunks.length})，將合併為較大段落`);
		const largerChunks = splitTextIntoChunks(transcription, 6000);
		if (largerChunks.length <= 8) {
			return await processChunks(largerChunks, env);
		} else {
			// 如果還是太多，只處理前8段
			console.log("內容過長，僅處理前8段");
			return await processChunks(largerChunks.slice(0, 8), env);
		}
	}

	return await processChunks(chunks, env);
}

// 並行處理chunks的輔助函數
async function processChunks(chunks: string[], env: any): Promise<string> {
	if (chunks.length === 1) {
		console.log("單段落處理");
		return await generateChunkSummary(chunks[0], env, 0, 1);
	}

	console.log(`開始並行處理 ${chunks.length} 個段落`);

	// 並行處理所有chunks（提高效率）
	const summaryPromises = chunks.map((chunk, index) =>
		generateChunkSummary(chunk, env, index, chunks.length)
	);

	try {
		const summaries = await Promise.all(summaryPromises);
		console.log(`所有段落處理完成，開始合併`);

		// 合併摘要
		const finalOutline = await mergeSummaries(summaries, env);
		console.log("大綱生成完成");
		return finalOutline;
	} catch (error) {
		console.error("並行處理失敗:", error);
		// 降級為逐一處理
		return await processChunksSequentially(chunks, env);
	}
}

// 降級的逐一處理函數
async function processChunksSequentially(chunks: string[], env: any): Promise<string> {
	console.log("降級為逐一處理");
	const summaries: string[] = [];

	for (let i = 0; i < Math.min(chunks.length, 5); i++) { // 最多處理5段避免超時
		console.log(`處理第 ${i + 1}/${chunks.length} 段落`);
		const summary = await generateChunkSummary(chunks[i], env, i, chunks.length);
		summaries.push(summary);
	}

	if (chunks.length > 5) {
		summaries.push(`註：由於時間限制，僅處理前5段內容（共${chunks.length}段）`);
	}

	return summaries
		.map((summary, index) => `## 第${index + 1}部分\n${summary}`)
		.join('\n\n');
}
