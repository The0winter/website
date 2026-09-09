export const capturedMail = [];
import nodemailer from 'nodemailer';

const sendVerificationEmail = async (email, code) => {
  const local = process.env.MAIL_MODE === 'smtp-local';
  if (local && (!['test','development'].includes(process.env.APP_ENV) || !['127.0.0.1','localhost'].includes(process.env.SMTP_HOST))) throw new Error('Local SMTP requires explicit isolation');
  if (!local && process.env.EXTERNAL_SERVICES !== 'enabled') {
    capturedMail.push({ email, code });
    if (capturedMail.length > 100) capturedMail.shift();
    return;
  }
  if (!local && process.env.APP_ENV !== 'production') throw new Error('External mail forbidden outside production');
  const transporter = nodemailer.createTransport({
    ...(local ? {host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT),secure:false,ignoreTLS:true} : {service:'Gmail',auth:{user:process.env.EMAIL_USER,pass:process.env.EMAIL_PASS}}),
    connectionTimeout:3000,greetingTimeout:3000,socketTimeout:5000,
  });
  await transporter.sendMail({
    from: `"九天小说站" <${local ? 'noreply@example.test' : process.env.EMAIL_USER}>`,
    to: email,
    subject: '【九天小说站】注册验证码',
    html: `<p>您的验证码是：<strong style="font-size: 24px;">${code}</strong></p><p>有效期5分钟。</p>`,
  });
};

export default sendVerificationEmail;
