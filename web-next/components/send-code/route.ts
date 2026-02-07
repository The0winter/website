import { NextResponse } from 'next/server';
import { Resend } from 'resend';

// 初始化 Resend，记得去 .env.local 里加这个变量
const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  try {
    // 1. 从前端获取邮箱地址
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: '邮箱不能为空' }, { status: 400 });
    }

    // 2. 生成 6 位随机验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // ==========================================
    // ⚠️ 关键一步：这里需要把 code 存到数据库里
    // ==========================================
    // 因为你的数据库在 MongoDB Atlas，你在这里有两个选择：
    // A. 连接数据库并存入 (users 集合或 temp_codes 集合)
    // B. 调用你的 Express 后端接口去存
    // 为了演示简单，我们先只做“发送邮件”这一步。
    console.log(`[开发模式] 邮箱: ${email}, 验证码: ${code}`); 

    // 3. 发送邮件
    const data = await resend.emails.send({
      from: 'MERN Reader <onboarding@resend.dev>', // 这里先用 Resend 的测试发件人
      to: email, // Resend 免费版只能发给是你自己注册账号的那个邮箱(作为测试)，上线后需验证域名才能发给别人
      subject: '【九天阅读】您的注册验证码',
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
          <h2>欢迎注册九天阅读</h2>
          <p>您的验证码是：</p>
          <p style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #0070f3;">
            ${code}
          </p>
          <p>该验证码 5 分钟内有效。如果不是本人操作，请忽略此邮件。</p>
        </div>
      `,
    });

    if (data.error) {
      return NextResponse.json({ error: data.error }, { status: 500 });
    }

    // 4. 返回成功，不要把 code 返回给前端！
    return NextResponse.json({ message: '发送成功' });

  } catch (error) {
    console.error('邮件发送失败:', error);
    return NextResponse.json({ error: '服务内部错误' }, { status: 500 });
  }
}