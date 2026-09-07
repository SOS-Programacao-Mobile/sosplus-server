import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`A variável de ambiente ${name} não foi configurada.`);
  }

  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  db: {
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 3306),
    database: required('MYSQL_DATABASE'),
    user: required('MYSQL_USER'),
    password: required('MYSQL_PASSWORD')
  }
};
