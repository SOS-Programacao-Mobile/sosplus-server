import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';

function validCnpj(seed) {
  const digit = (value, weights) => { const sum = [...value].reduce((total, item, index) => total + Number(item) * weights[index], 0); const mod = sum % 11; return String(mod < 2 ? 0 : 11 - mod); };
  const base = `${seed.padStart(8, '0').slice(0, 8)}0000`;
  const first = digit(base, [5,4,3,2,9,8,7,6,5,4,3,2]);
  return `${base}${first}${digit(base + first, [6,5,4,3,2,9,8,7,6,5,4,3,2])}`;
}

test('necessidades e doações de itens isolam permissões e reservam/entregam quantidades exatas', {
  skip: process.env.RUN_AUTH_INTEGRATION !== '1'
}, async () => {
  assert.match(process.env.MYSQL_DATABASE ?? '', /_test$/);
  const [{ app }, { database, closeDatabase }, { runMigrations }] = await Promise.all([
    import('../dist/app.js'), import('../dist/database/mysql.js'), import('../dist/database/migrations/migrator.js')
  ]);
  await runMigrations();
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const suffix = randomBytes(6).toString('hex');
  const emails = [`materials-ong-${suffix}@example.test`, `materials-other-${suffix}@example.test`, `materials-donor-${suffix}@example.test`, `materials-other-donor-${suffix}@example.test`];
  const register = async (index, type) => {
    const input = { tipo: type, nome: `Conta ${suffix}`, email: emails[index], senha: 'Teste-seguro-123', confirmacaoSenha: 'Teste-seguro-123', ...(type === 'ONG' ? { cnpj: validCnpj(randomBytes(4).readUInt32BE().toString().padStart(8, '0').slice(-8)) } : {}) };
    const registered = await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    assert.equal(registered.status, 201);
    const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    return response.json();
  };
  const call = async (path, token, method = 'GET', body) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const [category] = await database.execute('INSERT INTO categorias (nome) VALUES (?)', [`Materials ${suffix}`]);
    const [ong, other, donor, otherDonor] = await Promise.all([register(0, 'ONG'), register(1, 'ONG'), register(2, 'DOADOR'), register(3, 'DOADOR')]);
    const baseNeed = { categoriaId: String(category.insertId), titulo: 'Água potável', descricao: 'Garrafas para a comunidade', tipo: 'Água', quantidade: '10', unidade: 'unidades' };
    assert.equal((await call('/necessidades', donor.token, 'POST', baseNeed)).status, 403);
    assert.equal((await call('/necessidades', ong.token, 'POST', { ...baseNeed, quantidade: '0' })).status, 400);
    assert.equal((await call('/necessidades', ong.token, 'POST', { ...baseNeed, categoriaId: '99999999' })).status, 400);
    const created = await call('/necessidades', ong.token, 'POST', baseNeed);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const needId = created.body.necessidade.id;
    assert.equal((await call(`/necessidades/${needId}`, other.token)).status, 200);
    const unavailable = await call('/doacoes-itens', donor.token, 'POST', { necessidadeId: '99999999', quantidade: '1', formaEntrega: 'RETIRADA' });
    assert.equal(unavailable.status, 409);
    const first = await call('/doacoes-itens', donor.token, 'POST', { necessidadeId: needId, quantidade: '4', formaEntrega: 'ENTREGA_NA_ONG', observacao: 'Levo no sábado' });
    const second = await call('/doacoes-itens', otherDonor.token, 'POST', { necessidadeId: needId, quantidade: '6', formaEntrega: 'RETIRADA', dataEntrega: '2026-10-24T12:00:00.000Z' });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(second.status, 201, JSON.stringify(second.body));
    const firstId = first.body.doacao.id, secondId = second.body.doacao.id;
    assert.equal((await call(`/doacoes-itens/${firstId}`, otherDonor.token)).status, 404);
    assert.equal((await call('/doacoes-itens/recebimentos', otherDonor.token)).status, 403);
    assert.equal((await call(`/doacoes-itens/${firstId}/status`, other.token, 'PATCH', { status: 'ACEITA' })).status, 404);
    assert.equal((await call(`/doacoes-itens/${firstId}/status`, ong.token, 'PATCH', { status: 'ACEITA' })).status, 200);
    assert.equal((await call(`/doacoes-itens/${secondId}/status`, ong.token, 'PATCH', { status: 'ACEITA' })).status, 200);
    const reserved = (await call(`/necessidades/${needId}`)).body.necessidade;
    assert.equal(reserved.reservado, '10.00'); assert.equal(reserved.restante, '10.00'); assert.equal(reserved.disponivel, '0.00');
    assert.equal((await call(`/doacoes-itens/${firstId}/status`, ong.token, 'PATCH', { status: 'ENTREGUE' })).status, 200);
    assert.equal((await call(`/doacoes-itens/${firstId}/status`, ong.token, 'PATCH', { status: 'ENTREGUE' })).status, 200);
    let snapshot = (await call(`/necessidades/${needId}`)).body.necessidade;
    assert.equal(snapshot.entregue, '4.00'); assert.equal(snapshot.reservado, '6.00'); assert.equal(snapshot.restante, '6.00');
    assert.equal((await call(`/doacoes-itens/${secondId}/status`, ong.token, 'PATCH', { status: 'ENTREGUE' })).status, 200);
    assert.equal((await call(`/doacoes-itens/${secondId}/status`, ong.token, 'PATCH', { status: 'ENTREGUE' })).status, 200);
    snapshot = (await call(`/necessidades/${needId}`)).body.necessidade;
    assert.equal(snapshot.status, 'ATENDIDA'); assert.equal(snapshot.entregue, '10.00');
    assert.equal((await call('/doacoes-itens/minhas', donor.token)).body.resultados[0].id, firstId);
    assert.equal((await call('/necessidades', null)).body.resultados.some((item) => item.id === needId), false);

    const cancelledNeed = await call('/necessidades', ong.token, 'POST', { ...baseNeed, titulo: 'Cobertores', quantidade: 2 });
    const pending = await call('/doacoes-itens', donor.token, 'POST', { necessidadeId: cancelledNeed.body.necessidade.id, quantidade: 1, formaEntrega: 'ENTREGA_NA_ONG' });
    const accepted = await call('/doacoes-itens', otherDonor.token, 'POST', { necessidadeId: cancelledNeed.body.necessidade.id, quantidade: 1, formaEntrega: 'RETIRADA' });
    assert.equal((await call(`/doacoes-itens/${accepted.body.doacao.id}/status`, ong.token, 'PATCH', { status: 'ACEITA' })).status, 200);
    assert.equal((await call(`/necessidades/${cancelledNeed.body.necessidade.id}/status`, ong.token, 'PATCH', { status: 'CANCELADA' })).status, 200);
    assert.equal((await call(`/doacoes-itens/${pending.body.doacao.id}`, donor.token)).body.doacao.status, 'CANCELADA');
    assert.equal((await call(`/doacoes-itens/${accepted.body.doacao.id}`, otherDonor.token)).body.doacao.status, 'CANCELADA');
    assert.equal((await call('/doacoes-itens', donor.token, 'POST', { necessidadeId: cancelledNeed.body.necessidade.id, quantidade: 1, formaEntrega: 'RETIRADA' })).status, 409);

    const limitedNeed = await call('/necessidades', ong.token, 'POST', { ...baseNeed, titulo: 'Alimentos', quantidade: 10 });
    const [reserveA, reserveB] = await Promise.all([
      call('/doacoes-itens', donor.token, 'POST', { necessidadeId: limitedNeed.body.necessidade.id, quantidade: 7, formaEntrega: 'RETIRADA' }),
      call('/doacoes-itens', otherDonor.token, 'POST', { necessidadeId: limitedNeed.body.necessidade.id, quantidade: 7, formaEntrega: 'RETIRADA' }),
    ]);
    const reserveResults = await Promise.all([reserveA, reserveB].map((item) => call(`/doacoes-itens/${item.body.doacao.id}/status`, ong.token, 'PATCH', { status: 'ACEITA' })));
    assert.deepEqual(reserveResults.map((item) => item.status).sort(), [200, 409]);

    const decimalNeed = await call('/necessidades', ong.token, 'POST', { ...baseNeed, titulo: 'Quantidade decimal', quantidade: '0.30' });
    const decimalItems = await Promise.all(['0.10','0.20'].map((quantity) => call('/doacoes-itens', donor.token, 'POST', { necessidadeId: decimalNeed.body.necessidade.id, quantidade: quantity, formaEntrega: 'ENTREGA_NA_ONG' })));
    for (const item of decimalItems) assert.equal((await call(`/doacoes-itens/${item.body.doacao.id}/status`, ong.token, 'PATCH', { status: 'ACEITA' })).status, 200);
    const delivered = await Promise.all(decimalItems.map((item) => call(`/doacoes-itens/${item.body.doacao.id}/status`, ong.token, 'PATCH', { status: 'ENTREGUE' })));
    assert.ok(delivered.every((item) => item.status === 200));
    const decimalResult = (await call(`/necessidades/${decimalNeed.body.necessidade.id}`)).body.necessidade;
    assert.equal(decimalResult.status, 'ATENDIDA'); assert.equal(decimalResult.entregue, '0.30'); assert.equal(decimalResult.restante, '0.00');
  } finally {
    await database.execute(`DELETE d FROM doacoes_itens d
      JOIN necessidades n ON n.id=d.necessidade_id JOIN perfis_ong p ON p.id=n.ong_id
      JOIN usuarios u ON u.id=p.usuario_id WHERE u.email IN (?,?)`, [emails[0], emails[1]]);
    await database.execute('DELETE FROM usuarios WHERE email IN (?, ?, ?, ?)', emails);
    await database.execute('DELETE FROM categorias WHERE nome=?', [`Materials ${suffix}`]);
    await new Promise((resolve) => server.close(resolve)); await closeDatabase();
  }
});
