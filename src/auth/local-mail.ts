import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

export async function sendRecoveryCode(email: string, code: string) {
  const transport = nodemailer.createTransport({
    host: env.smtp.host, port: env.smtp.port, secure: false, ignoreTLS: true,
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 5000,
    logger: false, debug: false,
  });
  try {
    await transport.sendMail({
      from: env.smtp.from, to: email, subject: 'Recuperação de senha SOSPlus',
      text: `Seu código de recuperação é:\n${code}\n\nEle expira em 15 minutos. Se você não solicitou a troca, ignore esta mensagem.`,
    });
  } finally { transport.close(); }
}
