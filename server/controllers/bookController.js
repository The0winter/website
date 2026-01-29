// backend/controllers/bookController.js
import { scrapeAndSaveBook } from '../utils/scraperService.js';

// 这是一个 API 接口的处理函数: POST /api/books/scrape
export const importBookFromUrl = async (req, res) => {
    const { url, bookId } = req.body;

    if (!url) {
        return res.status(400).json({ message: '请提供书籍目录页 URL' });
    }

    try {
        // 告诉前端：我们要开始爬了，请稍等
        // ⚠️ 注意：如果书很长，爬取时间超过 2 分钟，前端请求会超时。
        // 更好的做法是：这里不 await，直接返回 "任务已开始"，让爬虫在后台跑。
        
        console.log('收到爬取请求，开始处理...');
        
        // 方案 A：简单粗暴等待 (适合章节少的情况)
        const result = await scrapeAndSaveBook(url, bookId);
        res.status(200).json(result);

        // 方案 B：后台运行 (适合全本爬取)
        // scrapeAndSaveBook(url, bookId).then(() => console.log('后台爬取完成'));
        // res.status(200).json({ message: '爬取任务已在后台启动，请稍后查看数据库' });

    } catch (error) {
        res.status(500).json({ message: '爬取失败', error: error.message });
    }
};