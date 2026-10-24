import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';

test('CPF protegido, atualização, concorrência e backfill no banco de teste', {
  skip: process.env.RUN_AUTH_INTEGRATION !== '1'
}, async () => {
  assert.match(process.env.MYSQL_DATABASE ?? '', /_test$/);
  const [{ app }, { database, closeDatabase }, { runMigrations }, { backfillCpfIndex }, { env }] = await Promise.all([
    import('../dist/app.js'), import('../dist/database/mysql.js'),
    import('../dist/database/migrations/migrator.js'), import('../dist/database/migrations/backfill-cpf-index.js'),
    import('../dist/config/env.js')
  ]);
  await runMigrations();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1/auth`;
  const suffix = randomBytes(6).toString('hex');
  const emails = [0, 1, 2, 3, 4].map((i) => `cpf-${i}-${suffix}@example.test`);
  const call = async (path, body, token, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  const register = (email, cpf) => call('/register', {
    tipo: 'DOADOR', nome: 'Doador de teste', email, senha: 'Teste-seguro-123',
    confirmacaoSenha: 'Teste-seguro-123', ...(cpf === undefined ? {} : { cpf })
  });
  try {
    const first = await register(emails[0], '529.982.247-25');
    const second = await register(emails[1]);
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal((await register(emails[2], '111.111.111-11')).status, 400);
    assert.equal((await register(emails[2], '52998224725')).status, 409);
    const [orphan] = await database.execute('SELECT id FROM usuarios WHERE email = ?', [emails[2]]);
    assert.equal(orphan.length, 0, 'Conflito deve reverter a criação do usuário');

    const [stored] = await database.execute(`
      SELECT p.cpf, p.cpf_hash, d.cpf_cifrado
      FROM perfis_doador p LEFT JOIN dados_pessoais_usuario d ON d.usuario_id = p.usuario_id
      WHERE p.usuario_id = ?`, [first.body.usuario.id]);
    assert.equal(stored[0].cpf, null);
    assert.equal(stored[0].cpf_hash.length, 32);
    assert.ok(stored[0].cpf_cifrado);

    await database.execute('UPDATE perfis_doador SET cpf = ? WHERE usuario_id = ?', ['52998224725', second.body.usuario.id]);
    await assert.rejects(backfillCpfIndex(), /CPF duplicado entre usuários/);
    const [unchanged] = await database.execute('SELECT cpf FROM perfis_doador WHERE usuario_id = ?', [second.body.usuario.id]);
    assert.equal(unchanged[0].cpf, '52998224725', 'Backfill em conflito não altera os dados');
    await database.execute('UPDATE perfis_doador SET cpf = NULL WHERE usuario_id = ?', [second.body.usuario.id]);

    const originalKey = env.personalDataEncryptionKey;
    try {
      env.personalDataEncryptionKey = '';
      await assert.rejects(backfillCpfIndex(), /CPF cifrado inválido/);
    } finally {
      env.personalDataEncryptionKey = originalKey;
    }
    assert.equal(await backfillCpfIndex(), 1);
    assert.equal(await backfillCpfIndex(), 1, 'O backfill deve ser repetível');

    const login = await call('/login', { tipo: 'DOADOR', email: emails[1], senha: 'Teste-seguro-123' });
    const token = login.body.token;
    assert.equal((await call('/dados-pessoais', { nome: 'Ana', cpf: '529.982.247-25' }, token, 'PUT')).status, 409);
    assert.equal((await call('/dados-pessoais', { nome: 'Ana', cpf: '111.111.111-11' }, token, 'PUT')).status, 400);
    assert.equal((await call('/dados-pessoais', { nome: 'a'.repeat(100), sobrenome: 'b'.repeat(50) }, token, 'PUT')).status, 400);
    assert.equal((await call('/dados-pessoais', { nome: 'Ana', cpf: '111.444.777-35' }, token, 'PUT')).status, 200);
    assert.equal((await call('/dados-pessoais', { nome: 'Ana', cpf: null }, token, 'PUT')).status, 200);
    const [removed] = await database.execute(`
      SELECT p.cpf_hash, d.cpf_cifrado FROM perfis_doador p
      JOIN dados_pessoais_usuario d ON d.usuario_id = p.usuario_id WHERE p.usuario_id = ?`, [second.body.usuario.id]);
    assert.equal(removed[0].cpf_hash, null);
    assert.equal(removed[0].cpf_cifrado, null);

    const concurrent = await Promise.all([3, 4].map((i) => register(emails[i], '111.444.777-35')));
    assert.deepEqual(concurrent.map((result) => result.status).sort(), [201, 409]);
  } finally {
    for (const email of emails) await database.execute('DELETE FROM usuarios WHERE email = ?', [email]);
    await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
  }
});
