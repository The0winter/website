// server/utils/indexNow.js

import fetch from 'node-fetch'; // 如果 Node 版本较低可能需要这个，Node 18+ 原生支持 fetch 可不写

const HOST = 'jiutianxiaoshuo.com';
const KEY = '8493abc32948jiutianxiaoshuo'; // 你的 Key
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;

export async function submitToIndexNow(urls) {
  if (!urls || urls.length === 0) return;

  const endpoint = 'https://api.indexnow.org/indexnow';
  
  const body = {
    host: HOST,
    key: KEY,
    keyLocation: KEY_LOCATION,
    urlList: urls
  };

  try {
    // 这里的 fetch 是 Node 原生支持的（Node 18+）
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    });

    if (response.status === 200 || response.status === 202) {
      console.log(`✅ [IndexNow] 成功推送 ${urls.length} 条链接`);
    } else {
      console.error(`❌ [IndexNow] 推送失败: ${response.status}`);
    }
  } catch (error) {
    console.error('❌ [IndexNow] 网络错误:', error.message);
  }
}