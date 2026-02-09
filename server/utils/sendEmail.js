import nodemailer from 'nodemailer';

// 配置发送器
const transporter = nodemailer.createTransport({
  service: 'Gmail', // 或者 'Gmail'
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const sendVerificationEmail = async (email, code) => {
  await transporter.sendMail({
    from: `"九天小说站" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: '【九天小说站】注册验证码',
    html: `<p>您的验证码是：<strong style="font-size: 24px;">${code}</strong></p><p>有效期5分钟。</p>`,
  });
};

export default sendVerificationEmail;