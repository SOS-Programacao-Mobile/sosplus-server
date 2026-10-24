import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { database } from '../database/mysql.js';
import { currentUser } from '../auth/service.js';
import { AuthError } from '../auth/validation.js';
import { requireUserType } from '../auth/session.js';
import { validateBalance, validateDonation } from './validation.js';

type DonationRow = RowDataPacket & {
  id: string; campanha_id: string; campanha_titulo: string; ong_nome: string; valor: string;
  anonima: number; status: string; data_doacao: string | Date;
};

export async function wallet(token: string) {
  const user = requireUserType(await currentUser(token), 'DOADOR');
  const donorId = await donorProfileId(user.id);
  const [rows] = await database.execute<(RowDataPacket & { saldo_centavos: string })[]>(
    'SELECT CAST(saldo_centavos AS CHAR) saldo_centavos FROM carteiras_simuladas WHERE doador_id=? LIMIT 1', [donorId]);
  if (!rows[0]) {
    await database.execute('INSERT INTO carteiras_simuladas (doador_id, saldo_centavos) VALUES (?, 0) ON DUPLICATE KEY UPDATE doador_id=VALUES(doador_id)', [donorId]);
    return { saldoCentavos: 0 };
  }
  return { saldoCentavos: Number(rows[0].saldo_centavos) };
}

