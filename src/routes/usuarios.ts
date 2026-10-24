import { Router } from 'express';
import type { RowDataPacket } from 'mysql2';
import { database } from '../database/mysql.js';
import { currentUser } from '../auth/service.js';
import { AuthError } from '../auth/validation.js';

export const usuariosRouter = Router();
usuariosRouter.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });

// Histórico de doações do doador. Só o próprio usuário autenticado consulta as suas.
usuariosRouter.get('/:usuarioId/doacoes', async (request, response) => {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization ?? '');
  if (!match) throw new AuthError(401, 'Entre na sua conta para continuar.');
  const user = await currentUser(match[1]);
  if (request.params.usuarioId !== user.id) throw new AuthError(403, 'Você só pode consultar as suas próprias doações.');
  if (user.tipo !== 'DOADOR') throw new AuthError(403, 'Somente doadores possuem histórico de doações.');
  const [rows] = await database.query<RowDataPacket[]>(`
    SELECT CAST(d.id AS CHAR) id, CAST(ROUND(d.valor * 100) AS SIGNED) valor_centavos, d.status, d.anonima,
      DATE_FORMAT(d.data_doacao, '%Y-%m-%d') data,
      CAST(c.id AS CHAR) campanha_id, c.titulo campanha_titulo, CAST(o.id AS CHAR) ong_id, o.nome ong_nome
    FROM doacoes d
    JOIN perfis_doador p ON p.id = d.doador_id
    JOIN campanhas c ON c.id = d.campanha_id
    JOIN perfis_ong o ON o.id = c.ong_id
    WHERE p.usuario_id = ?
    ORDER BY d.data_doacao DESC, d.id DESC
    LIMIT 500
  `, [user.id]);
  response.json({
    doacoes: rows.map(r => ({
      id: r.id,
      ong: { id: r.ong_id, nome: r.ong_nome },
      campanha: { id: r.campanha_id, titulo: r.campanha_titulo },
      valorCentavos: Number(r.valor_centavos),
      data: r.data,
      status: r.status,
      anonima: Boolean(r.anonima)
    }))
  });
});
