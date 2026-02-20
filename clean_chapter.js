import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const VPS_URL = 'https://jiutianxiaoshuo.com';
const SECRET_KEY = process.env.SECRET_KEY;

if (!SECRET_KEY) {
    console.error('错误：请在 .env 文件中配置 SECRET_KEY');
    process.exit(1);
}

// 'preview' 只预览
// 'interactive' 先预览，再手动确认（默认）
// 'execute' 自动执行（仍需后端 confirmToken）
const RUN_MODE = 'interactive';

const CLEAN_OPTIONS = {
    similarityThreshold: 0.92,
    contentCompareChars: 600,
    previewLimit: 50
};

async function callCleanupApi(payload) {
    const response = await fetch(`${VPS_URL}/api/admin/clean-dirty-chapters`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-admin-secret': SECRET_KEY
        },
        body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(`请求报错: ${response.status} ${response.statusText} - ${data.error || '未知错误'}`);
    }

    return data;
}

function printPreview(data) {
    console.log('\n================ 清理预览 ================');
    console.log(`状态: ${data.message}`);

    if (Array.isArray(data.summary) && data.summary.length > 0) {
        console.log('\n按书籍统计:');
        data.summary.forEach(item => {
            console.log(`- 《${item.title}》: ${item.count} 章`);
        });
    }

    if (Array.isArray(data.preview) && data.preview.length > 0) {
        console.log(`\n可删除明细（展示前 ${data.preview.length} 条）:`);
        data.preview.forEach((item, index) => {
            console.log(
                `${index + 1}. [${item.bookTitle}] 删: "${item.deleteTitle}" -> 留: "${item.keepTitle}" | 相似度: ${item.similarity}`
            );
        });
    } else {
        console.log('\n没有命中可安全删除的重复章节。');
    }

    if (Array.isArray(data.skipped) && data.skipped.length > 0) {
        console.log(`\n已跳过（需人工复核，展示前 ${data.skipped.length} 条）:`);
        data.skipped.forEach((item, index) => {
            console.log(`${index + 1}. [${item.bookTitle}] "${item.title}" | 原因: ${item.reason}`);
        });
    }

    console.log('==========================================\n');
}

async function askConfirm() {
    const rl = createInterface({ input, output });
    const answer = await rl.question('确认删除请输入 DELETE（其他输入视为取消）: ');
    rl.close();
    return answer.trim() === 'DELETE';
}

async function triggerCleanup() {
    console.log(`目标地址: ${VPS_URL}`);
    console.log(`运行模式: ${RUN_MODE}`);
    console.log(`相似度阈值: ${CLEAN_OPTIONS.similarityThreshold}`);
    console.log(`正文对比长度: ${CLEAN_OPTIONS.contentCompareChars}\n`);

    try {
        const previewData = await callCleanupApi({
            action: 'preview',
            ...CLEAN_OPTIONS
        });

        printPreview(previewData);

        if (RUN_MODE === 'preview') return;

        if (!previewData.deletableCount) {
            console.log('没有可删除数据，本次结束。');
            return;
        }

        if (!previewData.confirmToken) {
            console.log('后端未返回 confirmToken，取消执行删除。');
            return;
        }

        let allowExecute = RUN_MODE === 'execute';
        if (RUN_MODE === 'interactive') {
            allowExecute = await askConfirm();
        }

        if (!allowExecute) {
            console.log('你已取消删除操作。');
            return;
        }

        const executeData = await callCleanupApi({
            action: 'execute',
            confirmToken: previewData.confirmToken,
            ...CLEAN_OPTIONS
        });

        console.log('\n=============== 执行结果 ===============');
        console.log(`状态: ${executeData.message}`);
        console.log(`请求删除: ${executeData.requestedDeleteCount || 0}`);
        console.log(`实际删除: ${executeData.deletedCount || 0}`);
        console.log('========================================\n');
    } catch (error) {
        console.error('\n脚本执行出错:', error.message);
    }
}

triggerCleanup();
