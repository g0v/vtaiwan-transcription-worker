// 簡單的文本截斷函數（假設中文字符約2個token）
function truncateText(text: string, maxChars: number = 1500): string {
	if (text.length <= maxChars) {
		return text;
	}
	return text.substring(0, maxChars);
}

export async function generateOutline(transcription: string, env: any): Promise<string> {
	// 截斷文本避免token超量（1500字符約3000 tokens）
	const truncatedText = truncateText(transcription);

	// 使用 Workers AI 生成回答
	const response = await env.AI.run("@hf/thebloke/neural-chat-7b-v3-1-awq", {
		messages: [
			{
				role: "system",
				content: "請用正體中文把以下內容整理出來，重點整理。"
			},
			{
				role: "user",
				content: truncatedText
			}
		]
	});
	console.log(response.response);
	return response.response;
}
