import { Router } from 'express';
import type { RowDataPacket } from 'mysql2';
import { database } from '../database/mysql.js';
import { currentUser } from '../auth/service.js';
import { AuthError } from '../auth/validation.js';

export const ongsRouter = Router();
ongsRouter.put('/endereco', async (request, response) => {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization ?? '');
  if (!match) throw new AuthError(401, 'Entre na sua conta.');
  const user = await currentUser(match[1]);
  if (user.tipo !== 'ONG') throw new AuthError(403, 'Somente ONGs podem cadastrar seu endereço.');
  const b = request.body ?? {};
  const fields = ['cep', 'logradouro', 'numero', 'bairro', 'cidade', 'estado'] as const;
  const limits = [9, 255, 20, 100, 100, 2];
  fields.forEach((f, i) => {
    if (typeof b[f] !== 'string' || !b[f].trim() || b[f].length > limits[i]!)
      throw new AuthError(400, 'Preencha corretamente o endereço.');
  });
  if (!/^[A-Z]{2}$/.test(b.estado) || !/^\d{5}-?\d{3}$/.test(b.cep))
    throw new AuthError(400, 'Confira o CEP e a UF.');
  if (typeof b.latitude !== 'number' || !Number.isFinite(b.latitude) || Math.abs(b.latitude) > 90 ||
      typeof b.longitude !== 'number' || !Number.isFinite(b.longitude) || Math.abs(b.longitude) > 180)
    throw new AuthError(400, 'Coordenadas inválidas.');
  const c = await database.getConnection();
  try {
    await c.beginTransaction();
    const [profiles] = await c.query<RowDataPacket[]>('SELECT id FROM perfis_ong WHERE usuario_id = ? FOR UPDATE', [user.id]);
    if (!profiles[0]) throw new AuthError(404, 'ONG não encontrada.');
    const id = profiles[0].id;
    const [rows] = await c.query<RowDataPacket[]>('SELECT id FROM enderecos_ong WHERE ong_id = ? ORDER BY id LIMIT 1', [id]);
    const values = fields.map(f => b[f].trim()).concat([b.latitude, b.longitude]);
    if (rows[0]) await c.execute(
      'UPDATE enderecos_ong SET cep=?, logradouro=?, numero=?, bairro=?, cidade=?, estado=?, latitude=?, longitude=? WHERE id=?',
      [...values, rows[0].id]);
    else await c.execute(
      'INSERT INTO enderecos_ong (cep, logradouro, numero, bairro, cidade, estado, latitude, longitude, ong_id) VALUES (?,?,?,?,?,?,?,?,?)',
      [...values, id]);
    await c.commit();
    response.json({ message: 'Endereço publicado no mapa.' });
  } catch (error) { await c.rollback(); throw error; }
  finally { c.release(); }
});
ongsRouter.get('/mapa', async (_request, response) => {
  const [ongs] = await database.query<RowDataPacket[]>(`
    SELECT CAST(o.id AS CHAR) id, o.nome, e.latitude, e.longitude
    FROM perfis_ong o JOIN usuarios u ON u.id = o.usuario_id
    JOIN enderecos_ong e ON e.ong_id = o.id
    WHERE u.ativo = 1 AND e.latitude IS NOT NULL AND e.longitude IS NOT NULL
    LIMIT 1000
  `);
  response.json({ ongs });
});
