import { createHash, randomBytes } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { database } from '../database/mysql.js';
import { dummyHash, hashPassword, verifyPassword } from './password.js';
import { AuthError, validateLogin, validateRegistration, type TipoUsuario } from './validation.js';

export type PublicUser = { id: string; nome: string; email: string; tipo: TipoUsuario; cnpj: string | null };
type UserRow = RowDataPacket & PublicUser & { senha_hash: string; ativo: number };
const userSelect = `SELECT CAST(u.id AS CHAR) AS id, u.email, u.tipo, u.ativo, u.senha_hash,
  CASE WHEN u.tipo = 'DOADOR' THEN d.nome ELSE o.nome END AS nome, o.cnpj
  FROM usuarios u
  LEFT JOIN perfis_doador d ON d.usuario_id = u.id
  LEFT JOIN perfis_ong o ON o.usuario_id = u.id`;

function publicUser(user: UserRow): PublicUser {
  return { id: user.id, nome: user.nome, email: user.email, tipo: user.tipo, cnpj: user.cnpj };
}

export async function register(body: unknown): Promise<PublicUser> {
  const input = validateRegistration(body);
  const passwordHash = await hashPassword(input.senha);
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute<ResultSetHeader>(
      'INSERT INTO usuarios (email, senha_hash, tipo) VALUES (?, ?, ?)',
      [input.email, passwordHash, input.tipo]
    );
    const id = String(result.insertId);
    if (input.tipo === 'ONG') {
      await connection.execute('INSERT INTO perfis_ong (usuario_id, nome, cnpj) VALUES (?, ?, ?)', [id, input.nome, input.cnpj]);
    } else {
      await connection.execute('INSERT INTO perfis_doador (usuario_id, nome) VALUES (?, ?)', [id, input.nome]);
    }
    await connection.commit();
    return { id, nome: input.nome, email: input.email, tipo: input.tipo, cnpj: input.cnpj };
  } catch (error) {
    await connection.rollback();
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
      throw new AuthError(409, 'E-mail ou CNPJ já cadastrado.');
    }
    throw error;
  } finally {
    connection.release();
  }
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function login(body: unknown) {
  const input = validateLogin(body);
  const [rows] = await database.execute<UserRow[]>(`${userSelect} WHERE u.email = ? LIMIT 1`, [input.email]);
  const user = rows[0];
  const valid = await verifyPassword(input.senha, user?.senha_hash ?? dummyHash);
  if (!valid || !user || !user.ativo || user.tipo !== input.tipo || !user.nome) {
    throw new AuthError(401, 'E-mail ou senha incorretos para o perfil selecionado.');
  }
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await database.execute('DELETE FROM sessoes WHERE usuario_id = ? AND expira_em <= UTC_TIMESTAMP(3)', [user.id]);
  await database.execute('INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES (?, ?, ?)', [tokenHash(token), user.id, expiresAt]);
  return { token, expiresAt: expiresAt.toISOString(), usuario: publicUser(user) };
}

export async function currentUser(token: string): Promise<PublicUser> {
  const [rows] = await database.execute<UserRow[]>(`${userSelect}
    INNER JOIN sessoes s ON s.usuario_id = u.id
    WHERE s.token_hash = ? AND s.expira_em > UTC_TIMESTAMP(3) AND u.ativo = 1`, [tokenHash(token)]);
  if (!rows[0] || !rows[0].nome) throw new AuthError(401, 'Sessão expirada. Entre novamente.');
  return publicUser(rows[0]);
}

export async function logout(token: string): Promise<void> {
  await database.execute('DELETE FROM sessoes WHERE token_hash = ?', [tokenHash(token)]);
}