export async function setWallet(token: string, body: unknown) {
  const user = requireUserType(await currentUser(token), 'DOADOR');
  const balance = validateBalance(body);
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const donorId = await donorProfileId(user.id, connection);
    await ensureWallet(connection, donorId);
    await connection.execute('UPDATE carteiras_simuladas SET saldo_centavos=? WHERE doador_id=?', [balance, donorId]);
    await connection.commit();
    return { saldoCentavos: balance };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function createDonation(token: string, body: unknown, operationKey: unknown) {
  const user = requireUserType(await currentUser(token), 'DOADOR');
  const input = validateDonation(body, operationKey);
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [campaigns] = await connection.execute<(RowDataPacket & { status: string; data_inicio: string | Date; data_fim: string | Date })[]>(
      'SELECT status,data_inicio,data_fim FROM campanhas WHERE id=? FOR UPDATE', [input.campaignId]);
    const campaign = campaigns[0];
    if (!campaign || !campaignAvailable(campaign.status, campaign.data_inicio, campaign.data_fim)) {
      throw new AuthError(409, 'A campanha não está disponível para contribuição agora.');
    }
    const donorId = await donorProfileId(user.id, connection);
    const [result] = await connection.execute<ResultSetHeader>(`
      INSERT INTO doacoes (doador_id,campanha_id,valor,anonima,status,chave_operacao)
      VALUES (?,?,?,?, 'PENDENTE',?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
    [donorId, input.campaignId, centsToDecimal(input.valueCents), input.anonymous ? 1 : 0, input.operationKey]);
    const donation = await donationRow(connection, String(result.insertId), donorId);
    if (donation.campanha_id !== input.campaignId || decimalToCents(donation.valor) !== input.valueCents || Number(donation.anonima) !== Number(input.anonymous)) {
      throw new AuthError(409, 'A chave já foi usada com outros dados.');
    }
    await connection.commit();
    return toDonation(donation);
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function confirmDonation(token: string, id: string) {
  const user = requireUserType(await currentUser(token), 'DOADOR');
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const donorId = await donorProfileId(user.id, connection);
    const [links] = await connection.execute<(RowDataPacket & { campanha_id: string })[]>(
      'SELECT CAST(campanha_id AS CHAR) campanha_id FROM doacoes WHERE id=? AND doador_id=?', [id, donorId]);
    if (!links[0]) throw new AuthError(404, 'Contribuição não encontrada.');
    const [campaigns] = await connection.execute<(RowDataPacket & { status: string; data_inicio: string | Date; data_fim: string | Date })[]>(
      'SELECT status,data_inicio,data_fim FROM campanhas WHERE id=? FOR UPDATE', [links[0].campanha_id]);
    await ensureWallet(connection, donorId);
    const [wallets] = await connection.execute<(RowDataPacket & { saldo_centavos: string })[]>(
      'SELECT CAST(saldo_centavos AS CHAR) saldo_centavos FROM carteiras_simuladas WHERE doador_id=? FOR UPDATE', [donorId]);
    const donation = await donationRow(connection, id, donorId, true);
    if (donation.status === 'CONFIRMADA') { await connection.commit(); return toDonation(donation); }
    if (donation.status !== 'PENDENTE') throw new AuthError(409, 'Esta contribuição já foi cancelada.');
    const campaign = campaigns[0];
    if (!campaign || !campaignAvailable(campaign.status, campaign.data_inicio, campaign.data_fim)) {
      throw new AuthError(409, 'A campanha não está disponível para confirmação.');
    }
    const balance = Number(wallets[0]?.saldo_centavos ?? 0);
    const cents = decimalToCents(donation.valor);
    if (balance < cents) throw new AuthError(409, 'Saldo fictício insuficiente. Ajuste sua carteira de simulação.');
    await connection.execute('UPDATE carteiras_simuladas SET saldo_centavos=saldo_centavos-? WHERE doador_id=?', [cents, donorId]);
    await connection.execute("UPDATE doacoes SET status='CONFIRMADA' WHERE id=? AND doador_id=? AND status='PENDENTE'", [id, donorId]);
    await connection.commit();
    return toDonation(await donationRow(connection, id, donorId));
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function cancelDonation(token: string, id: string) {
  const user = requireUserType(await currentUser(token), 'DOADOR');
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const donorId = await donorProfileId(user.id, connection);
    const [links] = await connection.execute<(RowDataPacket & { campanha_id: string })[]>(
      'SELECT CAST(campanha_id AS CHAR) campanha_id FROM doacoes WHERE id=? AND doador_id=?', [id, donorId]);
    if (!links[0]) throw new AuthError(404, 'Contribuição não encontrada.');
    await connection.execute('SELECT id FROM campanhas WHERE id=? FOR UPDATE', [links[0].campanha_id]);
    const donation = await donationRow(connection, id, donorId, true);
    if (donation.status === 'CANCELADA') { await connection.commit(); return toDonation(donation); }
    if (donation.status !== 'PENDENTE') throw new AuthError(409, 'Contribuição confirmada não pode ser cancelada.');
    await connection.execute("UPDATE doacoes SET status='CANCELADA' WHERE id=? AND doador_id=? AND status='PENDENTE'", [id, donorId]);
    await connection.commit();
    return toDonation(await donationRow(connection, id, donorId));
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function donations(token: string) {
  const user = requireUserType(await currentUser(token), 'DOADOR');
  const donorId = await donorProfileId(user.id);
  const [rows] = await database.execute<DonationRow[]>(`${donationSelect} WHERE d.doador_id=? ORDER BY d.data_doacao DESC,d.id DESC`, [donorId]);
  return rows.map(toDonation);
}

export async function donation(token: string, id: string) {
  const user = requireUserType(await currentUser(token), 'DOADOR');
  const donorId = await donorProfileId(user.id);
  const [rows] = await database.execute<DonationRow[]>(`${donationSelect} WHERE d.id=? AND d.doador_id=? LIMIT 1`, [id, donorId]);
  if (!rows[0]) throw new AuthError(404, 'Contribuição não encontrada.');
  return toDonation(rows[0]);
}

const donationSelect = `SELECT CAST(d.id AS CHAR) id, CAST(d.campanha_id AS CHAR) campanha_id,
  c.titulo campanha_titulo, o.nome ong_nome, d.valor, d.anonima, d.status, d.data_doacao
  FROM doacoes d JOIN campanhas c ON c.id=d.campanha_id JOIN perfis_ong o ON o.id=c.ong_id`;

function toDonation(row: DonationRow) {
  return { id: String(row.id), campanhaId: String(row.campanha_id), campanhaTitulo: row.campanha_titulo,
    ongNome: row.ong_nome, valorCentavos: decimalToCents(row.valor), anonima: Boolean(row.anonima),
    status: row.status, criadaEm: row.data_doacao instanceof Date ? row.data_doacao.toISOString() : String(row.data_doacao) };
}
async function donationRow(connection: PoolConnection, id: string, donorId: string, lock = false): Promise<DonationRow> {
  const [rows] = await connection.execute<DonationRow[]>(`${donationSelect} WHERE d.id=? AND d.doador_id=? ${lock ? 'FOR UPDATE' : ''}`, [id, donorId]);
  if (!rows[0]) throw new AuthError(404, 'Contribuição não encontrada.');
  return rows[0];
}
async function donorProfileId(userId: string, connection: PoolConnection | typeof database = database): Promise<string> {
  const [rows] = await connection.execute<(RowDataPacket & { id: string })[]>(
    'SELECT CAST(id AS CHAR) id FROM perfis_doador WHERE usuario_id=? LIMIT 1', [userId]);
  if (!rows[0]) throw new AuthError(404, 'Perfil de doador não encontrado.');
  return rows[0].id;
}
async function ensureWallet(connection: PoolConnection, donorId: string) {
  await connection.execute('INSERT INTO carteiras_simuladas (doador_id,saldo_centavos) VALUES (?,0) ON DUPLICATE KEY UPDATE doador_id=VALUES(doador_id)', [donorId]);
}
function campaignAvailable(status: string, start: string | Date, end: string | Date): boolean {
  const today = localDate();
  return status === 'ATIVA' && dateString(start) <= today && dateString(end) >= today;
}
function localDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts();
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`;
}
function dateString(value: string | Date): string { return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10); }
function centsToDecimal(cents: number): string { return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`; }
function decimalToCents(value: string): number { const [units, cents = '00'] = value.split('.'); return Number(units) * 100 + Number(cents.padEnd(2, '0').slice(0, 2)); }
