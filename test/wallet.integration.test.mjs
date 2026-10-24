import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';

function validCnpj(seed) {
  const base = `${seed.padStart(8, '0').slice(0, 8)}0000`;
  const digit = (value, weights) => { const sum = [...value].reduce((total, char, i) => total + Number(char) * weights[i], 0); const mod = sum % 11; return String(mod < 2 ? 0 : 11 - mod); };
  const first = digit(base, [5,4,3,2,9,8,7,6,5,4,3,2]);
  return base + first + digit(base + first, [6,5,4,3,2,9,8,7,6,5,4,3,2]);
}

test('carteira fictícia, doação idempotente, confirmação concorrente e histórico privado', {
  skip: process.env.RUN_AUTH_INTEGRATION !== '1'
}, async () => {
  assert.match(process.env.MYSQL_DATABASE ?? '', /_test$/);
  const [{ app }, { database, closeDatabase }, { runMigrations }] = await Promise.all([
    import('../dist/app.js'), import('../dist/database/mysql.js'), import('../dist/database/migrations/migrator.js')
  ]);
  await runMigrations();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const suffix = randomBytes(5).toString('hex');
  const emails = [`wallet-ong-${suffix}@example.test`, `wallet-donor-${suffix}@example.test`, `wallet-other-${suffix}@example.test`];
  const register = async (email, type, cnpj) => {
    const body = { tipo: type, nome: `Conta ${suffix}`, email, senha: 'Teste-seguro-123', confirmacaoSenha: 'Teste-seguro-123', ...(cnpj ? { cnpj } : {}) };
    const response = await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 201);
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return login.json();
  };
  const call = async (path, token, method = 'GET', body, operationKey) => {
    const response = await fetch(`${base}${path}`, { method, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(operationKey ? { 'Idempotency-Key': operationKey } : {})
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  try {
    const category = await database.execute('INSERT INTO categorias (nome) VALUES (?)', [`Carteira ${suffix}`]);
    const categoryId = String(category[0].insertId);
    const ong = await register(emails[0], 'ONG', validCnpj(randomBytes(4).readUInt32BE().toString().padStart(8, '0').slice(-8)));
    const donor = await register(emails[1], 'DOADOR');
    const otherDonor = await register(emails[2], 'DOADOR');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const end = new Date(`${today}T12:00:00-03:00`); end.setDate(end.getDate() + 10);
    const endDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(end);
    const created = await call('/campanhas', ong.token, 'POST', { categoriaId: categoryId, titulo: 'Arrecadação fictícia', descricao: 'Teste de carteira', metaCentavos: 1_000_000, inicioEm: today, fimEm: endDate });
    const campaignId = created.body.campanha.id;
    assert.equal((await call(`/campanhas/${campaignId}/status`, ong.token, 'PATCH', { status: 'ATIVA' })).status, 200);

    assert.deepEqual((await call('/carteira', donor.token)).body.carteira, { saldoCentavos: 0 });
    assert.equal((await call('/carteira', ong.token)).status, 403);
    assert.equal((await call('/carteira', donor.token, 'PUT', { saldoCentavos: 10_000 })).body.carteira.saldoCentavos, 10_000);
    for (const saldoCentavos of [-1, 1.5, 100_000_000_000]) assert.equal((await call('/carteira', donor.token, 'PUT', { saldoCentavos })).status, 400);

    const key = `donation-${randomBytes(8).toString('hex')}`;
    const intention = await call('/doacoes', donor.token, 'POST', { campanhaId: campaignId, valorCentavos: 3000, anonima: true }, key);
    assert.equal(intention.status, 201);
    assert.equal(intention.body.doacao.status, 'PENDENTE');
    assert.equal((await call('/carteira', donor.token)).body.carteira.saldoCentavos, 10_000);
    const repeated = await call('/doacoes', donor.token, 'POST', { campanhaId: campaignId, valorCentavos: 3000, anonima: true }, key);
    assert.equal(repeated.body.doacao.id, intention.body.doacao.id);
    assert.equal((await call('/doacoes', donor.token, 'POST', { campanhaId: campaignId, valorCentavos: 3100, anonima: true }, key)).status, 409);
    assert.equal((await call(`/doacoes/${intention.body.doacao.id}`, otherDonor.token)).status, 404);
    const confirmed = await call(`/doacoes/${intention.body.doacao.id}/confirmar`, donor.token, 'POST');
    assert.equal(confirmed.body.doacao.status, 'CONFIRMADA');
    await call(`/doacoes/${intention.body.doacao.id}/confirmar`, donor.token, 'POST');
    assert.equal((await call('/carteira', donor.token)).body.carteira.saldoCentavos, 7000);
    const publicCampaign = await call(`/campanhas/${campaignId}`, null);
    assert.equal(publicCampaign.body.campanha.arrecadadoCentavos, 3000);
    assert.equal(JSON.stringify(publicCampaign.body).includes(emails[1]), false);
    assert.equal((await call('/doacoes', otherDonor.token)).body.resultados.length, 0);

    const insufficient = await call('/doacoes', donor.token, 'POST', { campanhaId: campaignId, valorCentavos: 8000, anonima: false }, `donation-${randomBytes(8).toString('hex')}`);
    assert.equal((await call(`/doacoes/${insufficient.body.doacao.id}/confirmar`, donor.token, 'POST')).status, 409);
    assert.equal((await call(`/doacoes/${insufficient.body.doacao.id}`, donor.token)).body.doacao.status, 'PENDENTE');
    assert.equal((await call(`/doacoes/${insufficient.body.doacao.id}/cancelar`, donor.token, 'POST')).body.doacao.status, 'CANCELADA');
    assert.equal((await call(`/doacoes/${insufficient.body.doacao.id}/cancelar`, donor.token, 'POST')).body.doacao.status, 'CANCELADA');
    assert.equal((await call(`/campanhas/${campaignId}`, null)).body.campanha.arrecadadoCentavos, 3000);

    await call('/carteira', donor.token, 'PUT', { saldoCentavos: 10_000 });
    const concurrent = await Promise.all([1, 2].map(() => call('/doacoes', donor.token, 'POST', { campanhaId: campaignId, valorCentavos: 7000, anonima: false }, `donation-${randomBytes(8).toString('hex')}`)));
    const results = await Promise.all(concurrent.map((item) => call(`/doacoes/${item.body.doacao.id}/confirmar`, donor.token, 'POST')));
    assert.equal(results.filter((item) => item.status === 200).length, 1);
    assert.equal(results.filter((item) => item.status === 409).length, 1);
    assert.equal((await call('/carteira', donor.token)).body.carteira.saldoCentavos, 3000);
    assert.equal((await call('/doacoes', donor.token)).body.resultados.length, 4);
    assert.equal((await call(`/campanhas/${campaignId}`, null)).body.campanha.arrecadadoCentavos, 10_000);
  } finally {
    const [donors] = await database.execute('SELECT id FROM perfis_doador WHERE usuario_id IN (SELECT id FROM usuarios WHERE email IN (?,?))', [emails[1], emails[2]]);
    if (donors.length) {
      await database.execute(`DELETE FROM doacoes WHERE doador_id IN (${donors.map(() => '?').join(',')})`, donors.map((row) => row.id));
      await database.execute(`DELETE FROM carteiras_simuladas WHERE doador_id IN (${donors.map(() => '?').join(',')})`, donors.map((row) => row.id));
    }
    await database.execute('DELETE FROM usuarios WHERE email IN (?, ?, ?)', emails);
    await database.execute('DELETE FROM categorias WHERE nome = ?', [`Carteira ${suffix}`]);
    await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
  }
});
