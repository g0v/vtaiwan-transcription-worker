import { tify } from 'chinese-conv'


interface Env {
	AI: Ai;  // Cloudflare AI 模型接口
  }

  export async function translateToZh(userText: string, source_lang: string, env: any): Promise<string> {
		console.log('userText:', userText);

		// 以AI翻譯
		const response = await env.AI.run(
			"@cf/meta/m2m100-1.2b",
			{
				text: userText,
				source_lang: source_lang,
				target_lang: "zh",
		});

		console.log('response:', response);
		console.log('response.translated_text:', response.translated_text);
		// const result = tify(response.translated_text);
		// console.log('result:', result);
		return response.translated_text;
		// return result;
	}

  export async function readAudioToText(audioBuffer: ArrayBuffer, env: Env, language: string): Promise<string> {
	try {
	  if (!env.AI) {
		throw new Error('AI 模型未配置');
	  }

	  console.log('開始處理音頻文件...');

	  // 將 ArrayBuffer 轉換為 Base64 字串
	  const uint8Array = new Uint8Array(audioBuffer);

	  // 使用分批處理避免參數溢出
	  let binaryString = '';
	  const chunkSize = 8192; // 適當的塊大小，避免溢出

	  for (let i = 0; i < uint8Array.length; i += chunkSize) {
		const chunk = uint8Array.slice(i, i + chunkSize);
		binaryString += String.fromCharCode.apply(null, chunk as any);
	  }

	  const base64Audio = btoa(binaryString);

	  // 準備輸入數據
	  const input = {
		audio: base64Audio,  // 使用 Base64 編碼的音頻數據
		language: language,  // 設定語言為中文
		task: 'transcribe'
	  };

	  console.log('正在發送請求到 Whisper AI 模型...');

	  // 使用 Cloudflare Whisper AI 模型
	  const response = await env.AI.run(
		"@cf/openai/whisper-large-v3-turbo",  // 使用新的模型名稱
		input
	  );

	  console.log('Whisper AI 模型回應:', JSON.stringify(response, null, 2));

	  // 檢查回應
	  if (!response) {
		throw new Error('AI 模型未返回任何結果');
	  }

	  // 處理不同可能的回應格式
	  let result = '';
	  if (typeof response === 'string') {
		result = response;
	  } else if (response.text) {
		result = response.text;
	  } else {
		console.error('未預期的回應格式:', response);
		throw new Error('AI 模型返回了未知格式的結果');
	  }

	  if (!result.trim()) {
		throw new Error('AI 模型返回了空的結果');
	  }

	  // 檢查是否為 AI 幻覺回應
	  const trimmedResult = result.trim();
	  const isHallucination = (
		(trimmedResult.startsWith('字幕志願者') || trimmedResult.startsWith('字幕志愿者')) &&
		trimmedResult.length < 30
	  );

	  if (isHallucination) {
		console.log('🚨 檢測到 AI 幻覺回應:', trimmedResult);
		throw new Error(`音檔音量過低，AI 產生幻覺回應: "${trimmedResult}"`);
	  }

	  // 將結果轉換為繁體中文
	  console.log('result是：');
	  console.log(result);

	  let result_translated;
	  let result_combined;

	  if (language !== 'zh') {
		result_translated = await translateToZh(result, language, env);
		result_combined = result + '\n\n(自動翻譯)\n' + tify(result_translated);
	  } else {
		result_combined = tify(result);
	  }

	  console.log('result_combined是：');
	  console.log(result_combined);

	  return result_combined;

	} catch (error: any) {
	  console.error('音頻轉文字失敗:', error);
	  console.error('錯誤詳情:', {
		name: error.name,
		message: error.message,
		stack: error.stack,
	  });
	  throw new Error(`音頻轉文字失敗: ${error.message}`);
	}
  }
