import Review from '../models/Review.js';
import Book from '../models/Book.js';

// 1. 提交/发表评论

export const createReview = async (req, res) => {
  try {
    const { rating, content } = req.body;
    const bookId = req.params.id;
    const userId = req.user.id; 

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: '评分必须在 1-5 星之间' });
    }

    // 🔥 修改点：使用 findOneAndUpdate 实现“有则更新，无则新增” (Upsert)
    const review = await Review.findOneAndUpdate(
      { book: bookId, user: userId }, // 查询条件：这本书 + 这个人
      { 
        rating: Number(rating), 
        content: content 
      },
      { new: true, upsert: true, setDefaultsOnInsert: true } // 关键参数
    );

    // --- 下面的计算平均分逻辑保持不变 ---
    const stats = await Review.aggregate([
      { $match: { book: review.book } },
      { 
        $group: { 
          _id: '$book', 
          avgRating: { $avg: '$rating' },
          numReviews: { $sum: 1 }
        } 
      }
    ]);

    if (stats.length > 0) {
      await Book.findByIdAndUpdate(bookId, {
        rating: stats[0].avgRating.toFixed(1),
        numReviews: stats[0].numReviews
      });
    }

    // 返回带用户信息的评论，方便前端更新列表
    const populatedReview = await Review.findById(review._id).populate('user', 'username avatar');
    res.status(201).json(populatedReview);

  } catch (error) {
    console.error('评论失败:', error);
    res.status(500).json({ message: '服务器错误' });
  }
};

// 2. 获取某本书的评论列表
export const getReviews = async (req, res) => {
  try {
    const bookId = req.params.id;
    const reviews = await Review.find({ book: bookId })
      .sort({ createdAt: -1 }) // 最新评论在最前
      .populate('user', 'username avatar'); // 把评论人的名字头像取出来
    
    res.json(reviews);
  } catch (error) {
    console.error('获取评论失败:', error);
    res.status(500).json({ message: '获取评论失败' });
  }
};