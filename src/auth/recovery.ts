import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { database } from '../database/mysql.js';
import { env } from '../config/env.js';
import { logWarn } from '../observability/logger.js';
import { AuthError } from './validation.js';
import { hashPassword } from './password.js';
import { sendRecoveryCode } from './local-mail.js';

const uniformResponse = { mensagem: 'Se a conta estiver cadastrada, o código de recuperação estará na caixa de e-mail local.' };
const invalidCode = () => new AuthError(400, 'Código inválido ou expirado. Solicite outro código.');

export function validateRecoveryRequest(value: unknown): { email: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError(400, 'Informe seu e-mail.');
  const raw = (value as Record<string, unknown>).email;
  if (typeof raw !== 'string' || raw.trim().length > 255 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(raw.trim())) throw new AuthError(400, 'Digite um e-mail válido.');
  return { email: raw.trim().toLowerCase() };
}

export function validateRecoveryConfirmation(value: unknown) {
  const { email } = validateRecoveryRequest(value);
  const body = value as Record<string, unknown>;
  const code = typeof body.codigo === 'string' ? body.codigo.trim().toLowerCase() : '';
  if (!/^[a-f0-9]{64}$/.test(code)) throw invalidCode();
  if (typeof body.novaSenha !== 'string' || body.novaSenha.length < 8 || body.novaSenha.length > 128 || !body.novaSenha.trim()) throw new AuthError(400, 'A nova senha deve ter de 8 a 128 caracteres.');
  if (body.novaSenha !== body.confirmacaoSenha) throw new AuthError(400, 'A confirmação da nova senha não confere.');
  return { email, code, password: body.novaSenha };
}

export async function requestPasswordRecovery(body: unknown) {
  requireLocalRecovery();
  const { email } = validateRecoveryRequest(body);
  const code = randomBytes(32).toString('hex');
  const connection = await database.getConnection();
  let requestId: string | null = null;
  try {
    await connection.beginTransaction();
    const [users] = await connection.execute<(RowDataPacket & { id: string })[]>(
      'SELECT CAST(id AS CHAR) id FROM usuarios WHERE email=? AND ativo=1 FOR UPDATE', [email]);
    if (users[0]) {
      await connection.execute('UPDATE recuperacoes_senha SET revogado_em=UTC_TIMESTAMP(3) WHERE usuario_id=? AND revogado_em IS NULL AND consumido_em IS NULL', [users[0].id]);
      const [result] = await connection.execute<ResultSetHeader>(`INSERT INTO recuperacoes_senha (usuario_id,codigo_hash,expira_em)
        VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 15 MINUTE))`, [users[0].id, codeHash(code)]);
      requestId = String(result.insertId);
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  if (requestId) {
    try { await sendRecoveryCode(email, code); }
    catch {
      await database.execute('UPDATE recuperacoes_senha SET revogado_em=UTC_TIMESTAMP(3) WHERE id=?', [requestId]);
      logWarn('Caixa local de recuperação indisponível.');
    }
  }
  return uniformResponse;
}

export async function confirmPasswordRecovery(body: unknown) {
  requireLocalRecovery();
  const input = validateRecoveryConfirmation(body);
  const passwordHash = await hashPassword(input.password);
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.execute<(RowDataPacket & { id: string })[]>(
      'SELECT CAST(id AS CHAR) id FROM usuarios WHERE email=? AND ativo=1 FOR UPDATE', [input.email]);
    if (!users[0]) throw invalidCode();
    const [codes] = await connection.execute<(RowDataPacket & { id: string; codigo_hash: string; tentativas: number; vigente: number })[]>(`
      SELECT CAST(id AS CHAR) id,codigo_hash,tentativas,(expira_em>UTC_TIMESTAMP(3)) vigente FROM recuperacoes_senha
      WHERE usuario_id=? AND revogado_em IS NULL AND consumido_em IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE`, [users[0].id]);
    const stored = codes[0];
    if (!stored) throw invalidCode();
    const matches = timingSafeEqual(Buffer.from(stored.codigo_hash,'hex'), Buffer.from(codeHash(input.code),'hex'));
    if (Number(stored.vigente) !== 1 || Number(stored.tentativas) >= 5 || !matches) {
      await connection.execute(`UPDATE recuperacoes_senha SET tentativas=LEAST(tentativas+1,255),
        revogado_em=IF(expira_em<=UTC_TIMESTAMP(3) OR tentativas>=5,UTC_TIMESTAMP(3),revogado_em) WHERE id=?`, [stored.id]);
      await connection.commit();
      throw invalidCode();
    }
    await connection.execute('UPDATE usuarios SET senha_hash=? WHERE id=?', [passwordHash,users[0].id]);
    await connection.execute('DELETE FROM sessoes WHERE usuario_id=?', [users[0].id]);
    await connection.execute('UPDATE recuperacoes_senha SET consumido_em=UTC_TIMESTAMP(3) WHERE id=?', [stored.id]);
    await connection.execute('UPDATE recuperacoes_senha SET revogado_em=UTC_TIMESTAMP(3) WHERE usuario_id=? AND id<>? AND revogado_em IS NULL AND consumido_em IS NULL', [users[0].id,stored.id]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

function codeHash(code: string) { return createHash('sha256').update(code).digest('hex'); }
function requireLocalRecovery() {
  if (!env.recoveryEnabled) throw new AuthError(503, 'A recuperação local de senha não está configurada.');
}
